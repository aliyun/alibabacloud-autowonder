package com.aliyun.autowonder.auth.federation;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import com.aliyun.autowonder.user.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.Date;

/**
 * 首次 SSO 登录的开通编排：创建无本地密码的普通账号并建立企业身份绑定，两步在同一事务内完成。
 * 连接配置了用户名声明时，账号 username 取映射值；开启同名账号自动绑定时，只绑定尚未被任何
 * SSO 身份占用、用户名精确匹配且状态正常的本地账号，冲突一律拒绝而不是覆盖。
 * 不调用普通注册流程（因此没有首个管理员初始化），不创建工作空间成员关系，也不按邮箱合并账号。
 */
@Service
public class SsoAccountProvisioningService {
    private static final Logger log = LoggerFactory.getLogger(SsoAccountProvisioningService.class);

    static final int MAX_USERNAME_ATTEMPTS = 5;
    static final int MAX_USERNAME_LENGTH = 64;
    private static final int MAX_NICKNAME_LENGTH = 64;
    private static final int MAX_EMAIL_LENGTH = 128;
    private static final int GENERATED_SUFFIX_BYTES = 8;
    private static final String USERNAME_PREFIX = "sso_";
    private static final int AUTO_PROVISION_ENABLED = 1;
    private static final int BIND_EXISTING_ENABLED = 1;

    private final UserDao userDao;
    private final FederatedIdentityDao identityDao;
    private final SecureRandom random = new SecureRandom();

    public SsoAccountProvisioningService(UserDao userDao, FederatedIdentityDao identityDao) {
        this.userDao = userDao;
        this.identityDao = identityDao;
    }

    /**
     * 无绑定首登的解析结果：binding 为 null 表示当前连接既不允许自动建号也无同名账号可绑定，
     * 调用方应改为签发手动绑定票据。created 表示本次是否新建了账号。
     */
    public record ProvisionOutcome(FederatedIdentityDO binding, boolean created) {
    }

    /**
     * 并发首次登录时唯一键兜底：竞争失败方以 {@link ProvisionRaceException} 结束并整体回滚，
     * 不会留下没有绑定的孤立账号；调用方回读胜出方已建立的绑定。
     */
    @Transactional
    public ProvisionOutcome provision(ExternalIdentity identity, FederationConnectionDO connection) {
        FederatedIdentityDO existing = identityDao.findBinding(
                identity.providerId(), identity.issuer(), identity.subject());
        if (existing != null) {
            return new ProvisionOutcome(existing, false);
        }
        String mappedUsername = mappedUsername(identity, connection);
        if (mappedUsername != null && bindExistingByUsername(connection)) {
            UserDO candidate = userDao.findByUsername(mappedUsername);
            if (candidate != null) {
                requireAutoBindable(connection, candidate, mappedUsername);
                return new ProvisionOutcome(bind(identity, candidate.getId()), false);
            }
        }
        if (!autoProvisionEnabled(connection)) {
            return new ProvisionOutcome(null, false);
        }
        ResolvedUser resolved = mappedUsername == null
                ? createGeneratedUser(identity)
                : createMappedUser(identity, mappedUsername, connection);
        return new ProvisionOutcome(bind(identity, resolved.user().getId()), resolved.created());
    }

    /** 建号结果：created=false 表示写库时撞上了并发创建的同名账号并复用了它。 */
    private record ResolvedUser(UserDO user, boolean created) {
    }

    /**
     * 解析并校验用户名映射：未配置用户名声明时返回 null（沿用旧的随机用户名建号行为）；
     * 已配置但取值为空、超长、使用保留前缀或含控制字符时明确报错，不静默随机建号、不截断。
     */
    private String mappedUsername(ExternalIdentity identity, FederationConnectionDO connection) {
        String claim = connection == null ? null : trimToNull(connection.getUsernameClaim());
        if (claim == null) {
            return null;
        }
        String value = trimToNull(identity.username());
        if (value == null) {
            throw mappingInvalid(connection, "username claim " + claim + " is missing from the assertion");
        }
        // 软删除会把本地用户名改写为 #deleted-{id}，映射值不得落入该保留命名空间。
        if (value.startsWith(UserService.RESERVED_USERNAME_PREFIX)) {
            throw mappingInvalid(connection, "username claim value uses the reserved prefix");
        }
        if (value.length() > MAX_USERNAME_LENGTH) {
            throw mappingInvalid(connection,
                    "username claim value exceeds " + MAX_USERNAME_LENGTH + " characters");
        }
        for (int index = 0; index < value.length(); index++) {
            if (Character.isISOControl(value.charAt(index))) {
                throw mappingInvalid(connection, "username claim value contains control characters");
            }
        }
        return value;
    }

    /** 沿用旧行为：生成随机 sso_ 用户名；用户名碰撞换值重试，邮箱冲突留空继续。 */
    private ResolvedUser createGeneratedUser(ExternalIdentity identity) {
        String nickname = normalize(identity.displayName(), MAX_NICKNAME_LENGTH);
        String email = normalize(identity.email(), MAX_EMAIL_LENGTH);
        for (int attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
            String username = generateUsername();
            UserDO user = newUser(username, nickname == null ? username : nickname, email);
            try {
                userDao.insert(user);
                return new ResolvedUser(user, true);
            } catch (DuplicateKeyException e) {
                if (userDao.findByUsername(username) != null) {
                    // 用户名碰撞：换一个生成值重试。
                    continue;
                }
                if (email != null) {
                    // 邮箱唯一键冲突：邮箱留空不阻断开通，也不合并账号。
                    email = null;
                    continue;
                }
                throw e;
            }
        }
        throw new BizException(ErrorCode.FEDERATION_PROVISION_FAILED);
    }

    /**
     * 按映射值创建账号：用户名冲突时，若连接允许按用户名绑定则绑定该账号（并发场景下的合法匹配），
     * 否则明确报冲突；邮箱冲突时保留账号但不写入被占用邮箱，并留下可诊断日志。
     */
    private ResolvedUser createMappedUser(ExternalIdentity identity, String mappedUsername,
                                          FederationConnectionDO connection) {
        String nickname = normalize(identity.displayName(), MAX_NICKNAME_LENGTH);
        String email = normalize(identity.email(), MAX_EMAIL_LENGTH);
        UserDO user = newUser(mappedUsername, nickname == null ? mappedUsername : nickname, email);
        try {
            userDao.insert(user);
            return new ResolvedUser(user, true);
        } catch (DuplicateKeyException e) {
            UserDO taken = userDao.findByUsername(mappedUsername);
            if (taken != null) {
                if (bindExistingByUsername(connection)) {
                    requireAutoBindable(connection, taken, mappedUsername);
                    return new ResolvedUser(taken, false);
                }
                log.warn("sso provisioning username conflict provider={} reason=username_taken",
                        connection.getId());
                throw new BizException(ErrorCode.FEDERATION_USERNAME_CONFLICT);
            }
            if (email != null) {
                log.warn("sso provisioning email conflict provider={} reason=email_taken", connection.getId());
                user.setEmail(null);
                try {
                    userDao.insert(user);
                    return new ResolvedUser(user, true);
                } catch (DuplicateKeyException retry) {
                    throw new BizException(ErrorCode.FEDERATION_PROVISION_FAILED);
                }
            }
            throw new BizException(ErrorCode.FEDERATION_PROVISION_FAILED);
        }
    }

    /**
     * 同名自动绑定的统一准入：状态/权限 → 用户名精确匹配 → 加锁复查已有身份绑定。
     * <p>数据库用户名唯一键在常见排序规则下不区分大小写，映射值只是大小写不同也视为被占用，
     * 不得借此绑定另一个人的账号。锁定目标账号行后再做加锁读，可让并发首次绑定串行化：
     * 先提交的绑定对后到者可见，第二个身份得到明确的冲突结果而不是共享同一账号。
     */
    private void requireAutoBindable(FederationConnectionDO connection, UserDO candidate,
                                     String mappedUsername) {
        requireBindable(connection, candidate);
        if (!mappedUsername.equals(candidate.getUsername())) {
            log.warn("sso auto bind rejected provider={} userId={} reason=username_case_mismatch",
                    connection.getId(), candidate.getId());
            throw new BizException(ErrorCode.FEDERATION_USERNAME_CONFLICT);
        }
        if (userDao.lockById(candidate.getId()) == null) {
            log.warn("sso auto bind rejected provider={} userId={} reason=account_deleted",
                    connection.getId(), candidate.getId());
            throw new BizException(ErrorCode.FEDERATION_AUTO_BIND_REJECTED);
        }
        if (identityDao.findBindingForUpdate(candidate.getId()) != null) {
            log.warn("sso auto bind rejected provider={} userId={} reason=account_already_bound",
                    connection.getId(), candidate.getId());
            throw new BizException(ErrorCode.FEDERATION_AUTO_BIND_IDENTITY_CONFLICT);
        }
    }

    /**
     * 自动绑定只面向普通正常账号：停用、软删除、待审与高权限账号一律拒绝，
     * 这些账号仍可通过账号密码手动绑定路径认领该企业身份。
     */
    private void requireBindable(FederationConnectionDO connection, UserDO user) {
        if (Integer.valueOf(1).equals(user.getIsDeleted())) {
            reject(connection, user, "account_deleted");
        }
        if (Integer.valueOf(1).equals(user.getStatus())) {
            throw new BizException(ErrorCode.FEDERATION_ACCOUNT_DISABLED);
        }
        if (!Integer.valueOf(0).equals(user.getStatus())) {
            reject(connection, user, "account_not_normal");
        }
        if (Integer.valueOf(1).equals(user.getIsAdmin())
                || Integer.valueOf(1).equals(user.getWorkspaceCreationGranted())) {
            reject(connection, user, "privileged_account_requires_manual_binding");
        }
    }

    private void reject(FederationConnectionDO connection, UserDO user, String reason) {
        log.warn("sso auto bind rejected provider={} userId={} reason={}",
                connection.getId(), user.getId(), reason);
        throw new BizException(ErrorCode.FEDERATION_AUTO_BIND_REJECTED);
    }

    private FederatedIdentityDO bind(ExternalIdentity identity, Long userId) {
        FederatedIdentityDO binding = new FederatedIdentityDO();
        binding.setProviderId(identity.providerId());
        binding.setIssuer(identity.issuer());
        binding.setSubject(identity.subject());
        binding.setUserId(userId);
        binding.setDisplayName(identity.displayName());
        binding.setEmail(identity.email());
        binding.setLastLoginAt(new Date());
        try {
            identityDao.insert(binding);
        } catch (DuplicateKeyException e) {
            throw new ProvisionRaceException(e);
        }
        return binding;
    }

    private static UserDO newUser(String username, String nickname, String email) {
        UserDO user = new UserDO();
        user.setUsername(username);
        user.setNickname(nickname);
        user.setEmail(email);
        // 纯 SSO 账号不设置本地密码。
        user.setPasswordHash(null);
        user.setStatus(0);
        // 与 V083 的 NOT NULL DEFAULT 0 对齐：insert 显式绑定该列，缺省会写入 NULL 并违反约束。
        user.setVerificationInvalidated(0);
        return user;
    }

    private static boolean autoProvisionEnabled(FederationConnectionDO connection) {
        return connection == null
                || Integer.valueOf(AUTO_PROVISION_ENABLED).equals(connection.getAutoProvision());
    }

    private static boolean bindExistingByUsername(FederationConnectionDO connection) {
        return connection != null
                && Integer.valueOf(BIND_EXISTING_ENABLED).equals(connection.getBindExistingByUsername());
    }

    private BizException mappingInvalid(FederationConnectionDO connection, String diagnostic) {
        log.warn("sso username mapping rejected provider={} reason={}",
                connection.getId(), diagnostic);
        return BizException.keyed(ErrorCode.FEDERATION_USERNAME_MAPPING_INVALID,
                ErrorCode.FEDERATION_USERNAME_MAPPING_INVALID.getMessageKey(), null,
                "provider " + connection.getId() + ": " + diagnostic);
    }

    private String generateUsername() {
        byte[] bytes = new byte[GENERATED_SUFFIX_BYTES];
        random.nextBytes(bytes);
        StringBuilder builder = new StringBuilder(USERNAME_PREFIX);
        for (byte value : bytes) {
            builder.append(Character.forDigit((value >> 4) & 0x0f, 16));
            builder.append(Character.forDigit(value & 0x0f, 16));
        }
        return builder.toString();
    }

    private static String normalize(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.length() > maxLength ? trimmed.substring(0, maxLength) : trimmed;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** 同一外部身份并发首次登录的竞争失败方：调用方回读已建立的绑定或按身份冲突处理。 */
    public static class ProvisionRaceException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        ProvisionRaceException(Throwable cause) {
            super("concurrent first login created the same federated identity", cause);
        }
    }
}

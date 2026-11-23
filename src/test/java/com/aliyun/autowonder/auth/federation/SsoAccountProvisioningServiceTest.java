package com.aliyun.autowonder.auth.federation;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DuplicateKeyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SsoAccountProvisioningServiceTest {
    private static final Long PROVIDER_ID = 7L;
    private static final String ISSUER = "https://idp.example.com";
    private static final String SUBJECT = "employee-10482";

    private UserDao userDao;
    private FederatedIdentityDao identityDao;
    private SsoAccountProvisioningService service;

    @BeforeEach
    void setUp() {
        userDao = mock(UserDao.class);
        identityDao = mock(FederatedIdentityDao.class);
        service = new SsoAccountProvisioningService(userDao, identityDao);
        doAnswer(invocation -> {
            UserDO user = invocation.getArgument(0);
            user.setId(555L);
            return 1;
        }).when(userDao).insert(any());
    }

    @Test
    void createsAPasswordlessNormalUserAndBindsTheIdentity() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);

        SsoAccountProvisioningService.ProvisionOutcome outcome =
                service.provision(identity("林晓", "lin@corp.example.com", null), null);

        ArgumentCaptor<UserDO> created = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao).insert(created.capture());
        assertTrue(created.getValue().getUsername().startsWith("sso_"));
        assertEquals(0, created.getValue().getStatus());
        assertEquals(0, created.getValue().getVerificationInvalidated());
        assertNull(created.getValue().getPasswordHash());
        assertEquals("林晓", created.getValue().getNickname());
        assertEquals("lin@corp.example.com", created.getValue().getEmail());

        ArgumentCaptor<FederatedIdentityDO> saved = ArgumentCaptor.forClass(FederatedIdentityDO.class);
        verify(identityDao).insert(saved.capture());
        assertEquals(555L, saved.getValue().getUserId());
        assertEquals(SUBJECT, saved.getValue().getSubject());
        assertNotNull(saved.getValue().getLastLoginAt());
        assertEquals(555L, outcome.binding().getUserId());
        assertTrue(outcome.created());
    }

    @Test
    void reusesAnExistingBindingWithoutCreatingASecondUser() {
        FederatedIdentityDO existing = new FederatedIdentityDO();
        existing.setUserId(10000L);
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(existing);

        SsoAccountProvisioningService.ProvisionOutcome outcome =
                service.provision(identity("林晓", null, null), null);
        assertSame(existing, outcome.binding());
        assertFalse(outcome.created());
        verify(userDao, never()).insert(any());
    }

    @Test
    void missingDisplayNameFallsBackToTheGeneratedUsername() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);

        service.provision(identity("   ", "", null), null);

        ArgumentCaptor<UserDO> created = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao).insert(created.capture());
        assertEquals(created.getValue().getUsername(), created.getValue().getNickname());
        assertNull(created.getValue().getEmail());
    }

    @Test
    void retriesWithANewUsernameWhenTheGeneratedOneIsTaken() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        when(userDao.findByUsername(any())).thenReturn(new UserDO());
        doThrow(new DuplicateKeyException("uk_username"))
                .doAnswer(invocation -> {
                    UserDO user = invocation.getArgument(0);
                    user.setId(556L);
                    return 1;
                })
                .when(userDao).insert(any());

        SsoAccountProvisioningService.ProvisionOutcome outcome =
                service.provision(identity("林晓", null, null), null);

        assertEquals(556L, outcome.binding().getUserId());
        verify(identityDao).insert(any());
    }

    @Test
    void emailCollisionDropsTheEmailAndStillProvisions() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        when(userDao.findByUsername(any())).thenReturn(null);
        doThrow(new DuplicateKeyException("uk_email"))
                .doAnswer(invocation -> {
                    UserDO user = invocation.getArgument(0);
                    user.setId(557L);
                    return 1;
                })
                .when(userDao).insert(any());

        service.provision(identity("林晓", "taken@corp.example.com", null), null);

        ArgumentCaptor<UserDO> created = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao, org.mockito.Mockito.times(2)).insert(created.capture());
        List<UserDO> attempts = created.getAllValues();
        assertEquals("taken@corp.example.com", attempts.get(0).getEmail());
        assertNull(attempts.get(1).getEmail());
    }

    @Test
    void concurrentBindingRaceIsReportedSoTheCallerCanRollBackTheUser() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        doThrow(new DuplicateKeyException("uk_federated_identity_subject"))
                .when(identityDao).insert(any());

        assertThrows(SsoAccountProvisioningService.ProvisionRaceException.class,
                () -> service.provision(identity("林晓", null, null), null));
    }

    @Test
    void exhaustedUsernameAttemptsFailInsteadOfCreatingAPartialAccount() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        when(userDao.findByUsername(any())).thenReturn(new UserDO());
        doThrow(new DuplicateKeyException("uk_username")).when(userDao).insert(any());

        BizException error = assertThrows(BizException.class,
                () -> service.provision(identity("林晓", null, null), null));
        assertEquals("36014", error.getCode());
        verify(identityDao, never()).insert(any());
    }

    @Test
    void mappedNameIdBecomesTheAccountUsernameWithProfileFields() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);

        SsoAccountProvisioningService.ProvisionOutcome outcome = service.provision(
                identity("测试用户一", "sso-test-001@example.com", "f_test_001"),
                connection("NameID", 0));

        ArgumentCaptor<UserDO> created = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao).insert(created.capture());
        assertEquals("f_test_001", created.getValue().getUsername());
        assertEquals("测试用户一", created.getValue().getNickname());
        assertEquals("sso-test-001@example.com", created.getValue().getEmail());
        // SSO 绑定仍以 subject 为准，不随用户名映射变化。
        ArgumentCaptor<FederatedIdentityDO> saved = ArgumentCaptor.forClass(FederatedIdentityDO.class);
        verify(identityDao).insert(saved.capture());
        assertEquals(SUBJECT, saved.getValue().getSubject());
        assertTrue(outcome.created());
    }

    @Test
    void mappedUsernameIsTrimmedBeforeUse() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);

        service.provision(identity("测试张三", null, "  zhangsan_test  "), connection("login_name", 0));

        ArgumentCaptor<UserDO> created = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao).insert(created.capture());
        assertEquals("zhangsan_test", created.getValue().getUsername());
    }

    @Test
    void bindsAnExistingNormalAccountWithoutCreatingASecondOne() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        UserDO existing = user(9001L, 0);
        existing.setUsername("zhangsan_test");
        when(userDao.findByUsername("zhangsan_test")).thenReturn(existing);
        when(userDao.lockById(9001L)).thenReturn(existing);

        SsoAccountProvisioningService.ProvisionOutcome outcome = service.provision(
                identity("测试张三", "zhangsan-test@example.com", "zhangsan_test"),
                connection("login_name", 1));

        assertFalse(outcome.created());
        assertEquals(9001L, outcome.binding().getUserId());
        verify(userDao, never()).insert(any());
        verify(userDao).lockById(9001L);
        verify(identityDao).findBindingForUpdate(9001L);
        verify(identityDao).insert(any());
    }

    @Test
    void refusesToAutoBindAnAccountAlreadyBoundToAnotherIdentity() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        UserDO bound = user(9010L, 0);
        bound.setUsername("zhangsan_test");
        when(userDao.findByUsername("zhangsan_test")).thenReturn(bound);
        when(userDao.lockById(9010L)).thenReturn(bound);
        FederatedIdentityDO otherBinding = new FederatedIdentityDO();
        otherBinding.setId(77L);
        otherBinding.setUserId(9010L);
        when(identityDao.findBindingForUpdate(9010L)).thenReturn(otherBinding);

        BizException error = assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", "zhangsan@example.com", "zhangsan_test"),
                connection("login_name", 1)));

        assertEquals("36018", error.getCode());
        verify(identityDao, never()).insert(any());
        verify(userDao, never()).insert(any());
    }

    @Test
    void refusesToAutoBindWhenTheUsernameOnlyDiffersByCase() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        UserDO otherCase = user(9011L, 0);
        otherCase.setUsername("ZhangSan_Test");
        when(userDao.findByUsername("zhangsan_test")).thenReturn(otherCase);

        BizException error = assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1)));

        assertEquals("36016", error.getCode());
        verify(userDao, never()).lockById(any());
        verify(identityDao, never()).insert(any());
        verify(userDao, never()).insert(any());
    }

    @Test
    void refusesToAutoBindWhenTheAccountDisappearsBeforeLocking() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        UserDO candidate = user(9012L, 0);
        candidate.setUsername("zhangsan_test");
        when(userDao.findByUsername("zhangsan_test")).thenReturn(candidate);
        when(userDao.lockById(9012L)).thenReturn(null);

        BizException error = assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1)));

        assertEquals("36017", error.getCode());
        verify(identityDao, never()).insert(any());
    }

    @Test
    void concurrentCreationIntoAnAlreadyBoundAccountIsRejected() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        UserDO taken = user(9013L, 0);
        taken.setUsername("zhangsan_test");
        // 首次查找尚无同名账号；写库时被并发创建，回查后按开关进入绑定准入。
        when(userDao.findByUsername("zhangsan_test")).thenReturn(null, taken);
        doThrow(new DuplicateKeyException("uk_username")).when(userDao).insert(any());
        when(userDao.lockById(9013L)).thenReturn(taken);
        when(identityDao.findBindingForUpdate(9013L)).thenReturn(new FederatedIdentityDO());

        BizException error = assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1)));

        assertEquals("36018", error.getCode());
        verify(identityDao, never()).insert(any());
    }

    @Test
    void refusesToAutoBindDisabledDeletedOrPrivilegedAccounts() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);

        UserDO disabled = user(9001L, 1);
        when(userDao.findByUsername("zhangsan_test")).thenReturn(disabled);
        assertEquals("36007", assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1))).getCode());

        UserDO deleted = user(9002L, 0);
        deleted.setIsDeleted(1);
        when(userDao.findByUsername("zhangsan_test")).thenReturn(deleted);
        assertEquals("36017", assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1))).getCode());

        UserDO admin = user(9003L, 0);
        admin.setIsAdmin(1);
        when(userDao.findByUsername("zhangsan_test")).thenReturn(admin);
        assertEquals("36017", assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1))).getCode());

        UserDO workspaceCreator = user(9004L, 0);
        workspaceCreator.setWorkspaceCreationGranted(1);
        when(userDao.findByUsername("zhangsan_test")).thenReturn(workspaceCreator);
        assertEquals("36017", assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1))).getCode());

        verify(identityDao, never()).insert(any());
    }

    @Test
    void configuredUsernameClaimWithMissingOrIllegalValueIsRejected() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);

        for (String value : new String[]{null, "   ", "#deleted-10000", "x".repeat(65), "bad\u0000name"}) {
            assertEquals("36015", assertThrows(BizException.class, () -> service.provision(
                    identity("测试张三", null, value), connection("login_name", 0))).getCode(), value);
        }
        verify(userDao, never()).insert(any());
        verify(identityDao, never()).insert(any());
    }

    @Test
    void usernameConflictWithoutAutoBindIsExplicitAndDoesNotRandomlyRetry() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        when(userDao.findByUsername("zhangsan_test")).thenReturn(null);
        doThrow(new DuplicateKeyException("uk_username")).when(userDao).insert(any());
        when(userDao.findByUsername("zhangsan_test")).thenReturn(user(9005L, 0));

        assertEquals("36016", assertThrows(BizException.class, () -> service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 0))).getCode());
        verify(userDao, org.mockito.Mockito.times(1)).insert(any());
        verify(identityDao, never()).insert(any());
    }

    @Test
    void concurrentSameUsernameCreationBindsWhenAutoBindIsEnabled() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        // 首次查找尚无同名账号；写库时被并发创建，回查后按开关绑定该账号。
        UserDO taken = user(9006L, 0);
        taken.setUsername("zhangsan_test");
        when(userDao.findByUsername("zhangsan_test")).thenReturn(null, taken);
        doThrow(new DuplicateKeyException("uk_username")).when(userDao).insert(any());
        when(userDao.lockById(9006L)).thenReturn(taken);

        SsoAccountProvisioningService.ProvisionOutcome outcome = service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1));

        assertFalse(outcome.created());
        assertEquals(9006L, outcome.binding().getUserId());
    }

    @Test
    void mappedUsernameKeepsEmailCollisionDiagnosticAndStillCreatesTheAccount() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        when(userDao.findByUsername("zhangsan_test")).thenReturn(null);
        List<String> attemptedEmails = new java.util.ArrayList<>();
        doAnswer(invocation -> {
            attemptedEmails.add(((UserDO) invocation.getArgument(0)).getEmail());
            throw new DuplicateKeyException("uk_email");
        }).doAnswer(invocation -> {
            UserDO user = invocation.getArgument(0);
            user.setId(9007L);
            return 1;
        }).when(userDao).insert(any());

        SsoAccountProvisioningService.ProvisionOutcome outcome = service.provision(
                identity("测试张三", "taken@corp.example.com", "zhangsan_test"),
                connection("login_name", 0));

        ArgumentCaptor<UserDO> created = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao, org.mockito.Mockito.times(2)).insert(created.capture());
        assertEquals("zhangsan_test", created.getAllValues().get(0).getUsername());
        assertEquals(1, attemptedEmails.size());
        assertEquals("taken@corp.example.com", attemptedEmails.get(0));
        assertNull(created.getAllValues().get(1).getEmail());
        assertEquals(9007L, outcome.binding().getUserId());
        assertTrue(outcome.created());
    }

    @Test
    void returnsNoBindingWhenAutoProvisionIsOffAndNoLocalAccountMatches() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);
        when(userDao.findByUsername("zhangsan_test")).thenReturn(null);

        SsoAccountProvisioningService.ProvisionOutcome outcome = service.provision(
                identity("测试张三", null, "zhangsan_test"), connection("login_name", 1, 0));

        assertNull(outcome.binding());
        assertFalse(outcome.created());
        verify(userDao, never()).insert(any());
        verify(identityDao, never()).insert(any());
    }

    @Test
    void legacyConnectionWithoutUsernameClaimIgnoresAutoBindSwitch() {
        when(identityDao.findBinding(PROVIDER_ID, ISSUER, SUBJECT)).thenReturn(null);

        SsoAccountProvisioningService.ProvisionOutcome outcome = service.provision(
                identity("林晓", null, "ignored_value"),
                connection(null, 1, 0));

        assertNull(outcome.binding());
        verify(userDao, never()).insert(any());
        verify(identityDao, never()).insert(any());
    }

    private static FederationConnectionDO connection(String usernameClaim, int bindExisting) {
        return connection(usernameClaim, bindExisting, 1);
    }

    private static FederationConnectionDO connection(String usernameClaim, int bindExisting, int autoProvision) {
        FederationConnectionDO connection = new FederationConnectionDO();
        connection.setId(PROVIDER_ID);
        connection.setUsernameClaim(usernameClaim);
        connection.setBindExistingByUsername(bindExisting);
        connection.setAutoProvision(autoProvision);
        return connection;
    }

    private static UserDO user(Long id, int status) {
        UserDO user = new UserDO();
        user.setId(id);
        user.setStatus(status);
        user.setIsDeleted(0);
        user.setIsAdmin(0);
        user.setWorkspaceCreationGranted(0);
        return user;
    }

    private static ExternalIdentity identity(String displayName, String email, String username) {
        return new ExternalIdentity(PROVIDER_ID, ISSUER, SUBJECT, displayName, email, "feishu-1", username);
    }
}

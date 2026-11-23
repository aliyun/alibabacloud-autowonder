package com.aliyun.autowonder.user;

import com.aliyun.autowonder.access.SystemAdminService;
import com.aliyun.autowonder.auth.jwt.JwtProperties;
import com.aliyun.autowonder.auth.jwt.JwtService;
import com.aliyun.autowonder.auth.session.SessionIssuanceService;
import com.aliyun.autowonder.auth.session.SessionService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.email.EmailVerificationPolicyService;
import com.aliyun.autowonder.email.EmailVerificationService;
import com.aliyun.autowonder.feature.PlatformFeatureSwitchService;
import com.aliyun.autowonder.user.dto.RegisterRequest;
import com.aliyun.autowonder.user.dto.UpdateProfileRequest;
import com.aliyun.autowonder.user.dto.UserProfileVO;
import com.aliyun.autowonder.workspace.WorkspaceMemberDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.core.env.Environment;

import java.lang.reflect.Field;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserServiceEmailVerificationTest {

    private static final long USER_ID = 55L;

    private UserDao userDao;
    private PlatformFeatureSwitchService featureSwitchService;
    private EmailVerificationPolicyService policy;
    private EmailVerificationService verificationService;
    private UserService service;

    @BeforeEach
    void setUp() throws Exception {
        userDao = mock(UserDao.class);
        featureSwitchService = mock(PlatformFeatureSwitchService.class);
        SessionService sessionService = mock(SessionService.class);
        Environment env = mock(Environment.class);
        when(env.getActiveProfiles()).thenReturn(new String[]{"daily"});
        JwtProperties props = new JwtProperties(env);
        props.setSecret("test-secret-key-that-is-long-enough-32bytes!");
        JwtService jwtService = new JwtService(props);
        service = new UserService(userDao, jwtService, sessionService, props,
                mock(WorkspaceMemberDao.class), mock(com.aliyun.autowonder.workspace.WorkspaceDao.class), mock(SystemAdminService.class),
                new SessionIssuanceService(jwtService, sessionService, props), featureSwitchService,
                mock(WorkspaceCreationPermissionService.class), mock(ApplicationEventPublisher.class));
        policy = mock(EmailVerificationPolicyService.class);
        verificationService = mock(EmailVerificationService.class);
        setField(service, "emailVerificationPolicyService", policy);
        setField(service, "emailVerificationService", verificationService);
    }

    private void setField(Object target, String name, Object value) throws Exception {
        Field field = UserService.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private RegisterRequest registerRequest(String email, String proof) {
        RegisterRequest request = new RegisterRequest();
        request.setUsername("alice");
        request.setNickname("Alice");
        request.setPassword("secret1");
        request.setEmail(email);
        request.setEmailVerificationProof(proof);
        return request;
    }

    private UserDO existing(String email) {
        UserDO user = new UserDO();
        user.setId(USER_ID);
        user.setUsername("alice");
        user.setNickname("Alice");
        user.setEmail(email);
        user.setStatus(0);
        user.setGmtCreate(new Date(1_000L));
        return user;
    }

    private UpdateProfileRequest profileRequest(String email, String proof) {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname("Alice");
        request.setEmail(email);
        request.setEmailVerificationProof(proof);
        return request;
    }

    @Test
    void registerWithVerificationConsumesProofAndMarksEmailVerified() {
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("alice@example.com")).thenReturn(true);

        service.register(registerRequest("alice@example.com", "awevp_reg"));

        ArgumentCaptor<UserDO> captor = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao).insert(captor.capture());
        assertEquals("alice@example.com", captor.getValue().getVerifiedEmail());
        assertTrue(captor.getValue().getFirstVerifiedAt() != null);
        verify(verificationService).consumeRegisterProof("awevp_reg", "alice@example.com");
    }

    @Test
    void registerWithVerificationRequiresEmailAndCompliance() {
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("alice@example.com")).thenReturn(false);
        assertEquals("51006", assertThrows(BizException.class, () -> service.register(
                registerRequest("alice@example.com", "awevp_reg"))).getCode());

        when(policy.isEmailCompliant(null)).thenReturn(true);
        assertEquals("10001", assertThrows(BizException.class, () -> service.register(
                registerRequest(null, "awevp_reg"))).getCode());
        verify(userDao, never()).insert(any());
    }

    @Test
    void registerWithoutVerificationKeepsUnverifiedState() {
        when(policy.verificationEnabled()).thenReturn(false);
        when(policy.isEmailCompliant("alice@example.com")).thenReturn(true);

        service.register(registerRequest("alice@example.com", null));

        ArgumentCaptor<UserDO> captor = ArgumentCaptor.forClass(UserDO.class);
        verify(userDao).insert(captor.capture());
        assertNull(captor.getValue().getVerifiedEmail());
        assertEquals(0, captor.getValue().getVerificationInvalidated());
        verify(verificationService, never()).consumeRegisterProof(any(), any());
    }

    @Test
    void profileEmailChangeWithVerificationConsumesProofAndMarksVerified() {
        when(userDao.findById(USER_ID)).thenReturn(existing("old@example.com"));
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("new@example.com")).thenReturn(true);

        service.updateProfile(USER_ID, profileRequest("new@example.com", "awevp_profile"));

        verify(verificationService).consumeProfileProof(USER_ID, "new@example.com", "awevp_profile");
        verify(userDao).updateProfileWithEmail(eq(USER_ID), eq("Alice"), eq("new@example.com"),
                isNull(), eq("new@example.com"), any(Date.class), any(Date.class), eq(0));
    }

    @Test
    void profileEmailChangeWithoutProofFailsAndKeepsOldEmail() {
        when(userDao.findById(USER_ID)).thenReturn(existing("old@example.com"));
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("new@example.com")).thenReturn(true);
        doThrow(new BizException(ErrorCode.EMAIL_VERIFICATION_PROOF_INVALID))
                .when(verificationService).consumeProfileProof(USER_ID, "new@example.com", null);

        assertEquals("51008", assertThrows(BizException.class, () -> service.updateProfile(
                USER_ID, profileRequest("new@example.com", null))).getCode());
        verify(userDao, never()).updateProfileWithEmail(anyLong(), anyString(), anyString(),
                any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void adminEmailChangeClearsVerificationWithoutProof() {
        when(userDao.findById(USER_ID)).thenReturn(existing("old@example.com"));
        when(policy.isEmailCompliant("new@example.com")).thenReturn(true);
        when(policy.verificationEnabled()).thenReturn(true);

        service.updateProfileByAdmin(USER_ID, profileRequest("new@example.com", null));

        verify(userDao).updateProfileWithEmail(eq(USER_ID), eq("Alice"), eq("new@example.com"),
                isNull(), isNull(), isNull(), isNull(), eq(1));
        verify(verificationService, never()).consumeProfileProof(anyLong(), any(), any());
    }

    @Test
    void unchangedUnverifiedEmailWithProofMarksVerified() {
        UserDO unverified = existing("old@example.com");
        when(userDao.findById(USER_ID)).thenReturn(unverified);
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("old@example.com")).thenReturn(true);

        service.updateProfile(USER_ID, profileRequest("old@example.com", "awevp_inplace"));

        // 当前邮箱本来未验证：消费 proof 后把该邮箱标记为已验证，首验时间取本次验证时间。
        verify(verificationService).consumeProfileProof(USER_ID, "old@example.com", "awevp_inplace");
        verify(userDao).updateProfileWithEmail(eq(USER_ID), eq("Alice"), eq("old@example.com"),
                isNull(), eq("old@example.com"), any(Date.class), any(Date.class), eq(0));
        verify(userDao, never()).updateProfile(anyLong(), any(), any(), any());
    }

    @Test
    void unchangedVerifiedEmailKeepsFirstVerifiedAt() {
        UserDO verified = existing("old@example.com");
        Date firstVerified = new Date(1_000L);
        verified.setFirstVerifiedAt(firstVerified);
        when(userDao.findById(USER_ID)).thenReturn(verified);
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("old@example.com")).thenReturn(true);

        service.updateProfile(USER_ID, profileRequest("old@example.com", "awevp_again"));

        verify(verificationService).consumeProfileProof(USER_ID, "old@example.com", "awevp_again");
        verify(userDao).updateProfileWithEmail(eq(USER_ID), eq("Alice"), eq("old@example.com"),
                isNull(), eq("old@example.com"), any(Date.class), eq(firstVerified), eq(0));
    }

    @Test
    void unchangedEmailWithoutProofKeepsUnverified() {
        when(userDao.findById(USER_ID)).thenReturn(existing("old@example.com"));
        when(policy.verificationEnabled()).thenReturn(true);

        service.updateProfile(USER_ID, profileRequest("old@example.com", null));

        verify(userDao).updateProfile(USER_ID, "Alice", "old@example.com", null);
        verify(verificationService, never()).consumeProfileProof(anyLong(), any(), any());
    }

    @Test
    void inPlaceVerificationRechecksSuffixPolicyBeforeConsumingProof() {
        when(userDao.findById(USER_ID)).thenReturn(existing("old@example.com"));
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("old@example.com")).thenReturn(false);

        assertEquals("51006", assertThrows(BizException.class, () -> service.updateProfile(
                USER_ID, profileRequest("old@example.com", "awevp_stale"))).getCode());
        verify(verificationService, never()).consumeProfileProof(anyLong(), any(), any());
        verify(userDao, never()).updateProfileWithEmail(anyLong(), anyString(), anyString(),
                any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void profileEmailChangeRejectsNonCompliantDomain() {
        when(userDao.findById(USER_ID)).thenReturn(existing("old@example.com"));
        when(policy.isEmailCompliant("bad@other.com")).thenReturn(false);

        assertEquals("51006", assertThrows(BizException.class, () -> service.updateProfile(
                USER_ID, profileRequest("bad@other.com", null))).getCode());
    }

    @Test
    void profileSnapshotExposesVerificationState() {
        UserDO verified = existing("alice@example.com");
        verified.setVerifiedEmail("alice@example.com");
        verified.setVerifiedAt(new Date());
        when(userDao.findById(USER_ID)).thenReturn(verified);
        when(policy.isEmailVerified(verified)).thenReturn(true);

        UserProfileVO vo = service.getProfile(USER_ID);
        assertTrue(vo.isEmailVerified());
        assertEquals(verified.getVerifiedAt(), vo.getEmailVerifiedAt());

        when(policy.isEmailVerified(verified)).thenReturn(false);
        assertFalse(service.getProfile(USER_ID).isEmailVerified());
    }
}

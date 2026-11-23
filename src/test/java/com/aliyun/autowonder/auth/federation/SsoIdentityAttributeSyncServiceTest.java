package com.aliyun.autowonder.auth.federation;

import com.aliyun.autowonder.im.PlatformImChannelConfigService;
import com.aliyun.autowonder.im.UserImIdentityService;
import com.aliyun.autowonder.user.UserDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SsoIdentityAttributeSyncServiceTest {
    private static final Long USER = 10000L;

    private PlatformImChannelConfigService channelConfigService;
    private UserImIdentityService userImIdentityService;
    private UserDao userDao;
    private SsoIdentityAttributeSyncService service;

    @BeforeEach
    void setUp() {
        channelConfigService = mock(PlatformImChannelConfigService.class);
        userImIdentityService = mock(UserImIdentityService.class);
        userDao = mock(UserDao.class);
        service = new SsoIdentityAttributeSyncService(channelConfigService, userImIdentityService, userDao);
    }

    @Test
    void syncsAValidFeishuIdWhenThePlatformChannelIsFeishu() {
        when(channelConfigService.selectedProvider()).thenReturn("FEISHU");

        service.syncFeishu(USER, connection("feishu_user_id"), identity("f8c21d6a"));

        verify(userImIdentityService).update(USER, "FEISHU", "f8c21d6a", USER);
    }

    @Test
    void skipsWhenTheConnectionHasNoFeishuClaimOrTheAssertionCarriesNoValue() {
        service.syncFeishu(USER, connection(null), identity("f8c21d6a"));
        service.syncFeishu(USER, connection("   "), identity("f8c21d6a"));
        service.syncFeishu(USER, connection("feishu_user_id"), identity("   "));
        service.syncFeishu(USER, connection("feishu_user_id"), identity(null));

        verifyNoInteractions(channelConfigService, userImIdentityService);
    }

    @Test
    void keepsTheExistingIdentityWhenThePlatformChannelIsDingTalk() {
        when(channelConfigService.selectedProvider()).thenReturn("DINGTALK");

        service.syncFeishu(USER, connection("feishu_user_id"), identity("f8c21d6a"));

        verify(userImIdentityService, never()).update(anyLong(), any(), any(), anyLong());
    }

    @Test
    void overlongOrMalformedValuesAreSkippedWithoutTouchingTheIdentity() {
        when(channelConfigService.selectedProvider()).thenReturn("FEISHU");

        service.syncFeishu(USER, connection("feishu_user_id"), identity("x".repeat(257)));

        verify(userImIdentityService, never()).update(anyLong(), any(), any(), anyLong());
    }

    @Test
    void syncFailuresNeverEscapeIntoTheLoginFlow() {
        when(channelConfigService.selectedProvider()).thenReturn("FEISHU");
        doThrow(new IllegalStateException("db down"))
                .when(userImIdentityService).update(eq(USER), eq("FEISHU"), eq("f8c21d6a"), eq(USER));

        service.syncFeishu(USER, connection("feishu_user_id"), identity("f8c21d6a"));
    }

    @Test
    void missingArgumentsAreIgnored() {
        service.syncFeishu(null, connection("feishu_user_id"), identity("f8c21d6a"));
        service.syncFeishu(USER, null, identity("f8c21d6a"));
        service.syncFeishu(USER, connection("feishu_user_id"), null);

        verifyNoInteractions(channelConfigService, userImIdentityService);
    }

    @Test
    void profileSyncUpdatesNicknameAndEmailWhenValuesArePresent() {
        service.syncProfile(USER, profile("  测试张三  ", "  zhangsan@corp.example.com "));

        verify(userDao).updateNickname(USER, "测试张三");
        verify(userDao).updateEmail(USER, "zhangsan@corp.example.com");
    }

    @Test
    void profileSyncKeepsExistingValuesWhenMappedValuesAreMissing() {
        service.syncProfile(USER, profile("   ", null));

        verify(userDao, never()).updateNickname(anyLong(), any());
        verify(userDao, never()).updateEmail(anyLong(), any());
    }

    @Test
    void profileSyncSkipsAnEmailOwnedByAnotherAccountWithoutMerging() {
        doThrow(new DuplicateKeyException("uk_email")).when(userDao).updateEmail(USER, "taken@corp.example.com");

        service.syncProfile(USER, profile("测试张三", "taken@corp.example.com"));

        verify(userDao).updateNickname(USER, "测试张三");
        verify(userDao).updateEmail(USER, "taken@corp.example.com");
    }

    @Test
    void profileSyncSkipsOverlongEmailAndTruncatesOverlongNickname() {
        service.syncProfile(USER, profile("昵".repeat(70), "mail-" + "x".repeat(130) + "@corp.example.com"));

        verify(userDao).updateNickname(USER, "昵".repeat(64));
        verify(userDao, never()).updateEmail(anyLong(), any());
    }

    @Test
    void profileSyncFailuresNeverEscapeIntoTheLoginFlow() {
        doThrow(new IllegalStateException("db down")).when(userDao).updateNickname(anyLong(), any());
        doThrow(new IllegalStateException("db down")).when(userDao).updateEmail(anyLong(), any());

        service.syncProfile(USER, profile("测试张三", "zhangsan@corp.example.com"));
    }

    @Test
    void profileSyncIgnoresMissingArguments() {
        service.syncProfile(null, profile("测试张三", "zhangsan@corp.example.com"));
        service.syncProfile(USER, null);

        verifyNoInteractions(userDao);
    }

    private static FederationConnectionDO connection(String claim) {
        FederationConnectionDO connection = new FederationConnectionDO();
        connection.setId(7L);
        connection.setFeishuUserIdClaim(claim);
        return connection;
    }

    private static ExternalIdentity identity(String feishuUserId) {
        return new ExternalIdentity(7L, "https://idp.example.com", "employee-1",
                "林晓", "lin@corp.example.com", feishuUserId);
    }

    private static ExternalIdentity profile(String displayName, String email) {
        return new ExternalIdentity(7L, "https://idp.example.com", "employee-1", displayName, email);
    }
}

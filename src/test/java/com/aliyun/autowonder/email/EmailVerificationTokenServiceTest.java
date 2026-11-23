package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.redis.RedisManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EmailVerificationTokenServiceTest {

    private RedisManager redis;
    private EmailVerificationTokenService service;

    @BeforeEach
    void setUp() {
        redis = mock(RedisManager.class);
        service = new EmailVerificationTokenService(redis);
    }

    @Test
    void issueRestrictedStoresUserIdWithTtl() {
        String token = service.issueRestricted(42L);
        assertTrue(token.startsWith(EmailVerificationTokenService.RESTRICTED_PREFIX));
        verify(redis).setWithExpire(eq("aw:email:restricted:" + token), eq("42"),
                eq(900L));
    }

    @Test
    void resolveRestrictedRequiresValidStoredValue() {
        assertNull(service.resolveRestricted(null));
        assertNull(service.resolveRestricted("awmcp_x"));

        when(redis.getString("aw:email:restricted:awev_abc")).thenReturn("42");
        assertEquals(42L, service.resolveRestricted("awev_abc"));

        when(redis.getString("aw:email:restricted:awev_bad")).thenReturn("not-a-number");
        assertNull(service.resolveRestricted("awev_bad"));

        when(redis.getString("aw:email:restricted:awev_blank")).thenReturn(" ");
        assertNull(service.resolveRestricted("awev_blank"));
    }

    @Test
    void revokeRestrictedOnlyTouchesRestrictedTokens() {
        service.revokeRestricted("eyJhbGciOi");
        verify(redis, never()).del(anyString());
        service.revokeRestricted("awev_abc");
        verify(redis).del("aw:email:restricted:awev_abc");
    }

    @Test
    void issueProofStoresBoundPayload() {
        String proof = service.issueProof(EmailVerificationPurpose.PROFILE_EMAIL, 7L, "new@example.com");
        assertTrue(proof.startsWith(EmailVerificationTokenService.PROOF_PREFIX));

        org.mockito.ArgumentCaptor<String> payload = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(redis).setWithExpire(eq("aw:email:proof:" + proof), payload.capture(),
                eq(600L));
        EmailVerificationTokenService.ProofPayload stored =
                JSON.parseObject(payload.getValue(), EmailVerificationTokenService.ProofPayload.class);
        assertEquals("PROFILE_EMAIL", stored.getPurpose());
        assertEquals(7L, stored.getUserId());
        assertEquals("new@example.com", stored.getEmail());
    }

    @Test
    void consumeProofAcceptsMatchingBinding() {
        EmailVerificationTokenService.ProofPayload payload = new EmailVerificationTokenService.ProofPayload();
        payload.setPurpose("REGISTER");
        payload.setEmail("user@example.com");
        when(redis.eval(anyString(), anyList(), anyList())).thenReturn(JSON.toJSONString(payload));

        service.consumeProof("awevp_token", EmailVerificationPurpose.REGISTER, null, "User@Example.com");
    }

    @Test
    void consumeProofRejectsWrongBindingOrMissingValue() {
        EmailVerificationTokenService.ProofPayload payload = new EmailVerificationTokenService.ProofPayload();
        payload.setPurpose("REGISTER");
        payload.setEmail("user@example.com");
        when(redis.eval(anyString(), anyList(), anyList())).thenReturn(JSON.toJSONString(payload));

        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                "awevp_token", EmailVerificationPurpose.PROFILE_EMAIL, null, "user@example.com")).getCode());
        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                "awevp_token", EmailVerificationPurpose.REGISTER, null, "other@example.com")).getCode());
        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                "awevp_token", EmailVerificationPurpose.REGISTER, 3L, "user@example.com")).getCode());
    }

    @Test
    void consumeProofRejectsMalformedProofs() {
        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                null, EmailVerificationPurpose.REGISTER, null, "a@b.com")).getCode());
        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                "awmcp_token", EmailVerificationPurpose.REGISTER, null, "a@b.com")).getCode());

        when(redis.eval(anyString(), anyList(), anyList())).thenReturn("not-json");
        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                "awevp_token", EmailVerificationPurpose.REGISTER, null, "a@b.com")).getCode());

        when(redis.eval(anyString(), anyList(), anyList())).thenReturn(null);
        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                "awevp_token", EmailVerificationPurpose.REGISTER, null, "a@b.com")).getCode());

        when(redis.eval(anyString(), anyList(), anyList()))
                .thenThrow(new IllegalStateException("redis down"));
        assertEquals("51008", assertThrows(BizException.class, () -> service.consumeProof(
                "awevp_token", EmailVerificationPurpose.REGISTER, null, "a@b.com")).getCode());
    }
}

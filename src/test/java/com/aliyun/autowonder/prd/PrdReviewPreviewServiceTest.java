package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.email.EmailVerificationPolicyService;
import com.aliyun.autowonder.user.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.ObjectProvider;
import java.net.URI;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PrdReviewPreviewServiceTest {
    @Test void instancesCanShareOneEnvironmentDirectAddressMap() {
        var first = URI.create("http://127.0.0.1:7001");
        var second = URI.create("http://127.0.0.1:7002");
        var firstNode = "node-a.internal";
        var secondNode = "node-b.internal";
        var members = Map.of(firstNode, first, secondNode, second);
        var cluster = new PrdReviewPreviewProperties.Cluster();
        cluster.setNamespace("trial");
        cluster.setNode(firstNode);
        cluster.setPeers(members);
        cluster.validate(URI.create("https://app.example.com"));
        assertEquals(Map.of(secondNode, second), cluster.getPeers());
        cluster.setNode(secondNode);
        cluster.setPeers(members);
        cluster.validate(URI.create("https://app.example.com"));
        assertEquals(Map.of(firstNode, first), cluster.getPeers());
    }

    final PrdReviewPreviewProperties properties=new PrdReviewPreviewProperties();
    final PrdReviewPreviewDao dao=mock(PrdReviewPreviewDao.class);
    final PrdReviewDao reviews=mock(PrdReviewDao.class);
    final PrdReviewService service=mock(PrdReviewService.class);
    final UserDao users=mock(UserDao.class);
    final ObjectProvider<EmailVerificationPolicyService> policy=mock(ObjectProvider.class);
    PrdReviewPreviewService previews;
    PrdDesignRuntimeDO runtime;
    PrdReviewShareDO share;
    PrdReviewPreviewProperties.Binding binding;
    final Map<String,PrdReviewGrantDO> grants=new HashMap<>();
    final PrdReviewTunnelProbe probe=mock(PrdReviewTunnelProbe.class);
    @BeforeEach void setup() {
        when(probe.available(any())).thenReturn(true);
        previews=new PrdReviewPreviewService(properties,dao,reviews,service,users,policy,probe);
        runtime=new PrdDesignRuntimeDO(); runtime.setWorkspaceId(1L); runtime.setWorkitemId(10L); runtime.setConversationId(20L); runtime.setExecutorId(30L);
        runtime.setSourceKey("source"); runtime.setTurnId(50L); runtime.setDispatchAttempt(1); runtime.setReportSequence(3); runtime.setStatus("READY");
        share=new PrdReviewShareDO(); share.setId(70L); share.setVersion(1); when(reviews.shareById(70L)).thenReturn(share); when(service.requireRuntime(share)).thenReturn(runtime);
        binding=new PrdReviewPreviewProperties.Binding(); binding.setId("issued-binding"); binding.setWorkspaceId(1); binding.setWorkitemId(10); binding.setConversationId(20); binding.setExecutorId(30); binding.setSourceKey("source");
        binding.setExecutorConfigPath("/private/preview.json");
        properties.setBindings(List.of(binding));
        var user=new UserDO(); user.setStatus(0); when(users.findById(9L)).thenReturn(user);
        doAnswer(call->{ var grant=call.getArgument(0,PrdReviewGrantDO.class); grants.put(grant.getTokenHash(),grant); return null; }).when(dao).grant(any());
        when(dao.find(anyString())).thenAnswer(call->grants.get(call.getArgument(0)));
        when(dao.consume(anyString())).thenAnswer(call->{ var grant=grants.get(call.getArgument(0)); if(grant.getConsumed()!=null) return 0; grant.setConsumed(1); return 1; });
        doAnswer(call->{ when(dao.tunnel(1L,20L)).thenReturn(call.getArgument(0)); return null; }).when(dao).report(any());
    }
    @Test void unconfiguredOrOfflineDoesNotIssueAnEntry() {
        properties.setBindings(List.of()); assertEquals("UNCONFIGURED",previews.entry(share,9).status());
        properties.setBindings(List.of(binding));
        when(probe.available(binding)).thenReturn(false);
        assertEquals("OFFLINE",previews.entry(share,9).status()); verify(dao,never()).grant(any());
    }
    @Test void isolatedLinkedCliIsUsedForEveryLifecycleInstructionWithoutChangingGlobalCommands() {
        assertTrue(previews.instructions(runtime).contains("autowonder preview start"));
        binding.setExecutorCliPath("/private/linked cli's/bin/autowonder"); properties.validate();
        String command="'/private/linked cli'\\''s/bin/autowonder'";
        String instructions=previews.instructions(runtime);
        for(String action:List.of("--help","start","status","stop")) assertTrue(instructions.contains(command+" preview "+action));
        assertFalse(instructions.contains("\nautowonder preview start"));
        binding.setExecutorCliPath("relative/autowonder"); assertThrows(IllegalArgumentException.class,properties::validate);
        binding.setExecutorCliPath("/private/bin/autowonder\nother"); assertThrows(IllegalArgumentException.class,properties::validate);
    }
    @Test void restoresExistingDesignWithoutInventingATunnelReport() {
        when(service.requireMemberRuntime(binding,9L)).thenReturn(runtime);
        var entry=previews.memberEntry(runtime,9);
        assertEquals("READY",entry.status());
        var cookie=previews.exchange(entry.code(),binding.getId());
        assertEquals("MEMBER_SESSION",previews.authorize(cookie,binding.getId(),"SESSION").getKind());
        verify(dao,never()).report(any());
        when(probe.available(binding)).thenReturn(false);
        assertThrows(BizException.class,()->previews.authorize(cookie,binding.getId(),"SESSION"));
    }
    @Test void memberCanOpenThePreviewWithAScopedSessionWithoutExchangingAnEntryCode() {
        when(service.requireMemberRuntime(binding,9L)).thenReturn(runtime);
        var session=previews.memberSession(runtime,9L);
        assertEquals("READY",session.entry().status());
        assertEquals(binding.basePath(),session.entry().basePath());
        assertNull(session.entry().code());
        assertEquals("MEMBER_SESSION",previews.authorize(session.cookie(),binding.getId(),"SESSION").getKind());
        assertThrows(BizException.class,()->previews.authorize(session.cookie(),"other-binding","SESSION"));
        assertThrows(BizException.class,()->previews.memberSession(runtime,10L));
        when(probe.available(binding)).thenReturn(false);
        var offline=previews.memberSession(runtime,9L);
        assertEquals("OFFLINE",offline.entry().status());
        assertNull(offline.cookie());
    }
    @Test void recoveryRequiresCurrentSourceAndReadyRuntime() {
        runtime.setStatus("STARTING"); assertFalse(previews.ready(runtime,binding));
        runtime.setStatus("READY"); runtime.setSourceKey("another-source"); assertFalse(previews.ready(runtime,binding));
        verify(probe,never()).available(any());
    }
    @Test void liveRegistrationRestoresWithoutAnAiTurnOrNewReport() {
        for(String state:List.of("STOPPED","FAILED","RECONNECTING","STARTING")) {
            previews.report(runtime,binding.getId(),state);
            assertEquals("READY",previews.status(runtime).status());
        }
        previews.report(runtime,binding.getId(),"READY"); runtime.setDispatchAttempt(2);
        assertEquals("READY",previews.status(runtime).status());
        when(probe.available(binding)).thenReturn(false);
        assertEquals("OFFLINE",previews.status(runtime).status());
    }
    @Test void automaticBindingFollowsTheAssignedExecutorAndCurrentSource() {
        var runtimes = mock(PrdDesignRuntimeDao.class);
        properties.setRuntimeDao(runtimes);
        properties.setBindings(List.of());
        runtime.setSourceKey("abcdef123456");
        when(runtimes.find(1L, 20L)).thenReturn(runtime);

        var automatic = properties.forRuntime(runtime);
        assertEquals("/design-preview/auto-1-20-30-abcdef123456/", automatic.basePath());
        assertEquals(automatic, properties.byId(automatic.getId()));
        assertNull(properties.byId("auto-2-20-30-abcdef123456"));
        when(probe.available(automatic)).thenReturn(false);
        assertEquals("RECOVERY_REQUIRED", previews.status(runtime).reason());
        when(probe.available(automatic)).thenReturn(true);
        assertEquals("READY", previews.status(runtime).status());

        runtime.setSourceKey("123456abcdef");
        assertNull(properties.byId(automatic.getId()));
        runtime.setExecutorId(31L);
        assertEquals(31L, properties.forRuntime(runtime).getExecutorId());
        assertNull(properties.byId(automatic.getId()));
    }

    @Test void exchangesOnlyOnceAndRevokesExistingSessionsOnRotationOrAccountDisable() {
        previews.report(runtime,"issued-binding","READY");
        var entry=previews.entry(share,9); assertEquals("READY",entry.status()); assertEquals(properties.getPlatformOrigin(),entry.origin()); assertEquals("/design-preview/issued-binding/",entry.basePath());
        assertThrows(BizException.class,()->previews.exchange(entry.code(),"another-binding"));
        String cookie=previews.exchange(entry.code(),"issued-binding");
        assertEquals(9,previews.authorize(cookie,"issued-binding","SESSION").getUserId());
        assertThrows(BizException.class,()->previews.exchange(entry.code(),"issued-binding"));
        share.setVersion(2); assertThrows(BizException.class,()->previews.authorize(cookie,"issued-binding","SESSION")); share.setVersion(1);
        users.findById(9L).setStatus(1); assertThrows(BizException.class,()->previews.authorize(cookie,"issued-binding","SESSION"));
    }
    @Test void reportsAreBoundToProvisionedExecutorAndAttempt() {
        assertThrows(BizException.class,()->previews.report(runtime,"https://arbitrary.example/","READY"));
        previews.report(runtime,"issued-binding","READY"); assertTrue(previews.ready(runtime,binding));
        runtime.setTurnId(51L); assertTrue(previews.ready(runtime,binding));
        runtime.setExecutorId(31L); assertThrows(BizException.class,()->previews.report(runtime,"issued-binding","READY"));
        assertEquals("UNCONFIGURED",previews.entry(share,9).status());
    }
    @Test void unreachableTunnelReturnsOfflineWithoutIssuingEntryAndRecoversWithoutAReport() {
        previews.report(runtime,"issued-binding","READY");
        when(probe.available(binding)).thenReturn(false);
        assertEquals("OFFLINE",previews.status(share).status());
        assertEquals("OFFLINE",previews.entry(share,9).status()); verify(dao,never()).grant(any());
        when(probe.available(binding)).thenReturn(true);
        assertEquals("READY",previews.status(share).status());
        assertEquals("READY",previews.entry(share,9).status());
    }
    @Test void previewUsesPlatformPathsWithoutAcceptingCredentialOrPathOrigins() {
        properties.validate();
        assertSame(binding,properties.forPath("/design-preview/issued-binding/assets/app.js"));
        assertNull(properties.forPath("/design-preview/another/"));
        assertNull(properties.forPath("/api/auth/login"));
        assertThrows(IllegalArgumentException.class,()->PrdReviewPreviewProperties.origin("https://user:secret@preview.example"));
        assertThrows(IllegalArgumentException.class,()->PrdReviewPreviewProperties.origin("https://preview.example/path"));
    }
    @Test void privateWorkbenchPreviewDoesNotEnableSharingAndRechecksMembership() {
        previews.report(runtime,"issued-binding","READY");
        when(service.requireMemberRuntime(binding,9L)).thenReturn(runtime);
        var entry=previews.memberEntry(runtime,9);
        String cookie=previews.exchange(entry.code(),binding.getId());
        var grant=previews.authorize(cookie,binding.getId(),"SESSION");
        assertEquals("MEMBER_SESSION",grant.getKind()); assertEquals(0L,grant.getShareId());
        verifyNoInteractions(reviews);
        when(service.requireMemberRuntime(binding,9L)).thenThrow(PrdReviewService.unavailable());
        assertThrows(BizException.class,()->previews.authorize(cookie,binding.getId(),"SESSION"));
    }
    @Test void renewalKeepsTheSameSessionForHmrAndRequiresAFreshOneUseEntry() {
        when(service.requireMemberRuntime(binding,9L)).thenReturn(runtime);
        when(dao.renew(anyString(),any())).thenAnswer(call->{ grants.get(call.getArgument(0)).setExpiresAt(call.getArgument(1)); return 1; });
        for(boolean member:List.of(false,true)) {
            var first=member?previews.memberEntry(runtime,9):previews.entry(share,9);
            String cookie=previews.exchange(first.code(),binding.getId());
            var session=previews.authorize(cookie,binding.getId(),"SESSION");
            session.setExpiresAt(new Date(System.currentTimeMillis()+1000));
            var next=member?previews.memberEntry(runtime,9):previews.entry(share,9);
            assertEquals(cookie,previews.renew(next.code(),cookie,binding.getId()));
            assertSame(session,previews.authorize(cookie,binding.getId(),"SESSION"));
            assertTrue(session.getExpiresAt().getTime()>System.currentTimeMillis()+14*60_000);
            assertThrows(BizException.class,()->previews.renew(next.code(),cookie,binding.getId()));
        }
    }
    @Test void renewalCannotAdoptAnotherUsersOrSharesSessionOrAnExpiredSession() {
        when(service.requireMemberRuntime(binding,9L)).thenReturn(runtime);
        String cookie=previews.exchange(previews.entry(share,9).code(),binding.getId());
        var memberEntry=previews.memberEntry(runtime,9);
        assertThrows(BizException.class,()->previews.renew(memberEntry.code(),cookie,binding.getId()));
        var entry=previews.entry(share,9);
        var session=previews.authorize(cookie,binding.getId(),"SESSION");
        session.setUserId(10L); var other=new UserDO(); other.setStatus(0); when(users.findById(10L)).thenReturn(other);
        assertThrows(BizException.class,()->previews.renew(entry.code(),cookie,binding.getId()));
        session.setUserId(9L); when(dao.find(session.getTokenHash())).thenReturn(null);
        assertThrows(BizException.class,()->previews.renew(entry.code(),cookie,binding.getId()));
        verify(dao,never()).renew(anyString(),any());
    }
}

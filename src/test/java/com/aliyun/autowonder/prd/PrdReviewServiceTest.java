package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.user.*;
import com.aliyun.autowonder.workitem.*;
import com.aliyun.autowonder.workspace.*;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.*;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real SQL: ownership, source boundaries, replay, optimistic updates and share rotation. */
class PrdReviewServiceTest {
    SqlSession session;
    PrdReviewDao dao;
    PrdReviewService service;
    final PrdDesignRuntimeService runtimes=mock(PrdDesignRuntimeService.class);
    final PrdDesignRuntimeDao runtimeDao=mock(PrdDesignRuntimeDao.class);
    final PrdDesignDao designs=mock(PrdDesignDao.class);
    final WorkspaceMemberDao members=mock(WorkspaceMemberDao.class);
    final WorkitemDao workitems=mock(WorkitemDao.class);
    final WorkspaceDao workspaces=mock(WorkspaceDao.class);
    final UserDao users=mock(UserDao.class);
    PrdDesignRuntimeDO runtime;
    @BeforeEach void setup() throws Exception {
        var ds=new UnpooledDataSource("org.h2.Driver","jdbc:h2:mem:review"+System.nanoTime()+";MODE=MySQL;DB_CLOSE_DELAY=-1","sa","");
        var config=new Configuration(new Environment("test",new JdbcTransactionFactory(),ds));
        config.setMapUnderscoreToCamelCase(true); config.addMapper(PrdReviewDao.class); config.addMapper(PrdReviewPreviewDao.class);
        session=new SqlSessionFactoryBuilder().build(config).openSession(true);
        try (var statement = session.getConnection().createStatement()) {
            statement.execute(PrdDesignSchemaBootstrap.CREATE_DESIGN_TABLE);
        }
        ScriptUtils.executeSqlScript(session.getConnection(),new ClassPathResource("schema/prd-review.sql"));
        dao=session.getMapper(PrdReviewDao.class);
        service=new PrdReviewService(dao,runtimes,runtimeDao,designs,workitems,workspaces,members,users);
        runtime=new PrdDesignRuntimeDO(); runtime.setWorkspaceId(1L); runtime.setWorkitemId(10L); runtime.setConversationId(20L);
        runtime.setSourceKey(PrdDesignRuntimeService.sourceKey(null)); runtime.setExecutorId(30L); runtime.setRevision(5L); runtime.setPort(5174);
        runtime.setDirectory("private-executor-directory"); runtime.setTurnId(50L); runtime.setDispatchAttempt(1); runtime.setReportSequence(2); runtime.setStatus("READY"); runtime.setRoute("/");
        when(runtimes.current(any())).thenReturn(true); when(runtimes.get(1L,10L,40L)).thenReturn(runtime); when(runtimeDao.find(1L,20L)).thenReturn(runtime);
        var workitem=new WorkitemDO(); workitem.setId(10L); workitem.setTenantId(1L); workitem.setTitle("Product design");
        when(workitems.findById(10L)).thenReturn(workitem); when(workspaces.countUsable(1L)).thenReturn(1L);
        when(workitems.findByIdForUpdate(10L, 1L)).thenReturn(workitem);
        var owner=new WorkspaceMemberDO(); owner.setAccessLevel("READ_WRITE"); owner.setStatus(0); owner.setIsDeleted(0);
        when(members.findByWorkspaceAndUser(1L,7L)).thenReturn(owner);
    }
    @Test void memberPreviewRequiresCurrentMembershipAndMatchingExecutorWithoutCreatingAShare() {
        var binding=new PrdReviewPreviewProperties.Binding(); binding.setWorkspaceId(1L); binding.setWorkitemId(10L);
        binding.setConversationId(20L); binding.setExecutorId(30L); binding.setSourceKey(runtime.getSourceKey());
        assertSame(runtime,service.requireMemberRuntime(binding,7L));
        assertNull(dao.share(1L,20L,runtime.getSourceKey()));
        assertThrows(BizException.class,()->service.requireMemberRuntime(binding,9L));
        var member=members.findByWorkspaceAndUser(1L,7L); member.setAccessLevel("READ_ONLY");
        assertSame(runtime,service.requireMemberRuntime(binding,7L));
        member.setIsDeleted(1); assertThrows(BizException.class,()->service.requireMemberRuntime(binding,7L));
        member.setIsDeleted(0); member.setStatus(1); assertThrows(BizException.class,()->service.requireMemberRuntime(binding,7L));
        member.setStatus(0); binding.setExecutorId(31L); assertThrows(BizException.class,()->service.requireMemberRuntime(binding,7L));
    }
    @Test void movedExecutorInvalidatesSharedRuntimeAccess() {
        var share=service.enable(1L,10L,40L,7L,false);
        when(runtimes.current(runtime)).thenReturn(false);
        assertThrows(BizException.class,()->service.sharedContext(share.getToken(),99L));
    }
    @AfterEach void close() { session.close(); }
    PrdReviewService.CommentInput input(String client,String text) {
        return new PrdReviewService.CommentInput(text,new PrdPrototypeSelection.Element("/settings?q=1#save","#save",null,null,"button","Save"),client);
    }
    @Test void outsiderCanCommentButCannotManageAnotherAuthorsComment() {
        var mine=service.create(runtime,9L,input("one","Make it larger")).comment();
        assertEquals(1,service.sharedContext(service.enable(1,10,40L,7,false).getToken(),9).comments().size());
        assertThrows(BizException.class,()->service.update(runtime,8L,mine.getId(),new PrdReviewService.CommentUpdate("attack",null,0),false));
        assertThrows(BizException.class,()->service.update(runtime,8L,mine.getId(),new PrdReviewService.CommentUpdate(null,"resolved",0),false));
        var resolved=service.update(runtime,9L,mine.getId(),new PrdReviewService.CommentUpdate(null,"resolved",0),false).comment();
        assertEquals("resolved",resolved.getStatus()); assertEquals(1,resolved.getVersion());
        assertThrows(BizException.class,()->service.update(runtime,9L,mine.getId(),new PrdReviewService.CommentUpdate("stale",null,0),false));
        service.update(runtime,7L,mine.getId(),new PrdReviewService.CommentUpdate(null,"open",1),false);
        assertThrows(BizException.class,()->service.update(runtime,7L,mine.getId(),new PrdReviewService.CommentUpdate("owner cannot edit",null,2),false));
        service.update(runtime,7L,mine.getId(),new PrdReviewService.CommentUpdate(null,null,2),true);
        assertNull(dao.comment(1,mine.getId()));
    }
    @Test void creationIsIdempotentAndReferencesAreScopedAndFrozen() {
        var first=service.create(runtime,9,input("one","Original")).comment();
        assertEquals(first.getId(),service.create(runtime,9,input("one","Original")).comment().getId());
        assertThrows(BizException.class,()->service.create(runtime,9,input("one","Changed replay")));
        var frozen=service.references(1,10,20,List.of(first.getId()));
        service.update(runtime,9,first.getId(),new PrdReviewService.CommentUpdate("Updated",null,0),false);
        assertEquals("Original",frozen.getFirst().getCommentText());
        service.sent(1,frozen,99); assertEquals(99,dao.comment(1,first.getId()).getLastSentTurnId());
        assertEquals("open",dao.comment(1,first.getId()).getStatus());
        assertThrows(BizException.class,()->service.references(1,11,20,List.of(first.getId())));
        assertThrows(BizException.class,()->service.references(1,10,20,List.of(first.getId(),first.getId())));
        assertThrows(BizException.class,()->service.references(2,10,20,List.of(first.getId())));
    }
    @Test void fiftyLargeSnapshotsHaveBoundedHistoryCardsWithoutTruncatingExecutorInput() throws Exception {
        var text="\u0001".repeat(9998)+"😀";
        var snapshot=new PrdReviewService.CommentSnapshot(91L,text,"/"+"页".repeat(2000),
                "{\"selector\":\""+"a".repeat(999)+"\",\"domSnapshot\":{\"html\":\"private DOM\"}}", "source",8L,2);
        var cards=PrdReviewService.historyReferences(Collections.nCopies(50,snapshot));
        var mapper=new com.fasterxml.jackson.databind.ObjectMapper();
        var turn=new com.aliyun.autowonder.conversation.AgentConversationTurnDO();turn.setId(1L);
        turn.setSourceContext(mapper.writeValueAsString(Map.of("reviewComments",cards)));
        var page=com.aliyun.autowonder.conversation.ConversationTurnHistory.bounded(
                new com.aliyun.autowonder.conversation.ConversationTurnHistory.Page<>(List.of(turn),false,null));
        assertEquals(50,cards.size()); assertTrue(mapper.writeValueAsBytes(page).length<240*1024);
        assertEquals(text,snapshot.getCommentText());
        assertFalse(turn.getSourceContext().contains("private DOM"));
        assertTrue(((String)cards.getFirst().get("commentText")).endsWith("…"));
    }
    @Test void sharingDoesNotExposePrivateRuntimeAndRotationRevokesOldLinks() {
        assertThrows(BizException.class,()->service.enable(1,10,40L,9,false));
        var first=service.enable(1,10,40L,7,false);
        assertEquals(first.getToken(),service.enable(1,10,40L,7,false).getToken());
        var context=service.sharedContext(first.getToken(),9);
        assertFalse(context.canManage()); assertNull(context.runtime().getDirectory()); assertNull(context.runtime().getExecutorId()); assertNull(context.runtime().getPort()); assertNull(context.runtime().getError());
        var rotated=service.enable(1,10,40L,7,true); assertNotEquals(first.getToken(),rotated.getToken());
        assertThrows(BizException.class,()->service.requireShare(first.getToken()));
        service.revoke(1,10,40L,7); assertThrows(BizException.class,()->service.requireShare(rotated.getToken()));
    }
    @Test void sourceChangeRetainsOldCommentsButCannotApplyOrShareThem() {
        var comment=service.create(runtime,9,input("one","Old source")).comment();
        var share=service.enable(1,10,40L,7,false);
        runtime.setSourceKey("new-source");
        assertThrows(BizException.class,()->service.requireShare(share.getToken()));
        assertTrue(service.context(1,10,40L,7).comments().getFirst().earlierSource());
        assertThrows(BizException.class,()->service.update(runtime,9,comment.getId(),new PrdReviewService.CommentUpdate("new",null,0),false));
        assertThrows(BizException.class,()->service.references(1,10,20,List.of(comment.getId())));
    }
    @Test void namedLinkUsesTheSameShareAndMustBeExplicitlyReactivated() {
        assertThrows(BizException.class, () -> service.saveName(1, 10, 40L, 7, "Needs-Review"));
        var first = service.enable(1, 10, 40L, 7, false);
        assertEquals("checkout-review", service.saveName(1, 10, 40L, 7, "checkout-review").slug());
        assertThrows(BizException.class, () -> service.saveName(1, 10, 40L, 7, "other-name"));
        assertEquals(first.getId(), service.requireShare("checkout-review").getId());
        var rotated = service.enable(1, 10, 40L, 7, true);
        assertEquals(rotated.getId(), service.requireShare("checkout-review").getId());
        assertThrows(BizException.class, () -> service.requireShare(first.getToken()));
        service.revoke(1, 10, 40L, 7);
        assertThrows(BizException.class, () -> service.requireShare("checkout-review"));
        assertThrows(BizException.class, () -> service.enable(1, 10, 40L, 7, false));
        var restored = service.enable(1, 10, 40L, 7, false, true);
        assertEquals(restored.getId(), service.requireShare("checkout-review").getId());
    }
    @Test void canReserveNameBeforePreviewOrSharingExists() {
        when(runtimes.get(1L, 10L, 40L)).thenReturn(null);
        assertEquals("checkout-review", service.saveName(1, 10, 40L, 7, "checkout-review").slug());
        assertEquals("checkout-review", service.name(1, 10));
        assertFalse(service.nameWasShared(1, 10));
        assertNull(dao.share(1, 20, runtime.getSourceKey()));
        assertThrows(BizException.class, () -> service.requireShare("checkout-review"));

        when(runtimes.get(1L, 10L, 40L)).thenReturn(runtime);
        var share = service.enable(1, 10, 40L, 7, false);
        assertEquals(share.getId(), service.requireShare("checkout-review").getId());
        assertEquals(share.getId(), service.requireShare(share.getToken()).getId());
    }
    @Test void readOnlyPrdMembersCannotManageSharing() {
        var member=members.findByWorkspaceAndUser(1L,7L); member.setReadOnlyDomains("[\"PRD\"]");
        assertFalse(service.canManage(1,7)); assertThrows(BizException.class,()->service.enable(1,10,40L,7,false));
        for(String route:List.of("//evil.test","/\\evil.test","/bad\n")) assertThrows(BizException.class,()->PrdReviewService.route(route));
    }
}

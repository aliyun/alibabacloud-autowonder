package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.access.*;
import com.aliyun.autowonder.common.error.*;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.user.UserDao;
import com.aliyun.autowonder.workitem.WorkitemDao;
import com.aliyun.autowonder.workspace.WorkspaceDao;
import com.aliyun.autowonder.workspace.WorkspaceMemberDao;
import org.springframework.stereotype.Service;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;
import java.security.SecureRandom;
import java.util.*;

@Service
public class PrdReviewService {
    private static final java.util.regex.Pattern SHARE_NAME =
            java.util.regex.Pattern.compile("[a-z0-9][a-z0-9-]{1,38}[a-z0-9]");
    private final PrdReviewDao dao;
    private final PrdDesignRuntimeService runtimes;
    private final PrdDesignRuntimeDao runtimeDao;
    private final PrdDesignDao designs;
    private final WorkitemDao workitems;
    private final WorkspaceDao workspaces;
    private final WorkspaceMemberDao members;
    private final UserDao users;
    private static final SecureRandom RANDOM = new SecureRandom();

    public PrdReviewService(PrdReviewDao dao, PrdDesignRuntimeService runtimes, PrdDesignRuntimeDao runtimeDao,
            PrdDesignDao designs, WorkitemDao workitems, WorkspaceDao workspaces, WorkspaceMemberDao members, UserDao users) {
        this.dao=dao; this.runtimes=runtimes; this.runtimeDao=runtimeDao; this.designs=designs;
        this.workitems=workitems; this.workspaces=workspaces; this.members=members; this.users=users;
    }

    public record CommentInput(String commentText, PrdPrototypeSelection.Element element, String clientId,Map<String,Object> domSnapshot) {
        public CommentInput(String commentText,PrdPrototypeSelection.Element element,String clientId) { this(commentText,element,clientId,null); }
    }
    public record CommentUpdate(String commentText, String status, Integer version) {}
    public record CommentView(PrdReviewCommentDO comment, String authorName, String authorAvatar,
            boolean canEdit, boolean canDelete, boolean canUpdateStatus, boolean earlierSource) {}
    public record Context(String title, long workitemId, long viewerId, PrdDesignRuntimeDO runtime,
            String sourceKey, boolean canManage, List<CommentView> comments) {}
    @lombok.Value
    public static class CommentSnapshot {
        Long id; String commentText; String routePath; String elementJson; String sourceKey; Long runtimeRevision; Integer version;
    }

    public PrdDesignRuntimeDO runtime(long workspaceId, long workitemId, Long agentId) {
        var runtime = runtimes.get(workspaceId, workitemId, agentId);
        if (runtime == null) throw failure(ErrorCode.CONFLICT, "prd.review.no_runtime");
        return runtime;
    }

    public Context context(long workspaceId, long workitemId, Long agentId, long actor) {
        return context(runtime(workspaceId,workitemId,agentId), actor, false);
    }

    public Context sharedContext(String token, long actor) {
        var share = requireShare(token);
        return context(requireRuntime(share), actor, true);
    }

    private Context context(PrdDesignRuntimeDO runtime, long actor, boolean shared) {
        var workitem = workitems.findById(runtime.getWorkitemId());
        if (workitem == null || !Objects.equals(workitem.getTenantId(),runtime.getWorkspaceId())) throw unavailable();
        boolean manage = canManage(runtime.getWorkspaceId(),actor);
        // The public DTO deliberately excludes executor directories, errors and dispatch ownership.
        var projected = new PrdDesignRuntimeDO();
        projected.setConversationId(runtime.getConversationId()); projected.setSourceKey(runtime.getSourceKey());
        projected.setStatus(runtime.getStatus()); projected.setRevision(runtime.getRevision()); projected.setRoute(runtime.getRoute());
        if (!shared) { projected.setPort(runtime.getPort()); projected.setExecutorId(runtime.getExecutorId()); }
        var comments = dao.comments(runtime.getWorkspaceId(),runtime.getWorkitemId(),runtime.getConversationId()).stream()
                .filter(c -> !shared || Objects.equals(c.getSourceKey(),runtime.getSourceKey()))
                .map(c -> view(c,actor,manage,runtime.getSourceKey())).toList();
        return new Context(workitem.getTitle(),workitem.getId(),actor,projected,runtime.getSourceKey(),manage,comments);
    }

    public PrdReviewShareDO share(long workspaceId, long workitemId, Long agentId) {
        var runtime=runtime(workspaceId,workitemId,agentId);
        return dao.share(workspaceId,runtime.getConversationId(),runtime.getSourceKey());
    }

    public String name(long workspaceId, long workitemId) {
        return dao.name(workspaceId, workitemId);
    }

    public boolean nameWasShared(long workspaceId, long workitemId) {
        return dao.namedShare(workspaceId, workitemId) != null;
    }

    public String preferredIdentifier(PrdReviewShareDO share) {
        if (share == null || !Integer.valueOf(1).equals(share.getEnabled())) return null;
        return Objects.requireNonNullElse(dao.boundName(share.getWorkspaceId(), share.getWorkitemId(),
                share.getId()), share.getToken());
    }

    public record NameView(String slug, boolean canManage) {}

    @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public NameView saveName(long workspaceId, long workitemId, Long agentId, long actor, String slug) {
        requireManage(workspaceId, actor);
        if (slug == null || !SHARE_NAME.matcher(slug).matches())
            throw failure(ErrorCode.PARAM_INVALID, "prd.review_name.invalid");
        var workitem = workitems.findByIdForUpdate(workitemId, workspaceId);
        if (workitem == null || !Objects.equals(workitem.getTenantId(), workspaceId)) throw unavailable();
        String current = dao.name(workspaceId, workitemId);
        if (slug.equals(current)) return new NameView(slug, true);
        if (current != null) throw failure(ErrorCode.CONFLICT, "prd.review_name.fixed");
        dao.ensureDesignForName(workspaceId, workitemId, actor);
        try {
            if (dao.setName(workspaceId, workitemId, slug) == 0)
                throw failure(ErrorCode.CONFLICT, "prd.review_name.fixed");
        } catch (DuplicateKeyException e) {
            throw failure(ErrorCode.CONFLICT, "prd.review_name.taken");
        }
        var runtime = runtimes.get(workspaceId, workitemId, agentId);
        if (runtime != null) {
            var active = dao.share(workspaceId, runtime.getConversationId(), runtime.getSourceKey());
            if (active != null && Integer.valueOf(1).equals(active.getEnabled())) {
                dao.bindName(workspaceId, workitemId, active.getId());
            }
        }
        return new NameView(slug, true);
    }

    @Transactional
    public PrdReviewShareDO enable(long workspaceId,long workitemId,Long agentId,long actor,boolean rotate) {
        return enable(workspaceId, workitemId, agentId, actor, rotate, false);
    }

    @Transactional
    public PrdReviewShareDO enable(long workspaceId, long workitemId, Long agentId, long actor,
                                   boolean rotate, boolean confirmNamed) {
        requireManage(workspaceId,actor);
        var workitem = workitems.findByIdForUpdate(workitemId, workspaceId);
        if (workitem == null || !Objects.equals(workitem.getTenantId(), workspaceId)) throw unavailable();
        var runtime=runtime(workspaceId,workitemId,agentId);
        var current=dao.share(workspaceId,runtime.getConversationId(),runtime.getSourceKey());
        boolean active = current != null && Integer.valueOf(1).equals(current.getEnabled());
        Long namedShare = dao.namedShare(workspaceId, workitemId);
        if (rotate && !active) throw unavailable();
        if (!rotate && namedShare != null && !(active && namedShare.equals(current.getId())) && !confirmNamed) {
            throw failure(ErrorCode.CONFLICT, "prd.review_name.restore_confirmation");
        }
        if (!rotate && active) {
            dao.bindName(workspaceId, workitemId, current.getId());
            return current;
        }
        var row=new PrdReviewShareDO(); row.setWorkspaceId(workspaceId); row.setWorkitemId(workitemId);
        row.setConversationId(runtime.getConversationId()); row.setSourceKey(runtime.getSourceKey());
        row.setToken(randomToken()); row.setCreatorId(actor); dao.enable(row);
        current = dao.share(workspaceId,runtime.getConversationId(),runtime.getSourceKey());
        if (!rotate) dao.bindName(workspaceId, workitemId, current.getId());
        return current;
    }

    @Transactional
    public void revoke(long workspaceId,long workitemId,Long agentId,long actor) {
        requireManage(workspaceId,actor);
        if (workitems.findByIdForUpdate(workitemId, workspaceId) == null) throw unavailable();
        var share=share(workspaceId,workitemId,agentId);
        if (share!=null) dao.revoke(workspaceId,share.getId());
    }

    public PrdReviewShareDO requireShare(String token) {
        if (token == null) throw unavailable();
        var share = SHARE_NAME.matcher(token).matches() ? dao.byName(token)
                : token.matches("[A-Za-z0-9_-]{43}") ? dao.byToken(token) : null;
        if (share==null) throw unavailable();
        requireRuntime(share);
        return share;
    }

    public PrdDesignRuntimeDO requireRuntime(PrdReviewShareDO share) {
        var workitem=workitems.findById(share.getWorkitemId());
        if (workspaces.countUsable(share.getWorkspaceId())==0 || workitem==null
                || !Objects.equals(workitem.getTenantId(),share.getWorkspaceId())
                || Integer.valueOf(1).equals(workitem.getIsDeleted())) throw unavailable();
        var runtime=runtimeDao.find(share.getWorkspaceId(),share.getConversationId());
        if (runtime==null || !runtimes.current(runtime) || !Objects.equals(runtime.getWorkitemId(),share.getWorkitemId())
                || !Objects.equals(runtime.getSourceKey(),share.getSourceKey())
                || !Objects.equals(share.getSourceKey(),PrdDesignRuntimeService.sourceKey(designs.findByWorkitem(share.getWorkspaceId(),share.getWorkitemId())))) throw unavailable();
        return runtime;
    }

    /** A private workbench preview requires current membership; it never enables a share link. */
    public PrdDesignRuntimeDO requireMemberRuntime(PrdReviewPreviewProperties.Binding binding,long actor) {
        var member=members.findByWorkspaceAndUser(binding.getWorkspaceId(),actor);
        if(member==null || !Integer.valueOf(0).equals(member.getStatus()) || !Integer.valueOf(0).equals(member.getIsDeleted())
                || !Set.of("ADMIN","READ_WRITE","READ_ONLY").contains(Objects.toString(member.getAccessLevel(),""))) throw unavailable();
        var scope=new PrdReviewShareDO(); scope.setWorkspaceId(binding.getWorkspaceId()); scope.setWorkitemId(binding.getWorkitemId());
        scope.setConversationId(binding.getConversationId()); scope.setSourceKey(binding.getSourceKey());
        var runtime=requireRuntime(scope);
        if(!binding.matches(runtime)) throw unavailable();
        return runtime;
    }

    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public CommentView create(PrdDesignRuntimeDO runtime,long actor,CommentInput input) {
        if (input==null) throw invalid();
        var element=PrdPrototypeSelection.validate(input.element());
        if (element==null) throw invalid();
        String route=route(element.page());
        String text=text(input.commentText());
        if(input.clientId()==null || !input.clientId().matches("[A-Za-z0-9_-]{1,100}")) throw invalid();
        var row=new PrdReviewCommentDO();
        row.setWorkspaceId(runtime.getWorkspaceId()); row.setWorkitemId(runtime.getWorkitemId());
        row.setConversationId(runtime.getConversationId()); row.setSourceKey(runtime.getSourceKey());
        row.setRuntimeRevision(runtime.getRevision()); row.setCreatorId(actor); row.setClientId(input.clientId());
        var snapshot=new LinkedHashMap<String,Object>(element.normalized());
        if(input.domSnapshot()!=null) {
            if(JSON.toJSONString(input.domSnapshot()).length()>16000) throw invalid();
            snapshot.put("domSnapshot",input.domSnapshot());
        }
        row.setRoutePath(route); row.setSelector(element.selector()); row.setElementJson(JSON.toJSONString(snapshot)); row.setCommentText(text);
        var replay=dao.replay(row);
        if(replay!=null) {
            if (!Objects.equals(replay.getCommentText(),text) || !Objects.equals(replay.getElementJson(),row.getElementJson()) || Integer.valueOf(1).equals(replay.getIsDeleted())) throw failure(ErrorCode.CONFLICT,"prd.review.changed");
            return view(replay,actor,canManage(row.getWorkspaceId(),actor),runtime.getSourceKey());
        }
        dao.insert(row);
        var created=dao.replay(row);
        if(created==null || !Objects.equals(created.getCommentText(),text) || !Objects.equals(created.getElementJson(),row.getElementJson()) || Integer.valueOf(1).equals(created.getIsDeleted())) throw failure(ErrorCode.CONFLICT,"prd.review.changed");
        return view(created,actor,canManage(row.getWorkspaceId(),actor),runtime.getSourceKey());
    }

    @Transactional
    public CommentView update(PrdDesignRuntimeDO runtime,long actor,long id,CommentUpdate input,boolean delete) {
        var row=owned(runtime,id,true);
        boolean author=Objects.equals(row.getCreatorId(),actor), manage=canManage(runtime.getWorkspaceId(),actor);
        if (input==null || input.version()==null || !Objects.equals(input.version(),row.getVersion())) throw failure(ErrorCode.CONFLICT,"prd.review.changed");
        if(!delete && input.commentText()==null && input.status()==null) throw invalid();
        if (delete ? !author&&!manage : ((!author && input.commentText()!=null) || (!author&&!manage && input.status()!=null))) throw new BizException(ErrorCode.NO_PERMISSION);
        if (input.commentText()!=null) row.setCommentText(text(input.commentText()));
        if (input.status()!=null) {
            if (!Set.of("open","resolved").contains(input.status())) throw invalid();
            row.setStatus(input.status());
        }
        row.setIsDeleted(delete?1:0);
        if (dao.update(row)!=1) throw failure(ErrorCode.CONFLICT,"prd.review.changed");
        row.setVersion(row.getVersion()+1);
        return view(row,actor,manage,runtime.getSourceKey());
    }

    /** Freeze authoritative comment content in the same transaction as conversation submission. */
    public List<CommentSnapshot> references(long workspaceId,long workitemId,long conversationId,List<Long> ids) {
        if(ids==null || ids.isEmpty()) return List.of();
        if(ids.size()>50 || ids.stream().anyMatch(Objects::isNull) || new HashSet<>(ids).size()!=ids.size()) throw invalid();
        var runtime=runtimeDao.find(workspaceId,conversationId);
        if (runtime==null || !Objects.equals(runtime.getWorkitemId(),workitemId)
                || !Objects.equals(runtime.getSourceKey(),PrdDesignRuntimeService.sourceKey(designs.findByWorkitem(workspaceId,workitemId)) )) throw unavailable();
        return ids.stream().map(id->owned(runtime,id,true)).map(row -> new CommentSnapshot(row.getId(),row.getCommentText(),row.getRoutePath(),row.getElementJson(),row.getSourceKey(),row.getRuntimeRevision(),row.getVersion())).toList();
    }

    public void sent(long workspaceId,List<CommentSnapshot> comments,long turnId) {
        comments.forEach(c->dao.sent(workspaceId,c.getId(),turnId));
    }

    /** Bounded history cards; the complete immutable snapshots remain in reviewComments. */
    public static List<Map<String,Object>> historyReferences(List<CommentSnapshot> comments) {
        return comments.stream().map(comment -> Map.<String,Object>of(
                "id",comment.getId(),"commentText",preview(comment.getCommentText(),192),
                "routePath",preview(comment.getRoutePath(),160),
                "element",Map.of("selector",preview(JSON.parseObject(comment.getElementJson()).getString("selector"),128)),
                "version",comment.getVersion(),"sourceKey",comment.getSourceKey(),"runtimeRevision",comment.getRuntimeRevision())).toList();
    }
    private static String preview(String value,int limit) {
        if(value.length()<=limit) return value;
        int end=Character.isHighSurrogate(value.charAt(limit-1))?limit-1:limit;
        return value.substring(0,end)+"…";
    }

    private PrdReviewCommentDO owned(PrdDesignRuntimeDO runtime,long id,boolean currentSource) {
        var row=dao.comment(runtime.getWorkspaceId(),id);
        if(row==null || !Objects.equals(row.getWorkitemId(),runtime.getWorkitemId())
                || !Objects.equals(row.getConversationId(),runtime.getConversationId())
                || (currentSource && !Objects.equals(row.getSourceKey(),runtime.getSourceKey()))) throw unavailable();
        return row;
    }

    public boolean canManage(long workspaceId,long actor) {
        var member=members.findByWorkspaceAndUser(workspaceId,actor);
        if(member==null || !Integer.valueOf(0).equals(member.getStatus()) || !Integer.valueOf(0).equals(member.getIsDeleted())) return false;
        if("ADMIN".equals(member.getAccessLevel())) return true;
        return "READ_WRITE".equals(member.getAccessLevel()) && !WorkspaceDomain.fromJson(member.getReadOnlyDomains()).contains(WorkspaceDomain.PRD);
    }
    private void requireManage(long workspaceId,long actor) { if(!canManage(workspaceId,actor)) throw new BizException(ErrorCode.NO_PERMISSION); }
    private CommentView view(PrdReviewCommentDO row,long actor,boolean manage,String sourceKey) {
        var user=users.findById(row.getCreatorId());
        boolean author=Objects.equals(row.getCreatorId(),actor);
        return new CommentView(row,user==null?Long.toString(row.getCreatorId()):Objects.toString(user.getNickname(),user.getUsername()),
                user==null?null:user.getAvatarUrl(),author,author||manage,author||manage,!Objects.equals(sourceKey,row.getSourceKey()));
    }
    public static String route(String value) {
        if(value==null || !value.startsWith("/") || value.startsWith("//") || value.contains("\\") || value.length()>2048 || value.chars().anyMatch(Character::isISOControl)) throw invalid();
        return value;
    }
    private static String text(String value) { if(value==null || value.isBlank() || value.length()>10000 || value.indexOf('\0')>=0) throw invalid(); return value.trim(); }
    public static String randomToken() { byte[] bytes=new byte[32]; RANDOM.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    static BizException unavailable() { return failure(ErrorCode.NOT_FOUND,"prd.review.unavailable"); }
    static BizException invalid() { return failure(ErrorCode.PARAM_INVALID,"prd.review.invalid"); }
    static BizException failure(ErrorCode code,String key) { return BizException.keyed(code,key,null,key); }
}

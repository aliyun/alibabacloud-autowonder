package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.email.EmailVerificationPolicyService;
import com.aliyun.autowonder.user.UserDao;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class PrdReviewPreviewService {
    private final PrdReviewPreviewProperties properties;
    private final PrdReviewPreviewDao dao;
    private final PrdReviewDao reviews;
    private final PrdReviewService service;
    private final UserDao users;
    private final PrdReviewTunnelProbe probe;
    private final ObjectProvider<EmailVerificationPolicyService> emailPolicy;
    public PrdReviewPreviewService(PrdReviewPreviewProperties properties,PrdReviewPreviewDao dao,PrdReviewDao reviews,
            PrdReviewService service,UserDao users,ObjectProvider<EmailVerificationPolicyService> emailPolicy,PrdReviewTunnelProbe probe) {
        this.properties=properties; this.dao=dao; this.reviews=reviews; this.service=service; this.users=users; this.emailPolicy=emailPolicy; this.probe=probe;
    }
    public record Entry(String status,String origin,String basePath,String code,Date expiresAt,String reason) {
        public Entry(String status,String origin,String basePath,String code,Date expiresAt) { this(status,origin,basePath,code,expiresAt,null); }
    }
    record BrowserSession(Entry entry, String cookie) {}
    public boolean configured(PrdDesignRuntimeDO runtime) { return properties.forRuntime(runtime)!=null; }
    public String instructions(PrdDesignRuntimeDO runtime) {
        var binding=properties.forRuntime(runtime);
        if(binding==null) return "";
        if (binding.isAutomatic()) {
            return "\n【实时设计预览】平台已为当前会话分配 " + binding.basePath()
                    + "。使用回环地址 127.0.0.1 启动 Vite，传入 --base " + binding.basePath()
                    + "，保留应用及既有代理。SPA 的路由 basename 使用 import.meta.env.BASE_URL。"
                    + "上报 READY 和实际端口后，由平台通知执行器恢复预览连接。"
                    + "无需自行启动中转客户端或创建配置。\n";
        }
        String command=binding.getExecutorCliPath()==null?"autowonder":"'"+binding.getExecutorCliPath().replace("'","'\\''")+"'";
        // File contains non-secret endpoints and environment-variable references, just like the CLI contract.
        return "\n【实时设计评审中转】\n平台预览绑定标识："+binding.getId()+"。Vite必须使用 base="+binding.basePath()
                +"（pnpm dev:autowonder --base "+binding.basePath()+"）；使用路由器的工程同时将basename设为import.meta.env.BASE_URL。页面、资源和HMR均保留此前缀。运行报告route仍为不含此前缀的业务路径。执行器预览配置文件："+binding.getExecutorConfigPath()
                +"。本任务预览CLI入口："+command+"；指定入口优先于PATH中的同名命令，不修改全局链接。先确认 "+command+" preview --help 可用，不安装或回退远端 npx 包。使用同一实际Vite端口执行：\n"
                +command+" preview start --id design-"+runtime.getConversationId()+"-"+runtime.getSourceKey()+" --port <actual-port> --config '"+binding.getExecutorConfigPath().replace("'","'\\''")+"' --json\n"
                +"仅在CLI确认注册就绪后，在运行报告中同时提供 previewBindingId=\""+binding.getId()+"\" 和 tunnelStatus=\"READY\"。"
                +"其余状态使用 STARTING、RECONNECTING、LOCAL_SERVICE_UNAVAILABLE、FAILED、STOPPED。后续修改保留服务和预览连接，使用 "+command+" preview status --id design-"+runtime.getConversationId()+"-"+runtime.getSourceKey()+" --json 检查并随UPDATED报告真实状态。"
                +"实际Vite端口变化时，先用 "+command+" preview stop --id 停止本任务同名预览连接，再用同一CLI入口和新端口 start；不得停止其他任务的预览连接。"
                +"凭据只能由已注入的环境变量读取，禁止输出、写入Prompt或命令参数。配置或命令缺失时报告中转失败，本机设计仍继续。\n";
    }
    public void report(PrdDesignRuntimeDO runtime,String bindingId,String status) {
        if(bindingId==null && status==null) return;
        var binding=properties.forRuntime(runtime);
        if(binding==null || !binding.getId().equals(bindingId) || status==null || !Set.of("STARTING","READY","RECONNECTING","LOCAL_SERVICE_UNAVAILABLE","FAILED","STOPPED").contains(status)) throw PrdReviewService.invalid();
        var row=new PrdReviewTunnelDO(); row.setWorkspaceId(runtime.getWorkspaceId()); row.setConversationId(runtime.getConversationId());
        row.setExecutorId(runtime.getExecutorId()); row.setTurnId(runtime.getTurnId()); row.setDispatchAttempt(runtime.getDispatchAttempt());
        row.setReportSequence(runtime.getReportSequence()); row.setBindingId(bindingId); row.setStatus(status); dao.report(row);
    }
    public boolean ready(PrdDesignRuntimeDO runtime,PrdReviewPreviewProperties.Binding binding) {
        if(!binding.matches(runtime) || !"READY".equals(runtime.getStatus())) return false;
        // Reports remain audit data. Live, executor-authenticated registration owns liveness,
        // so opening an existing design can recover without another AI turn/report.
        return probe.available(binding);
    }
    public record Status(String status,String origin,String basePath,String reason) {}
    public Status status(PrdReviewShareDO share) {
        return status(service.requireRuntime(share));
    }
    public Status status(PrdDesignRuntimeDO runtime) {
        var binding=properties.forRuntime(runtime);
        if(binding==null) return new Status("UNCONFIGURED",null,null,"UNCONFIGURED");
        if (binding.isAutomatic() && "PREPARED".equals(runtime.getStatus()))
            return new Status("OFFLINE",null,null,"RECOVERY_REQUIRED");
        if(!"READY".equals(runtime.getStatus())) return new Status("OFFLINE",null,null,"RUNTIME_NOT_READY");
        if(!ready(runtime,binding)) return new Status("OFFLINE", null, null,
                binding.isAutomatic() ? "RECOVERY_REQUIRED" : Objects.toString(probe.status(binding), "DISCONNECTED"));
        return new Status("READY",properties.getPlatformOrigin(),binding.basePath(),null);
    }
    public Entry entry(PrdReviewShareDO share,long actor) {
        var status=status(share);
        if(!"READY".equals(status.status())) return new Entry(status.status(),null,null,null,null,status.reason());
        var binding=properties.forRuntime(service.requireRuntime(share));
        String code=PrdReviewService.randomToken();
        var grant=grant(share,actor,binding.getId(),"ENTRY",code,60_000); dao.grant(grant);
        return new Entry("READY",status.origin(),status.basePath(),code,grant.getExpiresAt());
    }
    public Entry memberEntry(PrdDesignRuntimeDO runtime,long actor) {
        var status=status(runtime);
        if(!"READY".equals(status.status())) return new Entry(status.status(),null,null,null,null,status.reason());
        var binding=properties.forRuntime(runtime); service.requireMemberRuntime(binding,actor);
        String code=PrdReviewService.randomToken();
        var grant=grant(null,actor,binding.getId(),"MEMBER_ENTRY",code,60_000); dao.grant(grant);
        return new Entry("READY",status.origin(),status.basePath(),code,grant.getExpiresAt());
    }
    BrowserSession memberSession(PrdDesignRuntimeDO runtime,long actor) {
        var status=status(runtime);
        if(!"READY".equals(status.status()))
            return new BrowserSession(new Entry(status.status(),null,null,null,null,status.reason()),null);
        requireActiveUser(actor);
        var binding=properties.forRuntime(runtime);
        var validated=status(service.requireMemberRuntime(binding,actor));
        if(!"READY".equals(validated.status()))
            return new BrowserSession(new Entry(validated.status(),null,null,null,null,validated.reason()),null);
        String cookie=PrdReviewService.randomToken();
        var session=grant(null,actor,binding.getId(),"MEMBER_SESSION",cookie,15*60_000);
        dao.grant(session);
        return new BrowserSession(new Entry("READY",validated.origin(),validated.basePath(),null,session.getExpiresAt()),cookie);
    }
    @Transactional
    public String exchange(String code,String bindingId) {
        var entry=authorize(code,bindingId,"ENTRY");
        if(dao.consume(entry.getTokenHash())!=1) throw PrdReviewService.unavailable();
        boolean member="MEMBER_ENTRY".equals(entry.getKind());
        var share=member?null:reviews.shareById(entry.getShareId());
        String cookie=PrdReviewService.randomToken();
        dao.grant(grant(share,entry.getUserId(),bindingId,member?"MEMBER_SESSION":"SESSION",cookie,15*60_000));
        return cookie;
    }
    @Transactional
    public String renew(String code,String cookie,String bindingId) {
        var entry=authorize(code,bindingId,"ENTRY");
        var session=authorize(cookie,bindingId,"SESSION");
        if(!Objects.equals(entry.getUserId(),session.getUserId()) || !Objects.equals(entry.getShareId(),session.getShareId())
                || !Objects.equals(entry.getShareVersion(),session.getShareVersion())
                || !entry.getKind().replace("ENTRY","SESSION").equals(session.getKind())) throw PrdReviewService.unavailable();
        if(dao.consume(entry.getTokenHash())!=1 || dao.renew(session.getTokenHash(),new Date(System.currentTimeMillis()+15*60_000))!=1)
            throw PrdReviewService.unavailable();
        // Keep the same session identity so existing HMR sockets retain their authorization.
        return cookie;
    }
    public PrdReviewGrantDO authorize(String token,String bindingId,String kind) {
        if(token==null || !token.matches("[A-Za-z0-9_-]{43}")) throw PrdReviewService.unavailable();
        var grant=dao.find(hash(token));
        if(grant==null || !(kind.equals(grant.getKind()) || ("MEMBER_"+kind).equals(grant.getKind())) || !Objects.equals(bindingId,grant.getBindingId())) throw PrdReviewService.unavailable();
        requireActiveUser(grant.getUserId());
        PrdDesignRuntimeDO runtime;
        if(grant.getKind().startsWith("MEMBER_")) {
            var configured=properties.byId(bindingId);
            if(configured==null || !Long.valueOf(0).equals(grant.getShareId())) throw PrdReviewService.unavailable();
            runtime=service.requireMemberRuntime(configured,grant.getUserId());
        } else {
            var share=reviews.shareById(grant.getShareId());
            if(share==null || !Objects.equals(share.getVersion(),grant.getShareVersion())) throw PrdReviewService.unavailable();
            runtime=service.requireRuntime(share);
        }
        var binding=properties.forRuntime(runtime);
        if(binding==null || !bindingId.equals(binding.getId()) || !ready(runtime,binding)) throw PrdReviewService.unavailable();
        return grant;
    }
    private void requireActiveUser(long userId) {
        var user=users.findById(userId);
        var policy=emailPolicy.getIfAvailable();
        if(user==null || !Integer.valueOf(0).equals(user.getStatus()) || (policy!=null && policy.requiresVerification(user))) throw PrdReviewService.unavailable();
    }
    private static PrdReviewGrantDO grant(PrdReviewShareDO share,long user,String binding,String kind,String token,int lifetime) {
        var row=new PrdReviewGrantDO(); row.setTokenHash(hash(token)); row.setKind(kind);
        // No FK exists on share_id. Zero explicitly denotes a membership grant, never a public share.
        row.setShareId(share==null?0L:share.getId()); row.setShareVersion(share==null?0:share.getVersion());
        row.setUserId(user); row.setBindingId(binding); row.setExpiresAt(new Date(System.currentTimeMillis()+lifetime)); return row;
    }
    private static String hash(String value) { return PrdDesignTemplateService.digest(value.getBytes(StandardCharsets.UTF_8)); }
}

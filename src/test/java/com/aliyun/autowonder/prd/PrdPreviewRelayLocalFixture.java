package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.websocket.ExecutorWsAuthenticator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.util.descriptor.web.*;
import org.apache.tomcat.websocket.server.WsSci;
import javax.servlet.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Loopback-only native cross-repository fixture. Auth/DB are fixtures; relay and gateway are production code. */
public class PrdPreviewRelayLocalFixture {
    public static void main(String[] args) throws Exception {
        var server=new Tomcat(); server.setBaseDir(Files.createTempDirectory("aw-relay-platform").toString());
        server.setPort(0); server.getConnector().setProperty("address","127.0.0.1");
        var context=server.addContext("",Files.createTempDirectory("aw-relay-doc").toString());
        context.addServletContainerInitializer(new WsSci(),Set.of());
        var properties=new PrdReviewPreviewProperties();
        var bindings=new ArrayList<PrdReviewPreviewProperties.Binding>();
        for(String id:List.of("fixture-a","fixture-b")) {
            var b=new PrdReviewPreviewProperties.Binding(); b.setId(id); b.setWorkspaceId(1); b.setWorkitemId(10);
            b.setConversationId(id.equals("fixture-a")?20:21); b.setExecutorId(30); b.setSourceKey("source"); b.setExecutorConfigPath("/fixture/preview.json"); bindings.add(b);
        }
        properties.setBindings(bindings);
        var auth=mock(ExecutorWsAuthenticator.class); var accepted=mock(ExecutorWsAuthenticator.AuthResult.class);
        when(accepted.isSuccess()).thenReturn(true); when(auth.authenticate(anyLong(),anyString())).thenReturn(mock(ExecutorWsAuthenticator.AuthResult.class));
        when(auth.authenticate(30,"fixture-executor-token")).thenReturn(accepted);
        var previews=mock(PrdReviewPreviewService.class);
        when(previews.exchange("fixture-code","fixture-a")).thenReturn("fixture-session-a");
        when(previews.exchange("fixture-code","fixture-b")).thenReturn("fixture-session-b");
        when(previews.renew("fixture-code","fixture-session-a","fixture-a")).thenReturn("fixture-session-a");
        when(previews.renew("fixture-code","fixture-session-b","fixture-b")).thenReturn("fixture-session-b");
        when(previews.authorize(any(),anyString(),eq("SESSION"))).thenAnswer(call->{
            if(!("fixture-session-"+("fixture-a".equals(call.getArgument(1))?"a":"b")).equals(call.getArgument(0))) throw PrdReviewService.unavailable();
            return new PrdReviewGrantDO();
        });
        var relay=new PrdPreviewRelay(properties,auth);
        var gateway=new PrdReviewPreviewGateway(properties,previews,mock(PrdReviewPreviewDao.class),relay);
        for(var entry:List.of(Map.entry("relay",relay.previewRelayFilter().getFilter()),Map.entry("gateway",gateway.designPreviewGatewayFilter().getFilter()))) {
            var filter=new FilterDef(); filter.setFilterName(entry.getKey()); filter.setFilter(entry.getValue()); context.addFilterDef(filter);
            var mapping=new FilterMap(); mapping.setFilterName(entry.getKey()); mapping.addURLPattern("/*"); context.addFilterMap(mapping);
        }
        Tomcat.addServlet(context,"index",new HttpServlet() {
            @Override protected void doGet(HttpServletRequest req,HttpServletResponse res) throws java.io.IOException {
                res.setContentType("text/html;charset=utf-8");
                res.getWriter().write("<form method='post' action='/design-preview/fixture-a/_autowonder/enter'><input type='hidden' name='code' value='fixture-code'><button>打开本机中转测试</button></form>");
            }
        }); context.addServletMappingDecoded("/","index");
        server.start(); int port=server.getConnector().getLocalPort(); properties.setPlatformOrigin("http://127.0.0.1:"+port); properties.validate();
        var timer=Executors.newSingleThreadScheduledExecutor(); timer.scheduleWithFixedDelay(()->{ relay.expire(); gateway.revokeSockets(); },1,1,TimeUnit.SECONDS);
        Runtime.getRuntime().addShutdownHook(new Thread(()-> { timer.shutdownNow(); relay.shutdown(); gateway.shutdown(); try { server.stop(); server.destroy(); } catch(Exception ignored) {} }));
        Files.writeString(Path.of(args[0]),new ObjectMapper().writeValueAsString(Map.of("origin",properties.getPlatformOrigin(),"port",port)));
        new CountDownLatch(1).await();
    }
}

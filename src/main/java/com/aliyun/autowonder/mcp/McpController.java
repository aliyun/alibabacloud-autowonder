package com.aliyun.autowonder.mcp;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.i18n.SystemMessages;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.mcp.dto.McpRpcResponse;
import com.aliyun.autowonder.mcp.dto.McpToolCallRequest;
import com.aliyun.autowonder.mcp.dto.McpToolVO;
import com.aliyun.autowonder.memory.store.MemoryStoreApplicationService;
import com.aliyun.autowonder.workitem.DeliveryProgressSpill;
import com.aliyun.autowonder.workitem.dto.DeliveryProgressVO;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/mcp")
public class McpController {
    private final McpAccessTokenService tokenService;
    private final McpToolService toolService;
    private final McpSseService sseService;

    public McpController(McpAccessTokenService tokenService, McpToolService toolService, McpSseService sseService) {
        this.tokenService = tokenService;
        this.toolService = toolService;
        this.sseService = sseService;
    }

    @GetMapping(value = {
            "", "/rpc",
            "/{pathToken}", "/{pathToken}/",
            "/{pathToken}/rpc", "/{pathToken}/rpc/"
    })
    public SseEmitter stream(@RequestHeader(value = "Authorization", required = false) String authorization,
                                     @PathVariable(value = "pathToken", required = false) String pathToken,
                                     @RequestParam(value = "token", required = false) String queryToken,
                                     HttpServletRequest request, HttpServletResponse response) throws IOException {
        try {
            if (CorsUtils.isCorsRequest(request)) {
                response.setStatus(HttpStatus.FORBIDDEN.value());
                return null;
            }
        } catch (IllegalArgumentException malformedOrigin) {
            response.setStatus(HttpStatus.FORBIDDEN.value());
            return null;
        }
        try {
            tokenService.authenticate(authorization, resolveToken(pathToken, queryToken));
        } catch (BizException e) {
            // Force JSON before opening the stream, even for clients accepting only SSE.
            // 只有凭据被拒绝才是 401；鉴权依赖故障不能诱导客户端重新登录。
            boolean rejectedCredential = ErrorCode.UNAUTHORIZED.getCode().equals(e.getCode());
            response.setStatus(rejectedCredential
                    ? HttpStatus.UNAUTHORIZED.value() : HttpStatus.INTERNAL_SERVER_ERROR.value());
            if (rejectedCredential) {
                response.setHeader("WWW-Authenticate", "Bearer");
            }
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding("UTF-8");
            response.getOutputStream().write(JSON.toJSONString(Result.fail(e)).getBytes(StandardCharsets.UTF_8));
            return null;
        }
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("X-Accel-Buffering", "no");
        return sseService.open();
    }

    @GetMapping("/tools")
    public Result<List<McpToolVO>> listTools(@RequestHeader(value = "Authorization", required = false) String authorization,
                                             @RequestParam(value = "token", required = false) String token) {
        McpAccessTokenService.Principal principal = tokenService.authenticate(authorization, token);
        return withContext(principal, () ->
                Result.ok(toolService.listTools(principal)));
    }

    @PostMapping("/tools/call")
    public Result<Object> callTool(@RequestHeader(value = "Authorization", required = false) String authorization,
                                   @RequestParam(value = "token", required = false) String token,
                                   @RequestBody McpToolCallRequest request) {
        McpAccessTokenService.Principal principal = tokenService.authenticate(authorization, token);
        return withContext(principal, () -> Result.ok(toolService.call(principal, request.getName(), request.getArguments())));
    }

    @PostMapping(value = {
            "", "/rpc",
            "/{pathToken}", "/{pathToken}/",
            "/{pathToken}/rpc", "/{pathToken}/rpc/"
    }, produces = {
            MediaType.APPLICATION_JSON_VALUE,
            MediaType.TEXT_EVENT_STREAM_VALUE
    })
    public ResponseEntity<?> rpc(@RequestHeader(value = "Authorization", required = false) String authorization,
                                 @PathVariable(value = "pathToken", required = false) String pathToken,
                                 @RequestParam(value = "token", required = false) String queryToken,
                                 @RequestHeader(value = "Accept", required = false) String accept,
                                 @RequestBody Map<String, Object> request) {
        String token = resolveToken(pathToken, queryToken);
        if (!request.containsKey("id")) {
            acknowledgeNotification(authorization, token);
            return ResponseEntity.accepted().build();
        }

        McpRpcResponse response = rpc(authorization, token, request);
        if (acceptsEventStreamOnly(accept)) {
            DeliveryProgressSpill spill = DeliveryProgressSpill.usedByRequest();
            if (spill != null) {
                return streamProgressEvent(response, spill);
            }
            return ResponseEntity.ok()
                    .contentType(MediaType.TEXT_EVENT_STREAM)
                    .body("data:" + JSON.toJSONString(response) + "\n\n");
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(response);
    }

    public McpRpcResponse rpc(@RequestHeader(value = "Authorization", required = false) String authorization,
                              @RequestParam(value = "token", required = false) String token,
                              @RequestBody Map<String, Object> request) {
        Object id = request.get("id");
        try {
            McpAccessTokenService.Principal principal = tokenService.authenticate(authorization, token);
            return withContext(principal, () -> handleRpc(principal, id, request));
        } catch (MemoryStoreApplicationService.MemoryMaintenanceLeaseConflictException e) {
            return McpRpcResponse.error(id, -32009, "MEMORY_MAINTENANCE_LOCKED: retry later");
        } catch (BizException e) {
            // -32000 表示可呈现的业务失败；SYSTEM_ERROR 是服务端内部/依赖故障，按 JSON-RPC 语义报 -32603。
            int code = ErrorCode.SYSTEM_ERROR.getCode().equals(e.getCode()) ? -32603 : -32000;
            return McpRpcResponse.error(id, code,
                    SystemMessages.render(e.getMessageKey(), e.getMessageArgs(), e.getMessage()));
        } catch (Exception e) {
            return McpRpcResponse.error(id, -32603, e.getMessage());
        }
    }

    private String resolveToken(String pathToken, String queryToken) {
        if (pathToken != null && !pathToken.isBlank()) {
            return pathToken;
        }
        return queryToken;
    }

    private void acknowledgeNotification(String authorization, String token) {
        McpAccessTokenService.Principal principal = tokenService.authenticate(authorization, token);
        withContext(principal, () -> null);
    }

    private boolean acceptsEventStreamOnly(String accept) {
        if (accept == null || accept.isBlank()) {
            return false;
        }
        List<MediaType> accepted = MediaType.parseMediaTypes(accept);
        boolean acceptsJson = accepted.stream()
                .anyMatch(mediaType -> mediaType.isCompatibleWith(MediaType.APPLICATION_JSON));
        boolean acceptsEventStream = accepted.stream()
                .anyMatch(mediaType -> mediaType.isCompatibleWith(MediaType.TEXT_EVENT_STREAM));
        return acceptsEventStream && !acceptsJson;
    }

    private McpRpcResponse handleRpc(McpAccessTokenService.Principal principal, Object id, Map<String, Object> request) {
        String method = String.valueOf(request.get("method"));
        if ("initialize".equals(method)) {
            return McpRpcResponse.ok(id, Map.of(
                    "protocolVersion", "2025-06-18",
                    "serverInfo", Map.of("name", "autowonder", "version", "1.0.0"),
                    "capabilities", Map.of("tools", Map.of())));
        }
        if ("tools/list".equals(method)) {
            return McpRpcResponse.ok(
                    id, Map.of("tools", toolService.listTools(principal)));
        }
        if ("tools/call".equals(method)) {
            Map<String, Object> params = map(request.get("params"));
            Object result = toolService.call(principal, String.valueOf(params.get("name")), map(params.get("arguments")));
            Object structuredContent = result instanceof List<?> ? Map.of("items", result) : result;
            DeliveryProgressSpill spill = result instanceof DeliveryProgressVO
                    ? DeliveryProgressSpill.usedByRequest() : null;
            Object text = spill == null ? JSON.toJSONString(structuredContent) : ProgressText.write(spill, structuredContent);
            return McpRpcResponse.ok(id, Map.of(
                    "content", List.of(Map.of("type", "text", "text", text)),
                    "structuredContent", structuredContent,
                    "isError", false));
        }
        return McpRpcResponse.error(id, -32601, "Method not found");
    }

    private ResponseEntity<?> streamProgressEvent(McpRpcResponse response, DeliveryProgressSpill spill) {
        try {
            Path file = spill.newFile();
            try (var output = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
                output.write("data:");
                JSON.writeTo(output, response);
                output.write("\n\n");
            }
            return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM)
                    .contentLength(Files.size(file))
                    .body(new InputStreamResource(Files.newInputStream(file)));
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    @JsonSerialize(using = ProgressText.Serializer.class)
    private record ProgressText(Path file) {
        private static ProgressText write(DeliveryProgressSpill spill, Object value) {
            try {
                Path file = spill.newFile();
                try (var output = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
                    JSON.writeTo(output, value);
                }
                return new ProgressText(file);
            } catch (IOException exception) {
                throw new UncheckedIOException(exception);
            }
        }

        public static class Serializer extends JsonSerializer<ProgressText> {
            @Override
            public void serialize(ProgressText text, JsonGenerator generator, SerializerProvider serializers) throws IOException {
                try (var input = Files.newBufferedReader(text.file(), StandardCharsets.UTF_8)) {
                    generator.writeString(input, -1);
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        if (value == null) {
            return Map.of();
        }
        if (value instanceof Map<?, ?> raw) {
            return (Map<String, Object>) raw;
        }
        return JSON.parseObject(JSON.toJSONString(value));
    }

    private <T> T withContext(McpAccessTokenService.Principal principal, SupplierWithException<T> action) {
        try {
            AutoWonderContext ctx = AutoWonderContext.get();
            ctx.setUserId(principal.userId());
            ctx.setTraceId(UUID.randomUUID().toString());
            if (principal.isWorkspaceScoped()) {
                ctx.setCurrentWorkspaceId(principal.workspaceId());
                ctx.setWorkspaceAccessLevel(principal.accessLevel());
            }
            return action.get();
        } finally {
            AutoWonderContext.destroy();
        }
    }

    private interface SupplierWithException<T> {
        T get();
    }
}

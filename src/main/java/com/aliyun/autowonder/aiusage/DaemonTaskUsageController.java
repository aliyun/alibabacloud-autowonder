package com.aliyun.autowonder.aiusage;

import com.aliyun.autowonder.aiusage.dto.TaskUsageReportRequest;
import com.aliyun.autowonder.artifact.DaemonUploadAuthenticator;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.Map;

@RestController
@RequestMapping("/api/daemon")
public class DaemonTaskUsageController {

    static final int MAX_USAGE_ENTRIES = 1000;

    private final DaemonUploadAuthenticator authenticator;
    private final DispatchAiUsageService usageService;

    public DaemonTaskUsageController(DaemonUploadAuthenticator authenticator, DispatchAiUsageService usageService) {
        this.authenticator = authenticator;
        this.usageService = usageService;
    }

    @PostMapping("/tasks/{taskId}/usage")
    public ResponseEntity<?> reportUsage(@PathVariable String taskId,
                                         @RequestParam(value = "dispatchId", required = false) String dispatchIdParam,
                                         @RequestParam(value = "token", required = false) String token,
                                         @RequestBody TaskUsageReportRequest request,
                                         HttpServletRequest httpRequest) {
        Long dispatchId = parseDispatchId(dispatchIdParam != null && !dispatchIdParam.isBlank() ? dispatchIdParam : taskId);
        if (dispatchId == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid dispatch id"));
        }
        String authToken = resolveToken(token, httpRequest);
        if (authToken == null) {
            return ResponseEntity.status(401).build();
        }
        DaemonUploadAuthenticator.AuthResult auth = authenticator.authenticate(dispatchId, authToken);
        if (!auth.isSuccess()) {
            return ResponseEntity.status(401).build();
        }
        ResponseEntity<?> oversized = rejectOversized(request);
        if (oversized != null) {
            return oversized;
        }
        int recorded = usageService.recordUsage(auth.getTenantId(), dispatchId,
                request != null ? request.getUsage() : null);
        return ResponseEntity.ok(Map.of("status", "accepted", "entries", recorded));
    }

    /**
     * Collects the credits a forced-cancelled execution already recorded locally.
     *
     * <p>Cancellation fenced business artifacts and workitem mutations, but the
     * already-collected usage must still reach billing: this endpoint accepts
     * usage-only entries for a dispatch the executor token owns, writes
     * {@code dispatch_ai_usage} idempotently, and never touches status, artifacts,
     * comments or any other business output.
     */
    @PostMapping("/dispatches/{dispatchId}/usage")
    public ResponseEntity<?> reportDispatchUsage(@PathVariable long dispatchId,
                                                 @RequestParam(value = "token", required = false) String token,
                                                 @RequestBody(required = false) TaskUsageReportRequest request,
                                                 HttpServletRequest httpRequest) {
        String authToken = resolveToken(token, httpRequest);
        if (authToken == null) {
            return ResponseEntity.status(401).build();
        }
        DaemonUploadAuthenticator.AuthResult auth = authenticator.authenticate(dispatchId, authToken);
        if (!auth.isSuccess()) {
            return ResponseEntity.status(401).build();
        }
        ResponseEntity<?> oversized = rejectOversized(request);
        if (oversized != null) {
            return oversized;
        }
        int recorded = usageService.recordUsage(auth.getTenantId(), dispatchId,
                request != null ? request.getUsage() : null);
        return ResponseEntity.ok(Map.of("status", "accepted", "entries", recorded));
    }

    private ResponseEntity<?> rejectOversized(TaskUsageReportRequest request) {
        if (request == null || request.getUsage() == null || request.getUsage().size() <= MAX_USAGE_ENTRIES) {
            return null;
        }
        return ResponseEntity.badRequest()
                .body(Map.of("error", "too many usage entries", "maxEntries", MAX_USAGE_ENTRIES));
    }

    private String resolveToken(String token, HttpServletRequest httpRequest) {
        String resolved = token != null && !token.isBlank() ? token
                : bearerToken(httpRequest.getHeader("Authorization"));
        return resolved == null || resolved.isBlank() ? null : resolved;
    }

    private Long parseDispatchId(String dispatchId) {
        try {
            return Long.parseLong(dispatchId);
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private String bearerToken(String authorization) {
        if (authorization == null) {
            return null;
        }
        String prefix = "Bearer ";
        return authorization.startsWith(prefix) ? authorization.substring(prefix.length()) : authorization;
    }
}

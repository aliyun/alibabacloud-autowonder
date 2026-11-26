package com.aliyun.autowonder.aiusage;

import com.aliyun.autowonder.aiusage.dto.TaskUsageReportRequest;
import com.aliyun.autowonder.artifact.DaemonUploadAuthenticator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

class DaemonTaskUsageControllerTest {

    private DaemonUploadAuthenticator authenticator;
    private DispatchAiUsageService usageService;
    private DaemonTaskUsageController controller;

    @BeforeEach
    void setUp() {
        authenticator = mock(DaemonUploadAuthenticator.class);
        usageService = mock(DispatchAiUsageService.class);
        controller = new DaemonTaskUsageController(authenticator, usageService);
    }

    @Test
    void acceptsBearerTokenAndRecordsUsage() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));
        when(usageService.recordUsage(eq(10L), eq(99L), anyList())).thenReturn(1);
        MockHttpServletRequest httpRequest = new MockHttpServletRequest();
        httpRequest.addHeader("Authorization", "Bearer tok");
        TaskUsageReportRequest request = new TaskUsageReportRequest();
        TaskUsageReportRequest.TaskUsageEntry entry = new TaskUsageReportRequest.TaskUsageEntry();
        entry.setProvider("codex");
        entry.setModel("gpt-5");
        request.setUsage(List.of(entry));

        ResponseEntity<?> response = controller.reportUsage("99", null, null, request, httpRequest);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(1, ((Map<?, ?>) response.getBody()).get("entries"));
        verify(usageService).recordUsage(10L, 99L, request.getUsage());
    }

    @Test
    void acceptsOpaqueTaskIdWithDispatchIdOverride() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));
        TaskUsageReportRequest request = new TaskUsageReportRequest();
        TaskUsageReportRequest.TaskUsageEntry entry = new TaskUsageReportRequest.TaskUsageEntry();
        entry.setProvider("codex");
        entry.setModel("gpt-5");
        request.setUsage(List.of(entry));

        ResponseEntity<?> response = controller.reportUsage("task-x", "99", "tok", request, new MockHttpServletRequest());

        assertEquals(200, response.getStatusCode().value());
        verify(usageService).recordUsage(10L, 99L, request.getUsage());
    }

    @Test
    void legacyUsageReportRejectsMissingToken() {
        ResponseEntity<?> response = controller.reportUsage("99", null, null, new TaskUsageReportRequest(), new MockHttpServletRequest());

        assertEquals(401, response.getStatusCode().value());
        verifyNoInteractions(authenticator, usageService);
    }

    @Test
    void legacyUsageReportAcceptsEmptyBody() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));

        ResponseEntity<?> response = controller.reportUsage("99", null, "tok", null, new MockHttpServletRequest());

        assertEquals(200, response.getStatusCode().value());
        verify(usageService).recordUsage(10L, 99L, null);
    }

    @Test
    void dispatchUsageReportFallsBackToBearerWhenQueryTokenIsBlank() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));
        MockHttpServletRequest httpRequest = new MockHttpServletRequest();
        httpRequest.addHeader("Authorization", "Bearer tok");

        ResponseEntity<?> response = controller.reportDispatchUsage(99L, "  ", new TaskUsageReportRequest(), httpRequest);

        assertEquals(200, response.getStatusCode().value());
        verify(usageService).recordUsage(10L, 99L, null);
    }

    @Test
    void dispatchUsageReportRejectsBlankBearerToken() {
        MockHttpServletRequest httpRequest = new MockHttpServletRequest();
        httpRequest.addHeader("Authorization", "Bearer ");

        ResponseEntity<?> response = controller.reportDispatchUsage(99L, null, new TaskUsageReportRequest(), httpRequest);

        assertEquals(401, response.getStatusCode().value());
        verifyNoInteractions(authenticator, usageService);
    }

    @Test
    void rejectsInvalidTaskIdWithoutDispatchIdOverride() {
        ResponseEntity<?> response = controller.reportUsage("task-x", null, "tok", new TaskUsageReportRequest(), new MockHttpServletRequest());

        assertEquals(400, response.getStatusCode().value());
        verifyNoInteractions(authenticator, usageService);
    }

    @Test
    void dispatchUsageReportUsesQueryTokenAndBypassesBusinessMutationFence() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));
        when(usageService.recordUsage(eq(10L), eq(99L), anyList())).thenReturn(2);
        TaskUsageReportRequest request = new TaskUsageReportRequest();
        request.setUsage(List.of(entry("qoder", "auto")));

        ResponseEntity<?> response = controller.reportDispatchUsage(99L, "tok", request, new MockHttpServletRequest());

        assertEquals(200, response.getStatusCode().value());
        assertEquals(2, ((Map<?, ?>) response.getBody()).get("entries"));
        verify(usageService).recordUsage(10L, 99L, request.getUsage());
        // Cancelled executions keep their collected credits reportable: the usage
        // route must not consult the business-artifact mutation fence.
        verify(authenticator, never()).isMutationFenced(anyLong());
    }

    @Test
    void dispatchUsageReportAcceptsEmptyBody() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));

        ResponseEntity<?> response = controller.reportDispatchUsage(99L, "tok", null, new MockHttpServletRequest());

        assertEquals(200, response.getStatusCode().value());
        assertEquals(0, ((Map<?, ?>) response.getBody()).get("entries"));
        verify(usageService).recordUsage(10L, 99L, null);
    }

    @Test
    void dispatchUsageReportRejectsMissingToken() {
        ResponseEntity<?> response = controller.reportDispatchUsage(99L, null, new TaskUsageReportRequest(), new MockHttpServletRequest());

        assertEquals(401, response.getStatusCode().value());
        verifyNoInteractions(authenticator, usageService);
    }

    @Test
    void dispatchUsageReportRejectsForeignExecutorToken() {
        when(authenticator.authenticate(99L, "foreign")).thenReturn(DaemonUploadAuthenticator.AuthResult.fail());

        ResponseEntity<?> response = controller.reportDispatchUsage(99L, "foreign", new TaskUsageReportRequest(), new MockHttpServletRequest());

        assertEquals(401, response.getStatusCode().value());
        verifyNoInteractions(usageService);
    }

    @Test
    void dispatchUsageReportRejectsOversizedPayload() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));
        TaskUsageReportRequest request = new TaskUsageReportRequest();
        request.setUsage(new java.util.ArrayList<>(
                java.util.Collections.nCopies(DaemonTaskUsageController.MAX_USAGE_ENTRIES + 1, entry("qoder", "auto"))));

        ResponseEntity<?> response = controller.reportDispatchUsage(99L, "tok", request, new MockHttpServletRequest());

        assertEquals(400, response.getStatusCode().value());
        verifyNoInteractions(usageService);
    }

    @Test
    void legacyUsageReportRejectsOversizedPayload() {
        when(authenticator.authenticate(99L, "tok"))
                .thenReturn(DaemonUploadAuthenticator.AuthResult.success(10L, 20L, 30L));
        TaskUsageReportRequest request = new TaskUsageReportRequest();
        request.setUsage(new java.util.ArrayList<>(
                java.util.Collections.nCopies(DaemonTaskUsageController.MAX_USAGE_ENTRIES + 1, entry("qoder", "auto"))));

        ResponseEntity<?> response = controller.reportUsage("99", null, "tok", request, new MockHttpServletRequest());

        assertEquals(400, response.getStatusCode().value());
        verifyNoInteractions(usageService);
    }

    private TaskUsageReportRequest.TaskUsageEntry entry(String provider, String model) {
        TaskUsageReportRequest.TaskUsageEntry entry = new TaskUsageReportRequest.TaskUsageEntry();
        entry.setProvider(provider);
        entry.setModel(model);
        return entry;
    }
}

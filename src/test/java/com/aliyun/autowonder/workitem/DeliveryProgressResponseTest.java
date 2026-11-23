package com.aliyun.autowonder.workitem;

import com.aliyun.autowonder.mcp.McpAccessTokenService;
import com.aliyun.autowonder.mcp.McpController;
import com.aliyun.autowonder.mcp.McpSseService;
import com.aliyun.autowonder.mcp.McpToolService;
import com.aliyun.autowonder.workitem.dto.DeliveryProgressVO;
import com.aliyun.autowonder.workitem.dto.DeliveryStepVO;
import com.aliyun.autowonder.workitem.dto.SubStepVO;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DeliveryProgressResponseTest {

    @org.junit.jupiter.api.Test
    void dispersedHistoriesShareARequestBudget() {
        var attributes = new org.springframework.web.context.request.ServletRequestAttributes(
                new org.springframework.mock.web.MockHttpServletRequest());
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(attributes);
        try {
            var storage = DeliveryProgressSpill.forRequest();
            var histories = new ArrayList<List<String>>();
            for (int i = 0; i < 24; i++) {
                List<String> rows = storage.list(String.class);
                histories.add(rows);
                for (int j = 0; j < 500; j++) rows.add(i + ":" + j);
            }
            assertSame(storage, DeliveryProgressSpill.usedByRequest());
            for (int i = 0; i < histories.size(); i++) {
                int row = 0;
                for (String value : histories.get(i)) assertEquals(i + ":" + row++, value);
                assertEquals(500, row);
            }
        } finally {
            attributes.requestCompleted();
            org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/json", "text/event-stream"})
    void spilledMcpProgressPreservesTheEntireWireResponse(String accept) throws Exception {
        var tokens = mock(McpAccessTokenService.class);
        var tools = mock(McpToolService.class);
        var principal = McpAccessTokenService.Principal.personal(9L, 1L);
        when(tokens.authenticate("Bearer test", null)).thenReturn(principal);
        var spill = new AtomicBoolean();
        var cleanupProbe = new AtomicReference<Path>();
        when(tools.call(eq(principal), eq("autowonder.get_workitem_delivery_progress"), anyMap()))
                .thenAnswer(ignored -> {
                    List<SubStepVO> rows;
                    if (spill.get()) {
                        var storage = DeliveryProgressSpill.forRequest();
                        rows = storage.list(SubStepVO.class);
                        cleanupProbe.set(storage.newFile());
                    } else {
                        rows = new ArrayList<>();
                    }
                    for (int i = 0; i < 2500; i++) {
                        var row = new SubStepVO();
                        row.setName("工单↔𠮷😀\n\\\"" + i);
                        row.setStatus(i == 2499 ? "failed" : "done");
                        rows.add(row);
                    }
                    var step = new DeliveryStepVO();
                    step.setSubSteps(rows);
                    var progress = new DeliveryProgressVO();
                    progress.setSteps(List.of(step));
                    return progress;
                });
        var mvc = MockMvcBuilders.standaloneSetup(new McpController(tokens, tools, mock(McpSseService.class)))
                .setMessageConverters(new org.springframework.http.converter.StringHttpMessageConverter(StandardCharsets.UTF_8),
                        new org.springframework.http.converter.ResourceHttpMessageConverter(),
                        new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter()).build();
        String request = """
                {"jsonrpc":"2.0","id":"progress","method":"tools/call","params":{
                  "name":"autowonder.get_workitem_delivery_progress","arguments":{"workspaceId":7,"id":10207}}}
                """;

        var expected = mvc.perform(post("/api/mcp/rpc").header("Authorization", "Bearer test")
                        .contentType("application/json").accept(accept).content(request))
                .andExpect(status().isOk()).andReturn().getResponse();
        spill.set(true);
        var actual = mvc.perform(post("/api/mcp/rpc").header("Authorization", "Bearer test")
                        .contentType("application/json").accept(accept).content(request))
                .andExpect(status().isOk()).andReturn().getResponse();

        assertEquals(expected.getContentType(), actual.getContentType());
        boolean sse = accept.equals("text/event-stream");
        String before = new String(expected.getContentAsByteArray(), StandardCharsets.UTF_8);
        String after = new String(actual.getContentAsByteArray(), StandardCharsets.UTF_8);
        var mapper = new ObjectMapper();
        if (sse) {
            assertTrue(after.startsWith("data:") && after.endsWith("\n\n"));
            before = before.substring(5, before.length() - 2);
            after = after.substring(5, after.length() - 2);
        }
        assertEquals(mapper.readTree(before), mapper.readTree(after));
        var result = mapper.readTree(after).path("result");
        var content = mapper.readTree(result.path("content").get(0).path("text").asText());
        assertEquals(2500, content.path("steps").get(0).path("subSteps").size());
        assertNotNull(cleanupProbe.get());
        assertFalse(Files.exists(cleanupProbe.get()), "spool outlived the HTTP request");
    }
}

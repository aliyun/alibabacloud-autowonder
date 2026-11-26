package com.aliyun.autowonder.prd;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class PrdPreparePromptTest {

    @Test
    void tellsTheAgentHowToIntegrateAndVerifyInspectorBeforeReportingPrepared() {
        String prompt = PrdPrompts.PREPARE;

        assertTrue(prompt.contains("缺少 uxer.config.json 时，按实际工程补齐配置"));
        assertTrue(prompt.contains("@uxerjs/universal-inspector@0.3.0"));
        assertTrue(prompt.contains("PRD 预览只使用公开可安装的 Inspector，不新增私有 Inspector 依赖"));
        assertTrue(prompt.contains("已有 uxer.config.json 也要检查真实启动入口"));
        assertTrue(prompt.contains("上报 PREPARED 前，核对实际启动命令、Inspector 的加载位置及版本"));
    }
}

package com.aliyun.autowonder.prd;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PrdMarkdownTest {
    @Test
    void rendersRequirementsAndAcceptanceWithoutPrototypeMarkup() {
        String markdown = PrdMarkdown.render("""
                {"title":"交付设计","background":"保留原始内容","pages":[{"name":"主页","route":"/",
                "loadingState":"加载订单","mockHtml":"<script>legacy prototype</script>"}],
                "requirements":[{"key":"REQ-001","title":"下单","acceptanceCriteria":["确认后生成订单"]}],
                "openQuestions":[{"key":"Q-001","question":"可否取消","blocking":true}]}
                """);
        assertTrue(markdown.startsWith("# 交付设计\n"));
        assertTrue(markdown.contains("保留原始内容"));
        assertTrue(markdown.contains("加载 · 加载订单"));
        assertTrue(markdown.contains("### REQ-001 · 下单"));
        assertTrue(markdown.contains("- 确认后生成订单"));
        assertTrue(markdown.contains("- Q-001 · 可否取消 · 阻塞"));
        assertFalse(markdown.contains("legacy prototype"));
    }

    @Test
    void usesTheStoredDesignLanguage() {
        String markdown = PrdMarkdown.render("""
                {"language":"en-US","title":"Checkout","requirements":[{"key":"REQ-001","title":"Place order"}]}
                """);
        assertTrue(markdown.contains("## Requirements and acceptance criteria"));
        assertTrue(markdown.contains("### REQ-001 · Place order"));
    }
}

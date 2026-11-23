package com.aliyun.autowonder.configuration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Bounded budgets and admission limits for conversation event detail reads.
 *
 * <p>G = min(32, max(1, floor(T/4))) where T is the Tomcat max worker thread count. A configuration
 * that cannot leave a normal request thread is refused at startup instead of silently degrading.
 */
@Configuration
public class ConversationEventReadConfiguration {

    private final int httpThreads;
    private final boolean admissionEnabled;
    private final long writeDeadlineMs;
    private final long releaseGraceMs;

    public ConversationEventReadConfiguration(
            @Value("${server.tomcat.threads.max:200}") int httpThreads,
            @Value("${autowonder.conversation.event-display.admission-enabled:true}") boolean admissionEnabled,
            @Value("${autowonder.conversation.event-display.write-deadline-ms:20000}") long writeDeadlineMs,
            @Value("${autowonder.conversation.event-display.release-grace-ms:5000}") long releaseGraceMs) {
        if (!admissionEnabled) {
            this.httpThreads = httpThreads;
            this.admissionEnabled = false;
            this.writeDeadlineMs = writeDeadlineMs;
            this.releaseGraceMs = releaseGraceMs;
            return;
        }
        if (httpThreads < 4) {
            throw new IllegalStateException(
                    "conversation event detail admission requires at least 4 HTTP worker threads, got "
                            + httpThreads);
        }
        this.httpThreads = httpThreads;
        this.admissionEnabled = true;
        this.writeDeadlineMs = writeDeadlineMs;
        this.releaseGraceMs = releaseGraceMs;
    }

    public boolean isAdmissionEnabled() {
        return admissionEnabled;
    }

    public int getHttpThreads() {
        return httpThreads;
    }

    public int getGlobalLimit() {
        return Math.min(32, Math.max(1, httpThreads / 4));
    }

    public int getPerUserLimit() {
        return Math.min(2, getGlobalLimit());
    }

    public int getPerWorkspaceLimit() {
        return Math.min(8, getGlobalLimit());
    }

    public long getWriteDeadlineMs() {
        return writeDeadlineMs;
    }

    public long getReleaseGraceMs() {
        return releaseGraceMs;
    }

    @Bean
    public FilterRegistrationBean<com.aliyun.autowonder.filter.ConversationEventReadAdmissionFilter>
            conversationEventReadAdmissionFilter(ConversationEventReadConfiguration configuration) {
        FilterRegistrationBean<com.aliyun.autowonder.filter.ConversationEventReadAdmissionFilter> registration =
                new FilterRegistrationBean<>(new com.aliyun.autowonder.filter.ConversationEventReadAdmissionFilter(configuration));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(2);
        return registration;
    }
}

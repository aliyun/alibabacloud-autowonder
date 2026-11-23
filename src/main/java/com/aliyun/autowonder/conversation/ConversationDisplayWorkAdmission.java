package com.aliyun.autowonder.conversation;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.util.concurrent.Semaphore;

/** Shared admission for derived work; inbound event and ordinary HTTP connections are reserved. */
@Component
public class ConversationDisplayWorkAdmission {
    private final Semaphore permits;

    public ConversationDisplayWorkAdmission() {
        this(50);
    }

    @Autowired
    public ConversationDisplayWorkAdmission(
            @Value("${spring.datasource.hikari.maximum-pool-size:50}") int databasePoolSize) {
        permits = new Semaphore(Math.min(4, Math.max(1, databasePoolSize / 4)));
    }

    public boolean tryAcquire() { return permits.tryAcquire(); }

    public void release() { permits.release(); }
}

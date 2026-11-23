package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ConversationDisplayWorkAdmissionTest {
    @Test
    void derivedWorkLeavesMostDatabaseConnectionsAvailableToBusinessRequests() {
        var admission = new ConversationDisplayWorkAdmission(8);
        assertTrue(admission.tryAcquire());
        assertTrue(admission.tryAcquire());
        assertFalse(admission.tryAcquire());
        admission.release();
        assertTrue(admission.tryAcquire());
        assertFalse(admission.tryAcquire());
    }

    @Test
    void largePoolsStillBoundDerivedWorkAndSmallPoolsKeepOnePermit() {
        var large = new ConversationDisplayWorkAdmission(500);
        for (int i = 0; i < 4; i++) assertTrue(large.tryAcquire());
        assertFalse(large.tryAcquire());
        var small = new ConversationDisplayWorkAdmission(3);
        assertTrue(small.tryAcquire());
        assertFalse(small.tryAcquire());
    }
}

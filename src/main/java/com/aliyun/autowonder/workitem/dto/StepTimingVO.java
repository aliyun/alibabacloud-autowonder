package com.aliyun.autowonder.workitem.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class StepTimingVO {
    private Long stepId;
    private String name;
    private String status;
    /** Null means no measured start, not zero work. */
    private Long durationMs;
    /** Null means external-wait instrumentation is unavailable. */
    private Long externalWaitMs;
    private long otherWaitMs;
    private Long unknownMs;
    private Long afterKnownWaitMs;
    /** shortcut: tail uses the last dispatch update, excluded from observed duration; exact bounds require immutable stop evidence. */
    private long unobservedTailMs;
    private Long processingMs;
    private boolean instrumented;
    private long observationDelayMs;
    private int omittedOperationGroups;
    private java.util.List<Operation> operations = java.util.List.of();

    @Getter
    @Setter
    public static class Operation {
        private String target;
        private String operation;
        private String kind;
        private long count;
        /** Cumulative call time; parallel calls can overlap. */
        private long durationMs;
    }
}

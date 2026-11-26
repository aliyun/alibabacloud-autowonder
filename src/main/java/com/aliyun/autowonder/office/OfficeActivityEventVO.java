package com.aliyun.autowonder.office;

public record OfficeActivityEventVO(
        String id,
        String type,
        long workitemId,
        String workitemTitle,
        Long dispatchId,
        Long sourceAgentId,
        Long targetAgentId,
        String actorType,
        Long actorRef,
        String status,
        long occurredAt) {
}

package com.aliyun.autowonder.office;

import java.util.List;

public record OfficeAgentStateVO(
        long agentId,
        String state,
        boolean online,
        int runningTasks,
        List<Long> workitemIds) {
}

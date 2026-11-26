package com.aliyun.autowonder.office;

import java.util.List;

public record OfficeActivitySnapshotVO(
        long generatedAt,
        List<OfficeActivityEventVO> events,
        List<OfficeAgentStateVO> agents) {
}

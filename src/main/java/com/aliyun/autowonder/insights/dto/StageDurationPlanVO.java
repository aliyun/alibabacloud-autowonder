package com.aliyun.autowonder.insights.dto;

import lombok.Getter;
import lombok.Setter;
import java.util.List;

@Getter
@Setter
public class StageDurationPlanVO {
    private Snapshot snapshot;
    private String mode;
    private int executionCount;
    private long workitemCount;
    private int notApplicableExecutionCount;
    private int recoverableSnapshotCount;
    private String firstExecutionDate;
    private String lastExecutionDate;
    private List<Shard> shards;

    @Getter
    @Setter
    public static class Snapshot {
        private Long maxDispatchId;
        private String calculatedAt;
    }

    @Getter
    @Setter
    public static class Shard {
        private Long sdlcId;
        private String sdlcName;
        private int executionCount;
        private boolean oversized;
    }
}

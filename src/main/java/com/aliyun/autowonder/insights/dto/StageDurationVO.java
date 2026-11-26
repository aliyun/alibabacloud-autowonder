package com.aliyun.autowonder.insights.dto;

import com.aliyun.autowonder.workitem.dto.StepTimingVO;
import lombok.Getter;
import lombok.Setter;
import java.util.List;
import java.util.Map;

@Getter
@Setter
public class StageDurationVO {
    private String startDate;
    private String endDate;
    private String timezone;
    private String calculatedAt;
    private int executionCount;
    private long workitemCount;
    private int measuredExecutionCount;
    private int stageExecutionCount;
    private int noStageExecutionCount;
    private int notApplicableExecutionCount;
    private int missingDurationCount;
    private long totalDurationMs;
    private List<Stage> stages;
    private List<VersionSample> versionSamples = List.of();
    private List<FlowSnapshot> flowSnapshots = List.of();
    private int recoverableSnapshotCount;
    private Integer sampleLimit;

    @Getter
    @Setter
    public static class AgentVersion {
        private Long agentVersionId;
        private Integer agentVersionNo;
        private boolean currentAgentVersion;
        private long executionCount;
    }

    @Getter
    @Setter
    public static class Stage {
        private String key;
        private Long agentId;
        private String agentName;
        private Long agentVersionId;
        private Integer agentVersionNo;
        private Boolean currentAgentVersion;
        private Long sdlcId;
        private Long snapshotId;
        private String sdlcName;
        private Long stepId;
        private Integer stepOrder;
        private String name;
        private boolean currentDefinition;
        private int sampleCount;
        private int completedCount;
        private int activeCount;
        private int incompleteCount;
        private int reusedCount;
        private int skippedCount;
        private int missingDurationCount;
        private long totalDurationMs;
        private Long averageDurationMs;
        private Long medianDurationMs;
        private Long p90DurationMs;
        private Long externalWaitMs;
        private long otherWaitMs;
        private long unknownMs;
        private long processingMs;
        private long unobservedTailMs;
        private long afterKnownWaitMs;
        private long observationDelayMs;
        private int omittedOperationGroups;
        private int instrumentedSampleCount;
        private int coveredSampleCount;
        private Long afterKnownWaitMedianMs;
        private Long afterKnownWaitP90Ms;
        private List<StepTimingVO.Operation> operations;
        private List<Sample> slowest;
    }

    @Getter
    @Setter
    public static class Sample {
        private long dispatchId;
        private long workitemId;
        private String title;
        private String agentName;
        private Long agentId;
        private Long agentVersionId;
        private Integer agentVersionNo;
        private String dispatchStatus;
        private boolean currentAgentVersion;
        private String createdAt;
        private String status;
        private Long durationMs;
        private StepTimingVO timing;
    }

    @Getter
    @Setter
    public static class VersionSample extends Sample {
        private Long sdlcId;
        private String sdlcName;
        private Long snapshotId;
        private String snapshotSource;
        private boolean complete;
        private List<StageSample> stages;
    }

    @Getter
    @Setter
    public static class StageSample {
        private String key;
        private Long stepId;
        private Integer stepOrder;
        private String name;
        private String status;
        private Long durationMs;
        private StepTimingVO timing;
    }

    public record FlowSnapshot(long id, long sdlcId, String contentHash, String capturedAt,
                               Map<String, Object> configuration) {}

    /** remaining counts unscanned candidates in this pass; omit the cursor to retry failed or unavailable records. */
    public record Recovery(int checked, int recovered, int unavailable, int failed, int remaining, Long nextBeforeDispatchId) {}
}

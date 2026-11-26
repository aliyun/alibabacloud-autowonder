package com.aliyun.autowonder.prd;

import lombok.Data;

/** Executor-owned development server, separate from the versioned PRD document. */
@Data
public class PrdDesignRuntimeDO {
    private Long workspaceId;
    private Long workitemId;
    private Long conversationId;
    private Long executorId;
    private Long turnId;
    private Integer dispatchAttempt;
    private String sourceKey;
    private String directory;
    private String status;
    private Integer port;
    private String route;
    private String error;
    private Long revision;
    private Integer reportSequence;
}

package com.aliyun.autowonder.prd;

/** State of the design review and its subsequent delivery. */
public enum PrdDesignHandoffStatus {
    SNAPSHOTTING,
    SNAPSHOT_FAILED,
    IN_REVIEW,
    RETURNED,
    WITHDRAWN,
    PUSHING,
    PUSH_FAILED,
    ATTACHING,
    ATTACHMENT_FAILED,
    COMPLETED
}

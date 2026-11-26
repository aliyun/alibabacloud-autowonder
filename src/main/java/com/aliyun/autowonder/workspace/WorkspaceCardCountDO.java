package com.aliyun.autowonder.workspace;

import lombok.Getter;
import lombok.Setter;

/** One workspace's count from an independently aggregated card metric. */
@Getter
@Setter
public class WorkspaceCardCountDO {
    private Long workspaceId;
    private Long count;
}

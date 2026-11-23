package com.aliyun.autowonder.workspace;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkspaceBackgroundGovernanceDao {

    /**
     * Workspaces already logically deleted that still own schedulable or writing background work:
     * an enabled external binding, an ACTIVE scheduled task, or a non-terminal dispatch.
     * A workspace with nothing left to stop drops out of the result, which is what makes the
     * governance sweep convergent and safe to repeat.
     */
    List<Long> listResidualWorkspaceIds(@Param("dispatchStatuses") List<String> dispatchStatuses,
                                        @Param("limit") int limit);
}

package com.aliyun.autowonder.workitem;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkitemEventDao {
    List<com.aliyun.autowonder.workitem.dto.TimelineItemVO> listWindowKeys(
            @Param("tenantId") Long tenantId, @Param("workitemId") long workitemId,
            @Param("offset") long offset);
    void insert(WorkitemEventDO e);
    WorkitemEventDO findById(@Param("tenantId") Long tenantId, @Param("id") Long id);
    List<WorkitemEventDO> listByWorkitem(@Param("workitemId") Long workitemId);

    /** 批量读取指派事件，供工作台列表计算真人本轮等待起点；按 id 升序便于在内存取最新。 */
    List<WorkitemEventDO> listAssignEventsByWorkitemIds(@Param("tenantId") Long tenantId,
                                                        @Param("workitemIds") List<Long> workitemIds);
}

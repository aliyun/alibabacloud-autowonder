package com.aliyun.autowonder.agent;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AgentTagDao {
    List<AgentTagDO> listByAgentIds(@Param("tenantId") Long tenantId,
                                    @Param("agentIds") List<Long> agentIds);

    List<AgentTagDO> listByAgent(@Param("tenantId") Long tenantId,
                                 @Param("agentId") Long agentId);

    int deleteByAgent(@Param("tenantId") Long tenantId,
                      @Param("agentId") Long agentId);

    int insertBatch(@Param("tags") List<AgentTagDO> tags);

    List<String> listCustomTagOptions(@Param("tenantId") Long tenantId,
                                      @Param("limit") int limit);
}

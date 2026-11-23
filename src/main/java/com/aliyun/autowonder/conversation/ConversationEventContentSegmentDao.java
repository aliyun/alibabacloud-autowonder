package com.aliyun.autowonder.conversation;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface ConversationEventContentSegmentDao {

    int deleteByDisplay(@Param("displayId") long displayId,
            @Param("projectionVersion") String projectionVersion);

    int insertBatch(@Param("items") List<ConversationEventContentSegmentDO> items);

    ConversationEventContentSegmentDO findSegment(@Param("displayId") long displayId,
            @Param("projectionVersion") String projectionVersion,
            @Param("segmentIndex") int segmentIndex);

    List<ConversationEventContentSegmentDO> listSegments(@Param("displayId") long displayId,
            @Param("projectionVersion") String projectionVersion,
            @Param("afterIndex") int afterIndex, @Param("limit") int limit);

    int deleteByDisplayIds(@Param("ids") List<Long> ids);
}

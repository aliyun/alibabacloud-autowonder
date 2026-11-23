package com.aliyun.autowonder.conversation;

import lombok.Data;

import java.util.Date;

/** One UTF-8 bounded slice of a public display projection. */
@Data
public class ConversationEventContentSegmentDO {
    private Long id;
    private Long displayId;
    private String projectionVersion;
    private Integer segmentIndex;
    private String content;
    private Integer contentBytes;
    private Date gmtCreate;
}

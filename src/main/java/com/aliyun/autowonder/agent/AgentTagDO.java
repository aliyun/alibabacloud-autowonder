package com.aliyun.autowonder.agent;

import lombok.Getter;
import lombok.Setter;
import java.util.Date;

@Getter
@Setter
public class AgentTagDO {
    private Long id;
    private Long tenantId;
    private String assetType;
    private Long assetId;
    private String tagType;
    private String tagCode;
    private String tagName;
    private Date gmtCreate;
    private Long creatorId;
}

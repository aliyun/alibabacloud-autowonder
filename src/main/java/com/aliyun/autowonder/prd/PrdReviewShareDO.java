package com.aliyun.autowonder.prd;

import lombok.Data;

@Data
public class PrdReviewShareDO {
    private Long id;
    private Long workspaceId;
    private Long workitemId;
    private Long conversationId;
    private String sourceKey;
    private String token;
    private Integer enabled;
    private Integer version;
    private Long creatorId;
}

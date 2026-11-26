package com.aliyun.autowonder.prd;

import lombok.Data;
import java.util.Date;

@Data
public class PrdReviewCommentDO {
    private Long id;
    private Long workspaceId;
    private Long workitemId;
    private Long conversationId;
    private String sourceKey;
    private Long runtimeRevision;
    private String routePath;
    private String selector;
    private String elementJson;
    private String commentText;
    private String status;
    private Long creatorId;
    private String clientId;
    private Integer version;
    private Integer isDeleted;
    private Long lastSentTurnId;
    private Date gmtCreate;
    private Date gmtModified;
}

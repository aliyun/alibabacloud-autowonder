package com.aliyun.autowonder.prd;
import lombok.Data;
@Data
public class PrdReviewTunnelDO {
    private Long workspaceId;
    private Long conversationId;
    private Long executorId;
    private Long turnId;
    private Integer dispatchAttempt;
    private Integer reportSequence;
    private String bindingId;
    private String status;
}

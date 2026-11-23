package com.aliyun.autowonder.conversation;

import lombok.Data;

import java.util.Date;

/** One logical provider event prepared for bounded display. Raw slices stay in the event table. */
@Data
public class ConversationEventDisplayDO {
    public static final String STATUS_PREPARING = "PREPARING";
    public static final String STATUS_READY = "READY";
    public static final String STATUS_FAILED = "FAILED";

    /** 实时新事件：当前活动轮次优先，不与历史积压争抢调度。 */
    public static final String CLASS_REALTIME = "REALTIME";
    /** 用户正在阅读的轮次：受限交互优先级，高于后台回填。 */
    public static final String CLASS_INTERACTIVE = "INTERACTIVE";
    /** 后台批量回填：最低优先级，只在自身预算内推进。 */
    public static final String CLASS_HISTORY = "HISTORY";

    private Long id;
    private Long tenantId;
    private Long conversationId;
    private Long turnId;
    private Integer dispatchAttempt;
    private Long eventSeq;
    private String eventType;
    private String status;
    private String queueClass;
    private String projectionVersion;
    private Long publicationSeq;
    private String summary;
    private Long contentLength;
    private Integer totalSegments;
    private Integer truncated;
    private Integer detailAvailable;
    private Integer attemptCount;
    private Date nextRetryAt;
    private String leaseOwner;
    private Date leaseUntil;
    private String failureReason;
    private Integer sourceRemoved;
    private Date gmtCreate;
    private Date gmtModified;
}

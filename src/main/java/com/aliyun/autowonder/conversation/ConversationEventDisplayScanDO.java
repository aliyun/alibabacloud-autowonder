package com.aliyun.autowonder.conversation;

import lombok.Data;

import java.util.Date;

/** 后台历史发现的有界扫描进度：原始表主键范围 + 已见过的最高原始主键。 */
@Data
public class ConversationEventDisplayScanDO {

    /** 单实例共享的扫描进度行；也用于区分「尚未发现」与「确实没有可见事件」。 */
    public static final String SCAN_KEY_RAW = "RAW";

    private String scanKey;
    private Long lastRawId;
    private Long highWaterRawId;
    private Long generation;
    /** 最近一轮完整扫描没有任何补建时的顺延截止时间；为空表示每轮都要扫描。 */
    private Date quietUntil;
}

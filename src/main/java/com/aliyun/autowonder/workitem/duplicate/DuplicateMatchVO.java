package com.aliyun.autowonder.workitem.duplicate;

import lombok.Getter;
import lombok.Setter;

/** 一条重复命中：标题同名或同意图。 */
@Getter
@Setter
public class DuplicateMatchVO {
    private Long id;
    private String title;
    private String statusName;
    /** 系统播种状态节点的展示键；用户自建/改名节点为 null。 */
    private String statusLabelKey;
    private String statusCategory;
    /** 可信完整地址；无法生成时为 null，调用方回退到 id。 */
    private String url;
    /** EXACT_TITLE / SAME_INTENT */
    private String matchType;
}

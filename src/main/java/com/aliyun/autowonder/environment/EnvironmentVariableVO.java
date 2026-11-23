package com.aliyun.autowonder.environment;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Date;

@Getter
@AllArgsConstructor
public class EnvironmentVariableVO {
    private final Long id;
    private final String name;
    private final String value;
    private final String description;
    /** 预置说明展示键；用户编辑说明或改名后为 null，前端按 description 原文展示。 */
    private final String descriptionLabelKey;
    private final Date gmtCreate;
    private final Date gmtModified;
    private final Integer version;
    private final Integer onlineMountCount;
    private final Integer draftMountCount;
}

package com.aliyun.autowonder.agent;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class AgentEnvironmentVariableRefVO {
    private final Long id;
    private final String name;
    private final String description;
    private final String value;
    /** 预置说明展示键；用户编辑说明或改名后为 null。 */
    private final String descriptionLabelKey;
}

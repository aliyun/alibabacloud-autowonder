package com.aliyun.autowonder.environment;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class CreateEnvironmentVariableRequest {
    private String name;
    private String value;
    private String description;
    /** 前端选中的预置键；服务端有限注册表校验后才记录说明来源。 */
    private String presetKey;

    public CreateEnvironmentVariableRequest(String name, String value, String description) {
        this(name, value, description, null);
    }

    public CreateEnvironmentVariableRequest(String name, String value, String description, String presetKey) {
        this.name = name;
        this.value = value;
        this.description = description;
        this.presetKey = presetKey;
    }
}

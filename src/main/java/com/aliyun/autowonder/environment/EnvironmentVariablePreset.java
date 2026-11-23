package com.aliyun.autowonder.environment;

import com.aliyun.autowonder.common.i18n.SystemLabelKeys;

/**
 * 环境变量库预置项。只有注册的预置键且变量名匹配时，服务端才记录说明来源键；
 * 未注册键、名称不匹配或用户编辑说明/改名都会使来源键失效，说明按用户原文展示。
 */
public enum EnvironmentVariablePreset {
    QODER("qoder", "QODER_PERSONAL_ACCESS_TOKEN", SystemLabelKeys.ENV_PRESET_QODER),
    QODER_CN("qodercn", "QODERCN_PERSONAL_ACCESS_TOKEN", SystemLabelKeys.ENV_PRESET_QODER_CN);

    private final String key;
    private final String variableName;
    private final String labelKey;

    EnvironmentVariablePreset(String key, String variableName, String labelKey) {
        this.key = key;
        this.variableName = variableName;
        this.labelKey = labelKey;
    }

    /**
     * 解析预置说明来源键；预置键未注册或与变量名不匹配时返回 null，不接受伪造来源。
     */
    public static String labelKeyFor(String presetKey, String variableName) {
        if (presetKey == null || variableName == null) {
            return null;
        }
        for (EnvironmentVariablePreset preset : values()) {
            if (preset.key.equals(presetKey)) {
                return preset.variableName.equals(variableName) ? preset.labelKey : null;
            }
        }
        return null;
    }
}

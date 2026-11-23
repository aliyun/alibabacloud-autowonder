package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

/** 用当前表单（含未保存字段与保留密钥）做测试发送；测试成功不自动保存配置。 */
@Getter
@Setter
public class TestMailRequest extends UpdateMailSettingsRequest {
    private String recipient;
}

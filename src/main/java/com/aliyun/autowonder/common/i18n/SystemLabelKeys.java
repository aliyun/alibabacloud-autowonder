package com.aliyun.autowonder.common.i18n;

import java.util.Set;

/**
 * 系统播种/预置文案的有限展示键注册表。
 *
 * <p>只有系统播种与预置写入路径可以使用这些键；用户自定义名称、说明不携带来源键，前端按原文展示。
 * 前端只接受此处声明的键，未知键安全回退原文，禁止把任意服务端字符串当作翻译键。</p>
 */
public final class SystemLabelKeys {
    public static final String STATUS_TEMPLATE_REQ = "statusTemplate.REQ";
    public static final String STATUS_TEMPLATE_TASK = "statusTemplate.TASK";
    public static final String STATUS_TEMPLATE_BUG = "statusTemplate.BUG";

    public static final String STATUS_NODE_REQ_NEW = "statusNode.REQ.new";
    public static final String STATUS_NODE_REQ_DEVELOPING = "statusNode.REQ.developing";
    public static final String STATUS_NODE_REQ_VERIFYING = "statusNode.REQ.verifying";
    public static final String STATUS_NODE_REQ_RELEASED = "statusNode.REQ.released";
    public static final String STATUS_NODE_REQ_CANCELED = "statusNode.REQ.canceled";

    public static final String STATUS_NODE_TASK_TODO = "statusNode.TASK.todo";
    public static final String STATUS_NODE_TASK_DOING = "statusNode.TASK.doing";
    public static final String STATUS_NODE_TASK_DONE = "statusNode.TASK.done";

    public static final String STATUS_NODE_BUG_OPEN = "statusNode.BUG.open";
    public static final String STATUS_NODE_BUG_FIXING = "statusNode.BUG.fixing";
    public static final String STATUS_NODE_BUG_VERIFYING = "statusNode.BUG.verifying";
    public static final String STATUS_NODE_BUG_CLOSED = "statusNode.BUG.closed";

    public static final String STATUS_TRANSITION_FORWARD = "statusTransition.forward";
    public static final String STATUS_TRANSITION_CANCEL = "statusTransition.cancel";

    public static final String ENV_PRESET_QODER = "envPreset.qoder";
    public static final String ENV_PRESET_QODER_CN = "envPreset.qodercn";

    private static final Set<String> REGISTERED = Set.of(
            STATUS_TEMPLATE_REQ, STATUS_TEMPLATE_TASK, STATUS_TEMPLATE_BUG,
            STATUS_NODE_REQ_NEW, STATUS_NODE_REQ_DEVELOPING, STATUS_NODE_REQ_VERIFYING,
            STATUS_NODE_REQ_RELEASED, STATUS_NODE_REQ_CANCELED,
            STATUS_NODE_TASK_TODO, STATUS_NODE_TASK_DOING, STATUS_NODE_TASK_DONE,
            STATUS_NODE_BUG_OPEN, STATUS_NODE_BUG_FIXING, STATUS_NODE_BUG_VERIFYING,
            STATUS_NODE_BUG_CLOSED,
            STATUS_TRANSITION_FORWARD, STATUS_TRANSITION_CANCEL,
            ENV_PRESET_QODER, ENV_PRESET_QODER_CN);

    private SystemLabelKeys() {
    }

    public static boolean isRegistered(String key) {
        return key != null && REGISTERED.contains(key);
    }
}

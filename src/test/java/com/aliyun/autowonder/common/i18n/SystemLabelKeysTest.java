package com.aliyun.autowonder.common.i18n;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SystemLabelKeysTest {

    @Test
    void registersEveryDeclaredKey() {
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_TEMPLATE_REQ));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_TEMPLATE_TASK));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_TEMPLATE_BUG));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_REQ_NEW));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_REQ_DEVELOPING));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_REQ_VERIFYING));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_REQ_RELEASED));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_REQ_CANCELED));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_TASK_TODO));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_TASK_DOING));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_TASK_DONE));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_BUG_OPEN));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_BUG_FIXING));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_BUG_VERIFYING));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_NODE_BUG_CLOSED));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_TRANSITION_FORWARD));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.STATUS_TRANSITION_CANCEL));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.ENV_PRESET_QODER));
        assertTrue(SystemLabelKeys.isRegistered(SystemLabelKeys.ENV_PRESET_QODER_CN));
    }

    @Test
    void rejectsUnknownAndMissingKeys() {
        assertFalse(SystemLabelKeys.isRegistered(null));
        assertFalse(SystemLabelKeys.isRegistered(""));
        assertFalse(SystemLabelKeys.isRegistered("statusNode.REQ.unknown"));
        assertFalse(SystemLabelKeys.isRegistered("user.custom"));
    }
}

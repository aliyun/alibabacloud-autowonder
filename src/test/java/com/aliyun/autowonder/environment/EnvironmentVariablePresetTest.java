package com.aliyun.autowonder.environment;

import com.aliyun.autowonder.common.i18n.SystemLabelKeys;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class EnvironmentVariablePresetTest {

    @Test
    void resolvesRegisteredPresetOnlyForItsOwnVariableName() {
        assertEquals(SystemLabelKeys.ENV_PRESET_QODER,
                EnvironmentVariablePreset.labelKeyFor("qoder", "QODER_PERSONAL_ACCESS_TOKEN"));
        assertEquals(SystemLabelKeys.ENV_PRESET_QODER_CN,
                EnvironmentVariablePreset.labelKeyFor("qodercn", "QODERCN_PERSONAL_ACCESS_TOKEN"));
    }

    @Test
    void rejectsUnknownPresetAndMismatchedName() {
        assertNull(EnvironmentVariablePreset.labelKeyFor(null, "QODER_PERSONAL_ACCESS_TOKEN"));
        assertNull(EnvironmentVariablePreset.labelKeyFor("unknown", "QODER_PERSONAL_ACCESS_TOKEN"));
        assertNull(EnvironmentVariablePreset.labelKeyFor("qoder", "QODERCN_PERSONAL_ACCESS_TOKEN"));
        assertNull(EnvironmentVariablePreset.labelKeyFor("qoder", "CUSTOM_TOKEN"));
        assertNull(EnvironmentVariablePreset.labelKeyFor("qoder", null));
    }
}

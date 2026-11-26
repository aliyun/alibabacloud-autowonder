package com.aliyun.autowonder.agent;

/**
 * Platform-provided digital worker tags. Only the stable code is persisted; display names live in
 * the frontend locales and mirror {@link #getZhName()}/{@link #getEnName()} so the backend can
 * reject custom tags that only differ by case from a localized system tag name.
 */
public enum AgentSystemTag {
    REQ_CLARIFY("REQ_CLARIFY", "需求澄清", "Requirement Clarification"),
    PROTOTYPE_DESIGN("PROTOTYPE_DESIGN", "原型设计", "Prototype Design");

    private final String code;
    private final String zhName;
    private final String enName;

    AgentSystemTag(String code, String zhName, String enName) {
        this.code = code;
        this.zhName = zhName;
        this.enName = enName;
    }

    public String getCode() {
        return code;
    }

    public String getZhName() {
        return zhName;
    }

    public String getEnName() {
        return enName;
    }

    /** Case-insensitive, trimmed lookup; null means the code is not a supported system tag. */
    public static AgentSystemTag fromCode(String rawCode) {
        if (rawCode == null) {
            return null;
        }
        String value = rawCode.trim();
        for (AgentSystemTag tag : values()) {
            if (tag.code.equalsIgnoreCase(value)) {
                return tag;
            }
        }
        return null;
    }

    /** True when the custom tag name collides with this tag's Chinese or English display name. */
    public boolean matchesDisplayName(String name) {
        if (name == null) {
            return false;
        }
        String normalized = name.trim();
        return zhName.equalsIgnoreCase(normalized) || enName.equalsIgnoreCase(normalized);
    }
}

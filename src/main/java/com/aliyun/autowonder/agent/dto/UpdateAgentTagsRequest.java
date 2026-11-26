package com.aliyun.autowonder.agent.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/** Full replacement payload for PUT /api/agents/{id}/tags. */
@Getter
@Setter
public class UpdateAgentTagsRequest {
    /** System tag codes; unknown codes are rejected instead of being stored. */
    private List<String> systemTags;
    /** Free-form custom tag names, trimmed and silently deduplicated. */
    private List<String> customTags;
}

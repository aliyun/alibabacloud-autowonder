package com.aliyun.autowonder.sdlc;

import com.aliyun.autowonder.json.JSON;
import lombok.Getter;
import lombok.Setter;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;

@Getter
@Setter
public class SdlcExecutionSnapshot {
    private Long id;
    private Long workspaceId;
    private Long sdlcId;
    private String contentHash;
    private String configurationJson;
    private Date gmtCreate;

    public static SdlcExecutionSnapshot from(long workspaceId, long sdlcId, Map<String, Object> configuration) {
        if (workspaceId <= 0 || sdlcId <= 0 || configuration == null
                || !(configuration.get("steps") instanceof List<?> steps) || steps.isEmpty()) return null;
        Set<String> ids = new HashSet<>();
        for (Object raw : steps) {
            if (!(raw instanceof Map<?, ?> step) || !(step.get("id") instanceof String id)
                    || id.isBlank() || !ids.add(id)) return null;
            for (String field : List.of("name", "kind", "instruction"))
                if (step.get(field) != null && !(step.get(field) instanceof String)) return null;
            if (step.get("required") != null && !(step.get("required") instanceof Boolean)) return null;
        }
        var stable = new TreeMap<>(configuration);
        // The entry cursor identifies an execution, not a different workflow configuration.
        stable.remove("currentStepId");
        // Observation settings do not change the workflow being compared.
        stable.remove("stageTimingEnabled");
        stable.remove("sdlcId");
        stable.remove("id");
        SdlcExecutionSnapshot value = new SdlcExecutionSnapshot();
        value.setWorkspaceId(workspaceId);
        value.setSdlcId(sdlcId);
        value.setConfigurationJson(JSON.toJSONString(canonical(stable)));
        value.setContentHash(sha256(value.getConfigurationJson().getBytes(StandardCharsets.UTF_8)));
        return value;
    }

    private static Object canonical(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach((key, child) -> sorted.put(String.valueOf(key), canonical(child)));
            return sorted;
        }
        if (value instanceof List<?> list) return list.stream().map(SdlcExecutionSnapshot::canonical).toList();
        return value;
    }

    public static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}

package com.aliyun.autowonder.workitem;

import com.aliyun.autowonder.dispatch.DispatchRuntimeEventDO;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONArray;
import com.aliyun.autowonder.json.JSONObject;
import com.aliyun.autowonder.sdlc.SdlcStepDO;
import com.aliyun.autowonder.workitem.dto.StepTimingVO;

import java.util.*;
import java.util.regex.Pattern;

/** Versioned, replaceable runtime snapshots, scoped to one dispatch and step. */
final class StepTimingSummaries {
    private static final int MAX_OPERATION_GROUPS = 32;
    private static final Pattern OPERATION_LABEL = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.-]{0,63}");

    private StepTimingSummaries() {}

    static Map<SdlcStepDO, Map<String, JSONObject>> index(Iterable<DispatchRuntimeEventDO> events, List<SdlcStepDO> steps) {
        Map<String, List<SdlcStepDO>> identities = new HashMap<>();
        for (SdlcStepDO step : steps)
            for (String key : List.of("id:" + step.getId(), "key:" + step.getCode(), "order:" + step.getStepOrder()))
                identities.computeIfAbsent(key, ignored -> new ArrayList<>()).add(step);
        Map<SdlcStepDO, Map<String, JSONObject>> indexed = new IdentityHashMap<>();
        for (DispatchRuntimeEventDO event : events) {
            if (!"step.timing".equals(event.getEventType())) continue;
            String key;
            if (event.getStepId() != null) key = "id:" + event.getStepId();
            else if (event.getStepKey() != null && !event.getStepKey().isBlank()) key = "key:" + event.getStepKey();
            else if (event.getStepOrder() != null) key = "order:" + event.getStepOrder();
            else continue;
            var matches = identities.getOrDefault(key, List.of()).stream().filter(step -> belongsTo(event, step)).toList();
            if (matches.size() != 1 || event.getDetailJson() == null) continue;
            try {
                JSONObject summary = JSON.parseObject(event.getDetailJson()).getJSONObject("timing");
                if (valid(summary)) {
                    // A spilled history may contain many replays of the same segment.
                    var latest = indexed.computeIfAbsent(matches.getFirst(), ignored -> new LinkedHashMap<>());
                    JSONObject previous = latest.get(summary.getString("segmentId"));
                    if (previous == null || summary.getLongValue("elapsedMs") > previous.getLongValue("elapsedMs")
                            || (summary.getLongValue("elapsedMs") == previous.getLongValue("elapsedMs") && summary.getBooleanValue("complete"))) {
                        latest.put(summary.getString("segmentId"), summary);
                    }
                }
            } catch (RuntimeException ignored) {
                // Malformed/unsupported telemetry stays unknown; it cannot become a measured zero.
            }
        }
        return indexed;
    }

    static void apply(StepTimingVO timing, Map<String, JSONObject> latest) {
        if (timing.getDurationMs() == null || latest.isEmpty()) return;
        long remaining = Math.max(0, timing.getDurationMs() - timing.getOtherWaitMs());
        long external = 0, processing = 0, other = 0, delay = 0;
        long unallocated = remaining;
        boolean summariesFit = true;
        for (JSONObject summary : latest.values()) {
            long elapsed = summary.getLongValue("elapsedMs");
            if (elapsed > unallocated) { summariesFit = false; break; }
            unallocated -= elapsed;
        }
        int omittedGroups = 0;
        boolean accepted = false;
        Map<String, StepTimingVO.Operation> operations = new LinkedHashMap<>();
        for (JSONObject summary : latest.values()) {
            omittedGroups = (int) Math.min(Integer.MAX_VALUE, (long) omittedGroups + summary.getIntValue("omittedOperationGroups"));
            Object groupValue = summary.get("operations");
            // Without segment start times, overflow cannot be attributed by arrival order.
            if (!summariesFit) {
                if (groupValue instanceof JSONArray groups)
                    omittedGroups = (int) Math.min(Integer.MAX_VALUE, (long) omittedGroups + groups.size());
                continue;
            }
            accepted = true;
            external += summary.getLongValue("externalWaitMs");
            other += summary.getLongValue("otherWaitMs");
            processing += summary.getLongValue("processingMs");
            remaining -= summary.getLongValue("externalWaitMs") + summary.getLongValue("otherWaitMs") + summary.getLongValue("processingMs");
            delay += summary.getLongValue("observationDelayMs");
            if (groupValue instanceof JSONArray groups)
                omittedGroups = (int) Math.min(Integer.MAX_VALUE, (long) omittedGroups + Math.max(0, groups.size() - MAX_OPERATION_GROUPS));
            if (groupValue instanceof JSONArray groups) for (int index = 0; index < Math.min(groups.size(), MAX_OPERATION_GROUPS); index++) {
                if (!(groups.get(index) instanceof JSONObject group) || !validGroup(group)) {
                    omittedGroups = (int) Math.min(Integer.MAX_VALUE, (long) omittedGroups + 1);
                    continue;
                }
                String key = group.getString("target") + "/" + group.getString("operation") + "/" + group.getString("kind");
                if (operations.size() == MAX_OPERATION_GROUPS && !operations.containsKey(key)) {
                    omittedGroups = (int) Math.min(Integer.MAX_VALUE, (long) omittedGroups + 1);
                    continue;
                }
                StepTimingVO.Operation total = operations.computeIfAbsent(key, ignored -> {
                    var value = new StepTimingVO.Operation();
                    value.setTarget(group.getString("target")); value.setOperation(group.getString("operation")); value.setKind(group.getString("kind"));
                    return value;
                });
                try {
                    long count = Math.addExact(total.getCount(), group.getLongValue("count"));
                    long duration = Math.addExact(total.getDurationMs(), group.getLongValue("durationMs"));
                    total.setCount(count); total.setDurationMs(duration);
                } catch (ArithmeticException ignored) { omittedGroups = (int) Math.min(Integer.MAX_VALUE, (long) omittedGroups + 1); }
            }
        }
        timing.setOmittedOperationGroups(omittedGroups);
        if (!accepted) return;
        timing.setInstrumented(true);
        timing.setExternalWaitMs(external);
        timing.setOtherWaitMs(timing.getOtherWaitMs() + other);
        timing.setProcessingMs(processing);
        timing.setUnknownMs(remaining);
        timing.setAfterKnownWaitMs(processing + remaining);
        timing.setObservationDelayMs(delay);
        timing.setOperations(new ArrayList<>(operations.values()));
    }

    private static boolean belongsTo(DispatchRuntimeEventDO event, SdlcStepDO step) {
        if (event.getStepId() != null) return Objects.equals(event.getStepId(), step.getId())
                && (event.getStepOrder() == null || Objects.equals(event.getStepOrder(), step.getStepOrder()));
        if (event.getStepKey() != null && !event.getStepKey().isBlank()) return Objects.equals(event.getStepKey(), step.getCode())
                && (event.getStepOrder() == null || Objects.equals(event.getStepOrder(), step.getStepOrder()));
        return event.getStepOrder() != null && Objects.equals(event.getStepOrder(), step.getStepOrder());
    }

    private static boolean valid(JSONObject value) {
        if (value == null || value.getIntValue("version") != 1 || value.getString("segmentId") == null
                || value.getString("segmentId").isBlank() || value.getString("segmentId").length() > 512) return false;
        long sum = 0;
        for (String key : List.of("elapsedMs", "externalWaitMs", "unknownMs", "processingMs")) {
            if (!nonnegativeInteger(value.get(key))) return false;
        }
        for (String key : List.of("externalWaitMs", "otherWaitMs", "unknownMs", "processingMs")) {
            if (value.containsKey(key) && !nonnegativeInteger(value.get(key))) return false;
            sum = Math.addExact(sum, value.getLongValue(key));
        }
        if (value.containsKey("observationDelayMs") && !nonnegativeInteger(value.get("observationDelayMs"))) return false;
        if (value.containsKey("omittedOperationGroups") && (!nonnegativeInteger(value.get("omittedOperationGroups"))
                || value.getLongValue("omittedOperationGroups") > Integer.MAX_VALUE)) return false;
        return sum == value.getLongValue("elapsedMs") && value.getLongValue("observationDelayMs") <= value.getLongValue("processingMs");
    }

    private static boolean nonnegativeInteger(Object value) {
        return (value instanceof Integer || value instanceof Long) && ((Number) value).longValue() >= 0;
    }

    private static boolean validGroup(JSONObject group) {
        if (group == null) return false;
        for (String key : List.of("target", "operation", "kind")) {
            String label = group.getString(key);
            if (label == null || !OPERATION_LABEL.matcher(label).matches()) return false;
        }
        return nonnegativeInteger(group.get("count")) && nonnegativeInteger(group.get("durationMs"));
    }
}

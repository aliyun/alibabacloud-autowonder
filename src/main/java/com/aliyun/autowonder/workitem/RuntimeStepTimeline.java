package com.aliyun.autowonder.workitem;

import com.aliyun.autowonder.common.i18n.SystemMessages;
import com.aliyun.autowonder.dispatch.DispatchRuntimeEventDO;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.sdlc.SdlcStepDO;
import com.aliyun.autowonder.util.MojibakeDetector;
import com.aliyun.autowonder.workitem.dto.SubStepVO;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/** Derives SDLC status, elapsed time and display details from dispatch events. */
class RuntimeStepTimeline {
    private final Map<Integer, DispatchRuntimeEventDO> lastByOrder;
    private final Map<Integer, DispatchRuntimeEventDO> stateByOrder;
    private final Map<Integer, List<SubStepVO>> detailsByOrder;
    private final Integer latestOrder;
    private final Map<Integer, StepDuration> durationByOrder;

    private RuntimeStepTimeline(Map<Integer, DispatchRuntimeEventDO> lastByOrder,
                                Map<Integer, DispatchRuntimeEventDO> stateByOrder,
                                Map<Integer, List<SubStepVO>> detailsByOrder,
                                Integer latestOrder, Map<Integer, StepDuration> durationByOrder) {
        this.lastByOrder = lastByOrder;
        this.stateByOrder = stateByOrder;
        this.detailsByOrder = detailsByOrder;
        this.latestOrder = latestOrder;
        this.durationByOrder = durationByOrder;
    }

    static RuntimeStepTimeline from(List<DispatchRuntimeEventDO> events, List<SdlcStepDO> steps, Date now) {
        return build(events, steps, now, false, true, null);
    }

    static RuntimeStepTimeline fromTimings(List<DispatchRuntimeEventDO> events, List<SdlcStepDO> steps, Date now) {
        return build(events, steps, now, false, false, null);
    }

    // Database progress events already arrive by increasing id, including failover boundaries.
    static RuntimeStepTimeline fromProgress(Iterable<DispatchRuntimeEventDO> events, List<SdlcStepDO> steps,
                                            Date now, boolean includeDetails, DeliveryProgressSpill spill) {
        return build(events, steps, now, true, includeDetails, spill);
    }

    private static RuntimeStepTimeline build(Iterable<DispatchRuntimeEventDO> events, List<SdlcStepDO> steps,
                                             Date now, boolean ordered, boolean includeDetails,
                                             DeliveryProgressSpill spill) {
        Map<Integer, SdlcStepDO> stepsByOrder = steps.stream()
                .filter(s -> s.getStepOrder() != null)
                .collect(Collectors.toMap(SdlcStepDO::getStepOrder, s -> s, (a, b) -> a, LinkedHashMap::new));
        Map<Long, Integer> orderByStepId = steps.stream()
                .filter(s -> s.getId() != null && s.getStepOrder() != null)
                .collect(Collectors.toMap(SdlcStepDO::getId, SdlcStepDO::getStepOrder, (a, b) -> a));
        Map<String, Integer> orderByName = steps.stream()
                .filter(s -> s.getName() != null && s.getStepOrder() != null)
                .collect(Collectors.toMap(s -> s.getName().trim(), SdlcStepDO::getStepOrder, (a, b) -> a));
        Map<String, Integer> orderByCode = steps.stream()
                .filter(s -> s.getCode() != null && !s.getCode().isBlank() && s.getStepOrder() != null)
                .collect(Collectors.toMap(s -> s.getCode().trim(), SdlcStepDO::getStepOrder, (a, b) -> a));

        Map<Integer, DispatchRuntimeEventDO> last = new LinkedHashMap<>();
        Map<Integer, DispatchRuntimeEventDO> state = new LinkedHashMap<>();
        Map<Integer, List<SubStepVO>> details = new LinkedHashMap<>();
        Map<Integer, StepDuration> timing = new LinkedHashMap<>();
        List<DispatchRuntimeEventDO> unsortedBoundaries = new ArrayList<>();
        Integer latestOrder = null;
        DispatchRuntimeEventDO latestEvent = null;
        for (DispatchRuntimeEventDO event : events) {
            String type = event.getEventType();
            if ("step.timing".equals(type) || "operation.timing".equals(type)) continue;
            Integer order = resolveOrder(event, stepsByOrder, orderByStepId, orderByName, orderByCode);
            if (isTimingBoundary(type)) {
                if (ordered) applyBoundary(timing, order, event);
                else unsortedBoundaries.add(event);
            }
            if ("dispatch.executor_failover".equals(type)) {
                last.clear();
                state.clear();
                if (spill != null) details.values().forEach(spill::discard);
                details.clear();
                latestOrder = null;
                latestEvent = null;
                continue;
            }
            if (order == null) continue;

            last.put(order, event);
            if (type != null && (type.startsWith("step.") || "completion_requested".equals(type)
                    || "dispatch.completed".equals(type) || isFailureEvent(event))) {
                state.put(order, event);
            }
            if (includeDetails) {
                List<SubStepVO> rows = details.computeIfAbsent(order,
                        ignored -> spill == null ? new ArrayList<>() : spill.list(SubStepVO.class));
                SubStepVO detail = new SubStepVO();
                detail.setFallbackCode(fallbackCodeOf(event));
                detail.setName(labelOf(event));
                detail.setStatus(isFailureEvent(event) ? "failed" : "done");
                rows.add(detail);
            }
            if (latestEvent == null || compareEvent(event, latestEvent) >= 0) {
                latestEvent = event;
                latestOrder = order;
            }
        }
        for (DispatchRuntimeEventDO event : sortedByTime(unsortedBoundaries)) {
            Integer order = resolveOrder(event, stepsByOrder, orderByStepId, orderByName, orderByCode);
            applyBoundary(timing, order, event);
        }
        timing.values().forEach(duration -> duration.total += positiveDelta(duration.openStart, now));
        return new RuntimeStepTimeline(last, state, details, latestOrder, timing);
    }

    String statusOf(SdlcStepDO step) {
        if (latestOrder == null || step.getStepOrder() == null) {
            return null;
        }
        int order = step.getStepOrder();
        DispatchRuntimeEventDO stateEvent = stateByOrder.get(order);
        if (stateEvent != null) {
            String type = stateEvent.getEventType();
            if ("step.completed".equals(type) || "step.reused".equals(type)
                    || "dispatch.completed".equals(type)) return "done";
            if ("step.stale".equals(type)) return "pending";
            if (isFailureEvent(stateEvent)) return "failed";
        }
        return order == latestOrder ? "active" : "pending";
    }

    boolean isCurrent(SdlcStepDO step) {
        return latestOrder != null && Objects.equals(latestOrder, step.getStepOrder());
    }

    List<SubStepVO> subStepsOf(SdlcStepDO step, String stepStatus) {
        if (step.getStepOrder() == null) {
            return List.of();
        }
        List<SubStepVO> details = detailsByOrder.get(step.getStepOrder());
        if (details == null || details.isEmpty()) return List.of();

        if (!"active".equals(stepStatus) && !"paused".equals(stepStatus) && !"failed".equals(stepStatus)) {
            return details;
        }
        return new java.util.AbstractList<>() {
            @Override
            public SubStepVO get(int index) {
                return withFinalStatus(details.get(index), index == size() - 1);
            }

            @Override
            public int size() {
                return details.size();
            }

            @Override
            public java.util.Iterator<SubStepVO> iterator() {
                var iterator = details.iterator();
                return new java.util.Iterator<>() {
                    private int index;

                    @Override
                    public boolean hasNext() {
                        return iterator.hasNext();
                    }

                    @Override
                    public SubStepVO next() {
                        return withFinalStatus(iterator.next(), ++index == size());
                    }
                };
            }

            private SubStepVO withFinalStatus(SubStepVO detail, boolean last) {
                if (!last || "failed".equals(detail.getStatus())) return detail;
                SubStepVO result = new SubStepVO();
                result.setFallbackCode(detail.getFallbackCode());
                result.setName(detail.getName());
                result.setStatus(stepStatus);
                return result;
            }
        };
    }

    DispatchRuntimeEventDO lastEventOf(SdlcStepDO step) {
        return lastByOrder.get(step.getStepOrder());
    }

    Long durationOf(SdlcStepDO step) {
        if (step == null || step.getStepOrder() == null) {
            return null;
        }
        StepDuration duration = durationByOrder.get(step.getStepOrder());
        return duration == null ? null : duration.total;
    }

    long otherWaitOf(SdlcStepDO step) {
        StepDuration duration = durationByOrder.get(step.getStepOrder());
        return duration == null ? 0 : duration.otherWait;
    }

    boolean isOpen(SdlcStepDO step) {
        StepDuration duration = durationByOrder.get(step.getStepOrder());
        return duration != null && duration.openStart != null;
    }

    /** event_time 可空（客户端上报），回退到服务端落库时间 gmt_create。 */
    private static Date at(DispatchRuntimeEventDO e) {
        return e.getEventTime() != null ? e.getEventTime() : e.getGmtCreate();
    }

    private static long positiveDelta(Date from, Date to) {
        if (from == null || to == null) {
            return 0L;
        }
        long delta = to.getTime() - from.getTime();
        return delta > 0 ? delta : 0L;
    }

    /**
     * 返回按到达顺序（id 升序，event time 兜底）排好的副本，供区间配对使用。
     * 绝不就地排序入参 —— 原桶的插入顺序被 lastEvent 依赖。
     * 以到达顺序为主：客户端时钟回拨时，terminal 的时间可能早于 started，
     * 按时间排序会让 terminal 排到 started 前面而无法配对；按到达顺序配对后由
     * positiveDelta 把负区间夹到 0。
     */
    private static List<DispatchRuntimeEventDO> sortedByTime(List<DispatchRuntimeEventDO> bucket) {
        List<DispatchRuntimeEventDO> copy = new ArrayList<>(bucket);
        copy.sort(Comparator
                .comparingLong((DispatchRuntimeEventDO e) -> e.getId() == null ? Long.MIN_VALUE : e.getId())
                .thenComparingLong(e -> {
                    Date at = at(e);
                    return at == null ? Long.MIN_VALUE : at.getTime();
                }));
        return copy;
    }

    private static final Set<String> TERMINAL_EVENT_TYPES = Set.of(
            "step.completed", "step.failed", "step.reused", "step.stale", "step.skipped", "step.cancelled", "step.blocked",
            "dispatch.failed", "dispatch.cancelled", "dispatch.completed");
    private static final Set<String> STOP_EVENTS = Set.of("session.interrupted", "session.failed",
            "session.cancelled", "dispatch.paused");
    private static final Set<String> RESUME_EVENTS = Set.of("session.resumed", "dispatch.resumed", "dispatch.recovered");

    static boolean isTimingBoundary(String type) {
        return type != null && ("step.started".equals(type) || "dispatch.executor_failover".equals(type)
                || TERMINAL_EVENT_TYPES.contains(type) || STOP_EVENTS.contains(type) || RESUME_EVENTS.contains(type));
    }

    static boolean hasStepIdentity(DispatchRuntimeEventDO event) {
        return event.getStepId() != null || event.getStepOrder() != null
                || event.getStepKey() != null && !event.getStepKey().isBlank()
                || event.getStepName() != null && !event.getStepName().isBlank();
    }

    private static void applyBoundary(Map<Integer, StepDuration> timing, Integer order, DispatchRuntimeEventDO event) {
        String type = event.getEventType();
        Date time = at(event);
        if ("step.started".equals(type)) {
            if (order == null) return;
            // A later stage cannot resume an earlier interrupted stage.
            timing.forEach((other, duration) -> {
                if (!order.equals(other)) duration.stoppedAt = null;
            });
            StepDuration duration = timing.computeIfAbsent(order, ignored -> new StepDuration());
            if (duration.openStart == null) {
                Integer attempt = stepAttempt(event);
                if (duration.paused && Objects.equals(attempt, duration.attempt)
                        && (attempt == null || attempt > 0)) duration.resume(time);
                duration.attempt = attempt;
                duration.openStart = time;
                duration.stoppedAt = null;
            }
        } else if (type.startsWith("dispatch.") || type.startsWith("session.") && !hasStepIdentity(event)) {
            // Older runtimes can report pause and resume without a step identity.
            timing.values().forEach(duration -> duration.accept(type, time));
        } else {
            StepDuration duration = timing.get(order);
            if (duration != null) duration.accept(type, time);
        }
    }

    private static Integer stepAttempt(DispatchRuntimeEventDO event) {
        if (event.getDetailJson() == null) return null;
        try {
            var detail = JSON.parseObject(event.getDetailJson());
            return detail == null ? null : detail.getInteger("stepAttempt");
        } catch (RuntimeException invalidDetail) {
            return -1;
        }
    }

    private static final class StepDuration {
        private long total;
        private long otherWait;
        private Date openStart;
        private Date stoppedAt;
        private Integer attempt;
        private boolean paused;

        private void resume(Date time) {
            if (stoppedAt == null) return;
            long wait = positiveDelta(stoppedAt, time);
            total += wait;
            otherWait += wait;
            openStart = time;
            stoppedAt = null;
        }

        private void accept(String type, Date time) {
            if (STOP_EVENTS.contains(type)) {
                paused = (openStart != null || paused)
                        && ("dispatch.paused".equals(type) || "session.interrupted".equals(type));
                if (openStart != null) {
                    total += positiveDelta(openStart, time);
                    openStart = null;
                    stoppedAt = time;
                }
            } else if (RESUME_EVENTS.contains(type)) {
                resume(time);
            } else {
                total += positiveDelta(openStart, time);
                openStart = null;
                stoppedAt = null;
            }
        }
    }

    private static Integer resolveOrder(DispatchRuntimeEventDO event, Map<Integer, SdlcStepDO> stepsByOrder,
                                        Map<Long, Integer> orderByStepId, Map<String, Integer> orderByName,
                                        Map<String, Integer> orderByCode) {
        if (event.getStepOrder() != null && stepsByOrder.containsKey(event.getStepOrder())) {
            return event.getStepOrder();
        }
        if (event.getStepId() != null && orderByStepId.containsKey(event.getStepId())) {
            return orderByStepId.get(event.getStepId());
        }
        if (event.getStepKey() != null) {
            Integer order = orderByCode.get(event.getStepKey().trim());
            if (order != null) {
                return order;
            }
        }
        if (event.getStepName() != null) {
            Integer order = orderByName.get(event.getStepName().trim());
            if (order != null) {
                return order;
            }
        }
        return null;
    }

    private static int compareEvent(DispatchRuntimeEventDO left, DispatchRuntimeEventDO right) {
        if (right == null) {
            return 1;
        }
        if (left.getId() != null && right.getId() != null) {
            return left.getId().compareTo(right.getId());
        }
        if (left.getGmtCreate() != null && right.getGmtCreate() != null) {
            return left.getGmtCreate().compareTo(right.getGmtCreate());
        }
        return 0;
    }

    private static boolean isCompletionEvent(String eventType) {
        return "step.completed".equals(eventType)
                || "step.completion_requested".equals(eventType)
                || "completion_requested".equals(eventType)
                || "dispatch.completed".equals(eventType);
    }

    private static boolean isFailureEvent(DispatchRuntimeEventDO event) {
        String type = event.getEventType();
        return event.getError() != null
                || "step.failed".equals(type)
                || "dispatch.failed".equals(type);
    }

    private static String labelOf(DispatchRuntimeEventDO event) {
        if (event.getMessage() != null && !event.getMessage().isBlank()
                && !MojibakeDetector.looksLikeMojibake(event.getMessage())) {
            return event.getMessage();
        }
        String eventLabel = runtimeEventLabel(event.getEventType());
        if (eventLabel != null) {
            return SystemMessages.render("workitem.substep." + fallbackCodeOf(event).toLowerCase(java.util.Locale.ROOT), new Object[0], eventLabel);
        }
        if (event.getEventType() != null) {
            return event.getEventType();
        }
        return SystemMessages.render("workitem.substep.runtime_progress", new Object[0], "运行进度");
    }

    private static String fallbackCodeOf(DispatchRuntimeEventDO event) {
        if (event.getMessage() != null && !event.getMessage().isBlank()
                && !MojibakeDetector.looksLikeMojibake(event.getMessage())) return null;
        String type = event.getEventType();
        if (type == null) return "RUNTIME_PROGRESS";
        if (type.startsWith("step.started")) return "START_EXECUTION";
        if (isCompletionEvent(type)) return "REQUEST_COMPLETION";
        return switch (type) {
            case "step.gate_started" -> "START_GATE";
            case "step.gate_finished" -> "FINISH_GATE";
            case "step.fix_required" -> "FIX_REQUIRED";
            case "step.failed", "dispatch.failed" -> "EXECUTION_FAILED";
            default -> null;
        };
    }

    private static String runtimeEventLabel(String eventType) {
        if (eventType == null) {
            return null;
        }
        if (eventType.startsWith("step.started")) {
            return "开始执行";
        }
        if (isCompletionEvent(eventType)) {
            return "请求完成";
        }
        if ("step.gate_started".equals(eventType)) {
            return "开始校验";
        }
        if ("step.gate_finished".equals(eventType)) {
            return "校验完成";
        }
        if ("step.fix_required".equals(eventType)) {
            return "需要修复";
        }
        if ("step.failed".equals(eventType) || "dispatch.failed".equals(eventType)) {
            return "执行失败";
        }
        return null;
    }
}

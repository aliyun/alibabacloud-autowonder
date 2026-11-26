package com.aliyun.autowonder.dispatch;

import com.aliyun.autowonder.aiusage.DispatchAiUsageDO;
import com.aliyun.autowonder.aiusage.DispatchAiUsageDao;
import com.aliyun.autowonder.dispatch.dto.RuntimeTraceVO;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Fills a trace the provider never reported usage for with the usage already attributed to the
 * dispatch (Token Proxy rows ingested from {@code observability/usage.json}). Qoder ACP turns emit
 * no {@code llm.usage}, so a trace that stays provider-only would show credits as unavailable while
 * the same dispatch is already credited. A trace carrying provider usage is left untouched so a
 * request recorded by both paths is counted once. Session and turn detail only attach when a step
 * maps to exactly one turn.
 */
@Service
public class RuntimeTraceUsageFallback {

    static final String TOKEN_PROXY_SOURCE = "TOKEN_PROXY";

    private final DispatchAiUsageDao usageDao;

    public RuntimeTraceUsageFallback(DispatchAiUsageDao usageDao) {
        this.usageDao = usageDao;
    }

    public void apply(long tenantId, long dispatchId, RuntimeTraceVO trace) {
        if (trace == null || trace.getTokenUsage() == null || trace.getTokenUsage().isAvailable()) {
            return;
        }
        List<DispatchAiUsageDO> rows = usageDao.listByDispatchIds(tenantId, List.of(dispatchId));
        if (rows == null || rows.isEmpty()) {
            return;
        }
        RuntimeTraceVO.TokenUsage total = newUsage();
        Map<String, RuntimeTraceVO.TokenUsage> byStep = new LinkedHashMap<>();
        boolean recorded = false;
        for (DispatchAiUsageDO row : rows) {
            if (row == null) {
                continue;
            }
            recorded = true;
            add(total, row);
            String stepId = row.getStepId();
            if (stepId != null && !stepId.isBlank()) {
                add(byStep.computeIfAbsent(stepId, key -> newUsage()), row);
            }
        }
        if (!recorded) {
            return;
        }
        attachToTurns(trace, byStep);
        trace.setTokenUsage(total);
    }

    private static void attachToTurns(RuntimeTraceVO trace, Map<String, RuntimeTraceVO.TokenUsage> byStep) {
        if (byStep.isEmpty()) {
            return;
        }
        Map<String, List<RuntimeTraceVO.Turn>> turnsByStep = new LinkedHashMap<>();
        for (RuntimeTraceVO.Session session : sessions(trace)) {
            for (RuntimeTraceVO.Turn turn : turns(session)) {
                if (turn.getStepId() != null && !turn.getStepId().isBlank()) {
                    turnsByStep.computeIfAbsent(turn.getStepId(), key -> new ArrayList<>()).add(turn);
                }
            }
        }
        for (Map.Entry<String, RuntimeTraceVO.TokenUsage> entry : byStep.entrySet()) {
            List<RuntimeTraceVO.Turn> turns = turnsByStep.get(entry.getKey());
            if (turns == null || turns.size() != 1) {
                continue;
            }
            RuntimeTraceVO.Turn turn = turns.get(0);
            if (reportedUsage(turn) != null) {
                continue;
            }
            RuntimeTraceVO.TokenUsage usage = entry.getValue();
            turn.setTokenUsage(usage);
            turn.setUsage(usage);
            if (turn.getObservations() != null && !turn.getObservations().isEmpty()) {
                turn.getObservations().get(0).setUsage(usage);
            }
        }
        for (RuntimeTraceVO.Session session : sessions(trace)) {
            RuntimeTraceVO.TokenUsage sessionUsage = newUsage();
            boolean any = false;
            for (RuntimeTraceVO.Turn turn : turns(session)) {
                RuntimeTraceVO.TokenUsage usage = reportedUsage(turn);
                if (usage == null) {
                    continue;
                }
                add(sessionUsage, usage);
                any = true;
            }
            if (any) {
                session.setTokenUsage(sessionUsage);
            }
        }
    }

    private static List<RuntimeTraceVO.Session> sessions(RuntimeTraceVO trace) {
        return trace.getSessions() == null ? List.of() : trace.getSessions();
    }

    private static List<RuntimeTraceVO.Turn> turns(RuntimeTraceVO.Session session) {
        return session == null || session.getTurns() == null ? List.of() : session.getTurns();
    }

    private static RuntimeTraceVO.TokenUsage reportedUsage(RuntimeTraceVO.Turn turn) {
        if (turn.getTokenUsage() != null && turn.getTokenUsage().isAvailable()) {
            return turn.getTokenUsage();
        }
        if (turn.getUsage() != null && turn.getUsage().isAvailable()) {
            return turn.getUsage();
        }
        return null;
    }

    private static RuntimeTraceVO.TokenUsage newUsage() {
        RuntimeTraceVO.TokenUsage usage = new RuntimeTraceVO.TokenUsage();
        usage.setAvailable(true);
        usage.setAvailability("AVAILABLE");
        usage.setSource(TOKEN_PROXY_SOURCE);
        usage.setCredits(0D);
        return usage;
    }

    private static void add(RuntimeTraceVO.TokenUsage target, DispatchAiUsageDO row) {
        target.setInputTokens(target.getInputTokens() + nonNegative(row.getInputTokens()));
        target.setOutputTokens(target.getOutputTokens() + nonNegative(row.getOutputTokens()));
        target.setReasoningTokens(target.getReasoningTokens() + nonNegative(row.getReasoningTokens()));
        target.setCacheReadTokens(target.getCacheReadTokens() + nonNegative(row.getCacheReadTokens()));
        target.setCacheWriteTokens(target.getCacheWriteTokens() + nonNegative(row.getCacheWriteTokens()));
        target.setTotalTokens(target.getInputTokens() + target.getOutputTokens());
        if (row.getCredits() != null) {
            target.setCredits(target.getCredits() + row.getCredits().doubleValue());
        }
    }

    private static void add(RuntimeTraceVO.TokenUsage target, RuntimeTraceVO.TokenUsage source) {
        target.setInputTokens(target.getInputTokens() + source.getInputTokens());
        target.setOutputTokens(target.getOutputTokens() + source.getOutputTokens());
        target.setReasoningTokens(target.getReasoningTokens() + source.getReasoningTokens());
        target.setCacheReadTokens(target.getCacheReadTokens() + source.getCacheReadTokens());
        target.setCacheWriteTokens(target.getCacheWriteTokens() + source.getCacheWriteTokens());
        target.setTotalTokens(target.getInputTokens() + target.getOutputTokens());
        if (source.getCredits() != null) {
            target.setCredits(target.getCredits() + source.getCredits());
        }
    }

    private static long nonNegative(Long value) {
        return value == null || value < 0 ? 0L : value;
    }
}

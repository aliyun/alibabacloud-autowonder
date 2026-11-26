package com.aliyun.autowonder.conversation;

import java.util.Comparator;
import java.util.List;
import java.util.Date;
import java.util.Objects;
import java.util.function.Function;
import java.util.function.Supplier;

/** Uses the returned history state with the same active-turn ordering as the database. */
final class ConversationTurnSnapshot {
    private ConversationTurnSnapshot() {}

    static <T> AgentConversationTurnDO activeInbound(AgentConversationTurnDO earlier, List<T> history,
            Function<T, Long> id, Function<T, String> direction, Function<T, String> status, Function<T, Date> created,
            Supplier<AgentConversationTurnDO> refresh) {
        if (earlier != null) {
            Long earlierId = earlier.getId();
            if (history.stream().anyMatch(t -> Objects.equals(earlierId, id.apply(t))
                    && !"PROCESSING".equals(status.apply(t)) && !"QUEUED".equals(status.apply(t)))) earlier = refresh.get();
        }
        // Keep an off-page active turn, but prefer the returned row when it is visible.
        if (earlier != null) {
            Long earlierId = earlier.getId();
            if (history.stream().anyMatch(t -> Objects.equals(earlierId, id.apply(t)))) earlier = null;
        }
        var visible = history.stream().filter(t -> "IN".equals(direction.apply(t))
                && ("PROCESSING".equals(status.apply(t)) || "QUEUED".equals(status.apply(t))))
                .min(Comparator.comparingInt((T t) -> "PROCESSING".equals(status.apply(t)) ? 0 : 1)
                        .thenComparing(created, Comparator.nullsFirst(Comparator.naturalOrder())).thenComparing(id)).orElse(null);
        if (visible == null) return earlier;
        var active = new AgentConversationTurnDO();
        active.setId(id.apply(visible)); active.setStatus(status.apply(visible)); active.setDirection("IN");
        active.setGmtCreate(created.apply(visible));
        return earlier == null ? active : activeInbound(List.of(earlier, active));
    }

    static AgentConversationTurnDO activeInbound(List<AgentConversationTurnDO> turns) {
        return turns.stream().filter(t -> "IN".equals(t.getDirection())
                && ("PROCESSING".equals(t.getStatus()) || "QUEUED".equals(t.getStatus())))
                .min(Comparator.comparingInt((AgentConversationTurnDO t) -> "PROCESSING".equals(t.getStatus()) ? 0 : 1)
                        .thenComparing(AgentConversationTurnDO::getGmtCreate, Comparator.nullsFirst(Comparator.naturalOrder()))
                        .thenComparing(AgentConversationTurnDO::getId)).orElse(null);
    }
}

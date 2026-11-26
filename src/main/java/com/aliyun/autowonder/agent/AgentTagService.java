package com.aliyun.autowonder.agent;

import com.aliyun.autowonder.agent.dto.AgentVO;
import com.aliyun.autowonder.agent.dto.UpdateAgentTagsRequest;
import com.aliyun.autowonder.audit.AuditLogRecord;
import com.aliyun.autowonder.audit.AuditLogService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Digital worker tags stored in asset_tag: two platform system tags plus free-form custom tags.
 * Tags are independent of the agent version flow, so a tag change never creates a draft.
 */
@Service
public class AgentTagService {

    static final int MAX_AGENT_TAGS = 50;
    static final int MAX_AGENT_TAG_LENGTH = 64;
    static final int MAX_TAG_OPTIONS = 200;
    private static final int IN_CHUNK_SIZE = 200;
    private static final String ASSET_TYPE_AGENT = "AGENT";
    static final String TAG_TYPE_SYSTEM = "SYSTEM";
    static final String TAG_TYPE_CUSTOM = "CUSTOM";
    private static final String AUDIT_ACTION = "agent.tag.update";

    private final AgentTagDao agentTagDao;
    private final AuditLogService auditLogService;

    public AgentTagService(AgentTagDao agentTagDao) {
        this(agentTagDao, null);
    }

    @Autowired
    public AgentTagService(AgentTagDao agentTagDao, AuditLogService auditLogService) {
        this.agentTagDao = agentTagDao;
        this.auditLogService = auditLogService;
    }

    public List<String> listTagOptions(long tenantId) {
        List<String> options = agentTagDao.listCustomTagOptions(tenantId, MAX_TAG_OPTIONS);
        return options == null ? new ArrayList<>() : options;
    }

    public void deleteForAgent(long tenantId, long agentId) {
        agentTagDao.deleteByAgent(tenantId, agentId);
    }

    /** Batch fill for list/detail responses; one IN query per 200 agents keeps the list N+1 free. */
    public void fillTags(List<AgentVO> vos, long tenantId) {
        if (vos == null || vos.isEmpty()) {
            return;
        }
        Map<Long, AgentVO> byId = new LinkedHashMap<>();
        for (AgentVO vo : vos) {
            if (vo != null && vo.getId() != null) {
                byId.put(vo.getId(), vo);
            }
        }
        List<Long> agentIds = new ArrayList<>(byId.keySet());
        Map<Long, Tags> tags = tagsByAgent(tenantId, agentIds);
        byId.forEach((id, vo) -> {
            Tags values = tags.get(id);
            vo.setSystemTags(values.systemTags());
            vo.setCustomTags(values.customTags());
        });
    }

    public record Tags(List<String> systemTags, List<String> customTags) {}

    public Map<Long, Tags> tagsByAgent(long tenantId, List<Long> agentIds) {
        Map<Long, List<AgentTagDO>> grouped = new HashMap<>();
        for (int start = 0; start < agentIds.size(); start += IN_CHUNK_SIZE) {
            List<Long> chunk = agentIds.subList(start, Math.min(start + IN_CHUNK_SIZE, agentIds.size()));
            List<AgentTagDO> rows = agentTagDao.listByAgentIds(tenantId, chunk);
            if (rows == null) {
                continue;
            }
            for (AgentTagDO row : rows) {
                if (row == null || row.getAssetId() == null) {
                    continue;
                }
                grouped.computeIfAbsent(row.getAssetId(), key -> new ArrayList<>()).add(row);
            }
        }
        Map<Long, Tags> result = new HashMap<>();
        for (Long id : agentIds) {
            result.put(id, toTags(grouped.get(id)));
        }
        return result;
    }

    /**
     * Full replacement of one agent's tags. An unchanged tag set writes nothing and records no
     * audit entry; the caller returns the freshly loaded AgentVO either way.
     */
    @Transactional
    public void replaceTags(AgentDO agent, UpdateAgentTagsRequest req, long tenantId, long userId) {
        if (isPlatform(agent)) {
            throw new BizException(ErrorCode.AGENT_PLATFORM_TAG_LOCKED);
        }
        NormalizedTags next = normalize(req);
        List<AgentTagDO> current = agentTagDao.listByAgent(tenantId, agent.getId());
        if (keysOf(current).equals(next.keys())) {
            return;
        }
        agentTagDao.deleteByAgent(tenantId, agent.getId());
        List<AgentTagDO> rows = next.rows(tenantId, agent.getId(), userId);
        if (!rows.isEmpty()) {
            agentTagDao.insertBatch(rows);
        }
        recordAudit(agent.getId(), tenantId, userId, current, next);
    }

    private NormalizedTags normalize(UpdateAgentTagsRequest req) {
        if (req == null) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
        LinkedHashSet<AgentSystemTag> systemTags = new LinkedHashSet<>();
        if (req.getSystemTags() != null) {
            for (String raw : req.getSystemTags()) {
                if (raw == null || raw.trim().isEmpty()) {
                    continue;
                }
                AgentSystemTag tag = AgentSystemTag.fromCode(raw);
                if (tag == null) {
                    throw BizException.keyed(ErrorCode.AGENT_TAG_INVALID_SYSTEM_CODE,
                            "error.agent_tag_invalid_system_code", new Object[]{raw.trim()},
                            "unsupported system tag " + raw.trim());
                }
                systemTags.add(tag);
            }
        }
        LinkedHashSet<String> customTags = new LinkedHashSet<>();
        if (req.getCustomTags() != null) {
            for (String raw : req.getCustomTags()) {
                if (raw == null) {
                    continue;
                }
                String name = raw.trim();
                if (name.isEmpty()) {
                    continue;
                }
                if (name.length() > MAX_AGENT_TAG_LENGTH) {
                    throw BizException.keyed(ErrorCode.AGENT_TAG_TOO_LONG,
                            "error.agent_tag_too_long", new Object[]{MAX_AGENT_TAG_LENGTH},
                            "custom tag longer than " + MAX_AGENT_TAG_LENGTH);
                }
                if (matchesSystemDisplayName(name)) {
                    throw BizException.keyed(ErrorCode.AGENT_TAG_SYSTEM_CONFLICT,
                            "error.agent_tag_system_conflict", new Object[0],
                            "custom tag duplicates a system tag name");
                }
                customTags.add(name);
            }
        }
        if (systemTags.size() + customTags.size() > MAX_AGENT_TAGS) {
            throw BizException.keyed(ErrorCode.AGENT_TAG_TOO_MANY,
                    "error.agent_tag_too_many", new Object[]{MAX_AGENT_TAGS},
                    "too many tags: " + (systemTags.size() + customTags.size()));
        }
        return new NormalizedTags(systemTags, customTags);
    }

    private boolean matchesSystemDisplayName(String name) {
        for (AgentSystemTag tag : AgentSystemTag.values()) {
            if (tag.matchesDisplayName(name)) {
                return true;
            }
        }
        return false;
    }

    private Tags toTags(List<AgentTagDO> rows) {
        List<String> systemCodes = new ArrayList<>();
        List<String> customNames = new ArrayList<>();
        if (rows != null) {
            for (AgentTagDO row : rows) {
                if (row == null) {
                    continue;
                }
                if (TAG_TYPE_SYSTEM.equals(row.getTagType())) {
                    String code = row.getTagCode() == null ? row.getTagName() : row.getTagCode();
                    if (code != null) {
                        systemCodes.add(code);
                    }
                } else if (TAG_TYPE_CUSTOM.equals(row.getTagType()) && row.getTagName() != null) {
                    customNames.add(row.getTagName());
                }
            }
        }
        systemCodes.sort(Comparator.comparingInt((String code) -> {
            AgentSystemTag tag = AgentSystemTag.fromCode(code);
            return tag == null ? Integer.MAX_VALUE : tag.ordinal();
        }));
        return new Tags(systemCodes, customNames);
    }

    private Set<String> keysOf(List<AgentTagDO> rows) {
        Set<String> keys = new LinkedHashSet<>();
        if (rows == null) {
            return keys;
        }
        for (AgentTagDO row : rows) {
            if (row == null) {
                continue;
            }
            if (TAG_TYPE_SYSTEM.equals(row.getTagType())) {
                String code = row.getTagCode() == null ? row.getTagName() : row.getTagCode();
                if (code != null) {
                    keys.add(key(TAG_TYPE_SYSTEM, code));
                }
            } else if (TAG_TYPE_CUSTOM.equals(row.getTagType()) && tagNameOf(row) != null) {
                keys.add(key(TAG_TYPE_CUSTOM, row.getTagName()));
            }
        }
        return keys;
    }

    private void recordAudit(long agentId, long tenantId, long userId,
                             List<AgentTagDO> current, NormalizedTags next) {
        if (auditLogService == null) {
            return;
        }
        Map<String, Map<String, Object>> before = refs(current);
        Map<String, Map<String, Object>> after = next.refs();
        List<Map<String, Object>> added = new ArrayList<>();
        List<Map<String, Object>> removed = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : after.entrySet()) {
            if (!before.containsKey(entry.getKey())) {
                added.add(entry.getValue());
            }
        }
        for (Map.Entry<String, Map<String, Object>> entry : before.entrySet()) {
            if (!after.containsKey(entry.getKey())) {
                removed.add(entry.getValue());
            }
        }
        AuditLogRecord record = new AuditLogRecord();
        record.setTenantId(tenantId);
        record.setActorId(userId);
        record.setActorType("HUMAN");
        record.setModule("agent");
        record.setAction(AUDIT_ACTION);
        record.setTargetType("AGENT");
        record.setTargetId(agentId);
        record.setTriggerType("API");
        record.setEventType(AUDIT_ACTION);
        record.detail("added", added)
                .detail("removed", removed)
                .detail("systemTags", next.systemCodes())
                .detail("customTags", next.customNames());
        // AuditLogService.record logs and swallows storage failures: tagging must not depend on it.
        auditLogService.record(record);
    }

    private Map<String, Map<String, Object>> refs(List<AgentTagDO> rows) {
        Map<String, Map<String, Object>> refs = new LinkedHashMap<>();
        if (rows == null) {
            return refs;
        }
        for (AgentTagDO row : rows) {
            if (row == null) {
                continue;
            }
            if (TAG_TYPE_SYSTEM.equals(row.getTagType())) {
                String code = row.getTagCode() == null ? row.getTagName() : row.getTagCode();
                if (code != null) {
                    refs.put(key(TAG_TYPE_SYSTEM, code), ref(TAG_TYPE_SYSTEM, code));
                }
            } else if (tagNameOf(row) != null) {
                refs.put(key(TAG_TYPE_CUSTOM, row.getTagName()), ref(TAG_TYPE_CUSTOM, row.getTagName()));
            }
        }
        return refs;
    }

    private String tagNameOf(AgentTagDO row) {
        return row.getTagName() == null || row.getTagName().trim().isEmpty() ? null : row.getTagName();
    }

    private Map<String, Object> ref(String type, String name) {
        Map<String, Object> ref = new LinkedHashMap<>();
        ref.put("type", type);
        ref.put("name", name);
        return ref;
    }

    static String key(String type, String value) {
        return type + ":" + value;
    }

    private boolean isPlatform(AgentDO agent) {
        return "PLATFORM".equals(agent.getKind());
    }

    private static final class NormalizedTags {
        private final LinkedHashSet<AgentSystemTag> systemTags;
        private final LinkedHashSet<String> customTags;

        private NormalizedTags(LinkedHashSet<AgentSystemTag> systemTags, LinkedHashSet<String> customTags) {
            this.systemTags = systemTags;
            this.customTags = customTags;
        }

        Set<String> keys() {
            Set<String> keys = new LinkedHashSet<>();
            for (AgentSystemTag tag : systemTags) {
                keys.add(key(TAG_TYPE_SYSTEM, tag.getCode()));
            }
            for (String name : customTags) {
                keys.add(key(TAG_TYPE_CUSTOM, name));
            }
            return keys;
        }

        Map<String, Map<String, Object>> refs() {
            Map<String, Map<String, Object>> refs = new LinkedHashMap<>();
            for (String code : systemCodes()) {
                refs.put(key(TAG_TYPE_SYSTEM, code), refOf(TAG_TYPE_SYSTEM, code));
            }
            for (String name : customTags) {
                refs.put(key(TAG_TYPE_CUSTOM, name), refOf(TAG_TYPE_CUSTOM, name));
            }
            return refs;
        }

        private Map<String, Object> refOf(String type, String name) {
            Map<String, Object> ref = new LinkedHashMap<>();
            ref.put("type", type);
            ref.put("name", name);
            return ref;
        }

        List<String> systemCodes() {
            List<String> codes = new ArrayList<>();
            for (AgentSystemTag tag : AgentSystemTag.values()) {
                if (systemTags.contains(tag)) {
                    codes.add(tag.getCode());
                }
            }
            return codes;
        }

        List<String> customNames() {
            return new ArrayList<>(customTags);
        }

        List<AgentTagDO> rows(long tenantId, long agentId, long userId) {
            List<AgentTagDO> rows = new ArrayList<>();
            for (String code : systemCodes()) {
                rows.add(row(tenantId, agentId, userId, TAG_TYPE_SYSTEM, code, code));
            }
            for (String name : customTags) {
                rows.add(row(tenantId, agentId, userId, TAG_TYPE_CUSTOM, null, name));
            }
            return rows;
        }

        private AgentTagDO row(long tenantId, long agentId, long userId,
                               String type, String code, String name) {
            AgentTagDO row = new AgentTagDO();
            row.setTenantId(tenantId);
            row.setAssetType(ASSET_TYPE_AGENT);
            row.setAssetId(agentId);
            row.setTagType(type);
            row.setTagCode(code);
            row.setTagName(name);
            row.setCreatorId(userId);
            return row;
        }
    }
}

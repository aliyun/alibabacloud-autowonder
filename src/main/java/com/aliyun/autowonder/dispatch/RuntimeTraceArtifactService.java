package com.aliyun.autowonder.dispatch;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.artifact.ArtifactDO;
import com.aliyun.autowonder.artifact.ArtifactDao;
import com.aliyun.autowonder.common.error.KeyedIllegalArgumentException;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.dispatch.dto.RuntimeTraceVO;
import com.aliyun.autowonder.storage.ObjectStorage;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.List;

@Service
public class RuntimeTraceArtifactService {

    private static final String TRACE_NAME = "observability/trace.json";
    private static final String CONTEXT_PREFIX = "context/files/";

    private final ArtifactDao artifactDao;
    private final ObjectStorage storage;
    private final DispatchDao dispatchDao;
    private final DispatchRuntimeEventDao runtimeEventDao;
    private final RuntimeTraceUsageFallback usageFallback;

    public RuntimeTraceArtifactService(ArtifactDao artifactDao, ObjectStorage storage, DispatchDao dispatchDao,
                                       DispatchRuntimeEventDao runtimeEventDao,
                                       RuntimeTraceUsageFallback usageFallback) {
        this.artifactDao = artifactDao;
        this.storage = storage;
        this.dispatchDao = dispatchDao;
        this.runtimeEventDao = runtimeEventDao;
        this.usageFallback = usageFallback;
    }

    public RuntimeTraceVO loadOutline(long tenantId, long dispatchId) {
        return outline(loadTrace(tenantId, dispatchId));
    }

    private RuntimeTraceVO outline(RuntimeTraceVO trace) {
        trace.setSource("OSS");
        for (RuntimeTraceVO.Session session : trace.getSessions()) {
            for (RuntimeTraceVO.Turn turn : session.getTurns()) {
                turn.setPrompt(null);
                turn.setSystemPrompt(null);
                turn.setOutput(null);
                stripObservationPayloads(turn.getObservations());
            }
        }
        return trace;
    }

    public RuntimeTraceVO loadOutlineIfPresent(long tenantId, long dispatchId) {
        DispatchDO dispatch = dispatchDao.findById(dispatchId);
        if (dispatch == null || !Long.valueOf(tenantId).equals(dispatch.getTenantId())) {
            throw new BizException(ErrorCode.DISPATCH_NOT_FOUND);
        }
        // A failed executor can upload its archive before this dispatch resumes elsewhere.
        if (!DispatchStatus.isTerminal(dispatch.getStatus()) && !DispatchStatus.PAUSED.equals(dispatch.getStatus())) {
            return null;
        }
        var failover = runtimeEventDao.findLatestByDispatchAndType(tenantId, dispatchId, "dispatch.executor_failover");
        String expected = failover == null ? null : dispatch.getExecutorId() + ":" + failover.getEventId();
        ArtifactDO artifact = findArtifactOrNull(tenantId, dispatchId, TRACE_NAME, expected);
        return artifact == null ? null : outline(loadTrace(tenantId, dispatchId, artifact));
    }

    public RuntimeTraceVO.Turn loadTurn(long tenantId, long dispatchId, String traceId) {
        for (RuntimeTraceVO.Session session : loadTrace(tenantId, dispatchId).getSessions()) {
            for (RuntimeTraceVO.Turn turn : session.getTurns()) {
                if (traceId.equals(turn.getTraceId()) || traceId.equals(turn.getTurnId())) {
                    return turn;
                }
            }
        }
        throw new BizException(ErrorCode.ARTIFACT_NOT_FOUND);
    }

    public RuntimeTraceVO.Observation loadObservation(long tenantId, long dispatchId, String observationId) {
        for (RuntimeTraceVO.Session session : loadTrace(tenantId, dispatchId).getSessions()) {
            for (RuntimeTraceVO.Turn turn : session.getTurns()) {
                RuntimeTraceVO.Observation found = findObservation(turn.getObservations(), observationId);
                if (found != null) {
                    return found;
                }
            }
        }
        throw new BizException(ErrorCode.ARTIFACT_NOT_FOUND);
    }

    public ContextContent loadContext(long tenantId, long dispatchId, String contentRef) {
        validateContentRef(contentRef);
        ArtifactDO artifact = findArtifact(tenantId, dispatchId, "observability/" + contentRef);
        byte[] bytes = storage.get(artifact.getOssRef());
        if (bytes == null) {
            throw new BizException(ErrorCode.ARTIFACT_NOT_FOUND);
        }
        return new ContextContent(contentRef, bytes);
    }

    private RuntimeTraceVO loadTrace(long tenantId, long dispatchId) {
        return loadTrace(tenantId, dispatchId, findArtifact(tenantId, dispatchId, TRACE_NAME));
    }

    private RuntimeTraceVO loadTrace(long tenantId, long dispatchId, ArtifactDO artifact) {
        byte[] bytes = storage.get(artifact.getOssRef());
        if (bytes == null) {
            throw new BizException(ErrorCode.ARTIFACT_NOT_FOUND);
        }
        RuntimeTraceVO trace = JSON.parseObject(new String(bytes, StandardCharsets.UTF_8), RuntimeTraceVO.class);
        if (trace == null) {
            throw new BizException(ErrorCode.ARTIFACT_NOT_FOUND);
        }
        try {
            trace.setDispatchId(Long.valueOf(String.valueOf(trace.getDispatchId())));
        } catch (RuntimeException ignored) {
            trace.setDispatchId(dispatchId);
        }
        usageFallback.apply(tenantId, dispatchId, trace);
        return trace;
    }

    private ArtifactDO findArtifact(long tenantId, long dispatchId, String logicalName) {
        ArtifactDO artifact = findArtifactOrNull(tenantId, dispatchId, logicalName);
        if (artifact != null) {
            return artifact;
        }
        throw new BizException(ErrorCode.ARTIFACT_NOT_FOUND);
    }

    private ArtifactDO findArtifactOrNull(long tenantId, long dispatchId, String logicalName) {
        return findArtifactOrNull(tenantId, dispatchId, logicalName, null);
    }

    private ArtifactDO findArtifactOrNull(long tenantId, long dispatchId, String logicalName, String archiveIdentity) {
        List<ArtifactDO> artifacts = artifactDao.listByDispatch(tenantId, dispatchId);
        for (ArtifactDO artifact : artifacts) {
            String name = artifact.getName();
            if (logicalName.equals(name) || (name != null && name.endsWith("/" + logicalName))) {
                if (archiveIdentity != null) {
                    try {
                        var metadata = JSON.parseObject(artifact.getMetaJson());
                        if (metadata == null || !archiveIdentity.equals(metadata.getString("runtimeArchiveIdentity"))) continue;
                    } catch (RuntimeException invalidMetadata) {
                        continue;
                    }
                }
                return artifact;
            }
        }
        return null;
    }

    private void stripObservationPayloads(List<RuntimeTraceVO.Observation> observations) {
        if (observations == null) {
            return;
        }
        for (RuntimeTraceVO.Observation observation : observations) {
            observation.setInput(null);
            observation.setOutput(null);
            observation.setError(null);
            stripObservationPayloads(observation.getChildren());
        }
    }

    private RuntimeTraceVO.Observation findObservation(List<RuntimeTraceVO.Observation> observations, String id) {
        if (observations == null) {
            return null;
        }
        for (RuntimeTraceVO.Observation observation : observations) {
            if (id.equals(observation.getObservationId())) {
                return observation;
            }
            RuntimeTraceVO.Observation child = findObservation(observation.getChildren(), id);
            if (child != null) {
                return child;
            }
        }
        return null;
    }

    private void validateContentRef(String contentRef) {
        if (contentRef == null || !contentRef.startsWith(CONTEXT_PREFIX)
                || contentRef.startsWith("/") || contentRef.contains("\\") || contentRef.contains("..")) {
            throw new KeyedIllegalArgumentException("dispatch.context_ref.invalid", new Object[0], "invalid context content ref");
        }
    }

    public record ContextContent(String contentRef, byte[] bytes) {
    }
}

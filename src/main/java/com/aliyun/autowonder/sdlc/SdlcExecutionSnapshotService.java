package com.aliyun.autowonder.sdlc;

import com.aliyun.autowonder.dispatch.DispatchDO;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONObject;
import com.aliyun.autowonder.storage.ObjectStorage;
import com.aliyun.autowonder.taskpackage.PackageContext;
import com.aliyun.autowonder.taskpackage.TaskPackageResult;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.apache.commons.compress.utils.SeekableInMemoryByteChannel;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

@Service
public class SdlcExecutionSnapshotService {
    private static final Set<String> REQUIRED_ENTRIES = Set.of("manifest.json", "sdlc.json");
    private static final int MAX_ENTRY_BYTES = 2 * 1024 * 1024;
    private static final int MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
    private final SdlcExecutionSnapshotDao dao;
    private final ObjectStorage storage;

    public SdlcExecutionSnapshotService(SdlcExecutionSnapshotDao dao, ObjectStorage storage) {
        this.dao = dao; this.storage = storage;
    }

    public void capture(PackageContext context, TaskPackageResult archive, int admittedVersion) {
        if (context == null || context.getSdlc() == null) return;
        Long sdlcId = new JSONObject(context.getSdlc()).getLong("sdlcId");
        if (sdlcId == null) return;
        // The workitem's flow may have changed; the packaged configuration is authoritative.
        var snapshot = SdlcExecutionSnapshot.from(context.getTenantId(), sdlcId, context.getSdlc());
        if (snapshot == null) return;
        long id = save(snapshot);
        dao.capture(context.getTenantId(), context.getDispatchId(), id, archive.getSha256(), admittedVersion, archive.getOssRef());
    }

    private long save(SdlcExecutionSnapshot snapshot) {
        dao.insert(snapshot);
        return dao.find(snapshot.getWorkspaceId(), snapshot.getSdlcId(), snapshot.getContentHash()).getId();
    }

    public boolean recover(DispatchDO dispatch, Date firstEventAt) {
        String ref = dispatch.getPackageOssRef();
        String expected = "/" + dispatch.getTenantId() + "/" + dispatch.getWorkitemId() + "/" + dispatch.getId() + ".zip";
        if (ref == null || !ref.endsWith(expected) || firstEventAt == null) return unavailable(dispatch, "UNVERIFIED");
        String workflowHash = dao.frozenWorkflowHash(dispatch, firstEventAt);
        if (workflowHash == null) return unavailable(dispatch, "UNVERIFIED");
        byte[] archive;
        try {
            archive = storage.get(ref, MAX_ARCHIVE_BYTES);
        } catch (ObjectStorage.SizeLimitExceededException tooLarge) {
            return unavailable(dispatch, "UNAVAILABLE");
        }
        if (archive == null) return unavailable(dispatch, "UNAVAILABLE");
        Optional<SdlcExecutionSnapshot> parsed = readArchive(dispatch, firstEventAt, archive, workflowHash);
        if (parsed.isEmpty()) return unavailable(dispatch, "UNVERIFIED");
        long id = save(parsed.get());
        // A live packaging capture always wins over a concurrent historical recovery.
        dao.recover(dispatch, id, SdlcExecutionSnapshot.sha256(archive), "RECOVERED_FROZEN");
        return dao.hasVerifiedBinding(dispatch.getTenantId(), dispatch.getId());
    }

    private boolean unavailable(DispatchDO dispatch, String source) {
        dao.recover(dispatch, null, null, source);
        return dao.hasVerifiedBinding(dispatch.getTenantId(), dispatch.getId());
    }

    static Optional<SdlcExecutionSnapshot> readArchive(DispatchDO dispatch, Date firstEventAt, byte[] archive, String workflowHash) {
        if (archive.length > MAX_ARCHIVE_BYTES) return Optional.empty();
        Map<String, byte[]> entries = new HashMap<>();
        try (var zip = new ZipFile(new SeekableInMemoryByteChannel(archive))) {
            int count = 0;
            var archiveEntries = zip.getEntries();
            while (archiveEntries.hasMoreElements()) {
                var entry = archiveEntries.nextElement();
                if (++count > 10_000) return Optional.empty();
                // Unrelated capability payloads need neither extraction nor decompression.
                if (!REQUIRED_ENTRIES.contains(entry.getName())) continue;
                try (var input = zip.getInputStream(entry)) {
                    byte[] bytes = input.readNBytes(MAX_ENTRY_BYTES + 1);
                    if (bytes.length > MAX_ENTRY_BYTES || entries.put(entry.getName(), bytes) != null) return Optional.empty();
                }
            }
            if (!entries.keySet().containsAll(REQUIRED_ENTRIES)) return Optional.empty();
            JSONObject manifest = JSON.parseObject(new String(entries.get("manifest.json"), StandardCharsets.UTF_8));
            JSONObject sdlc = JSON.parseObject(new String(entries.get("sdlc.json"), StandardCharsets.UTF_8));
            if (manifest == null || sdlc == null
                    || !Objects.equals(manifest.getLong("tenantId"), dispatch.getTenantId())
                    || !Objects.equals(manifest.getLong("dispatchId"), dispatch.getId())
                    || !Objects.equals(manifest.getLong("workitemId"), dispatch.getWorkitemId())
                    || !Objects.equals(nullableManifestId(manifest, "sdlcStepId"), dispatch.getSdlcStepId())
                    || !Objects.equals(manifest.getLong("agentId"), dispatch.getAgentId())
                    || !Objects.equals(nullableManifestId(manifest, "agentVersionId"), dispatch.getAgentVersionId())) return Optional.empty();
            if (dispatch.getSdlcStepId() != null && !dispatch.getSdlcStepId().toString().equals(sdlc.getString("currentStepId")))
                return Optional.empty();
            Instant created = Instant.parse(manifest.getString("createdAt"));
            // A rebuilt package after the first runtime event cannot identify that historical execution.
            if (dispatch.getGmtCreate() == null || created.isBefore(dispatch.getGmtCreate().toInstant().minusSeconds(1))
                    || created.isAfter(firstEventAt.toInstant().plusSeconds(1))) return Optional.empty();
            JSONObject digests = manifest.getJSONObject("fileDigests");
            if (workflowHash == null || !workflowHash.equals(manifest.getString("workflowSnapshotSha256"))
                    || !workflowHash.equals(SdlcExecutionSnapshot.sha256(entries.get("sdlc.json")))
                    || digests == null || !("sha256:" + workflowHash).equals(digests.getString("sdlc.json")))
                return Optional.empty();
            // Legacy manifest.sdlcId came from the mutable workitem binding, not the executing step.
            Long flow = sdlc.getLong("sdlcId");
            if (flow == null) return Optional.empty();
            return Optional.ofNullable(SdlcExecutionSnapshot.from(dispatch.getTenantId(), flow, sdlc));
        } catch (IOException | RuntimeException invalid) {
            return Optional.empty();
        }
    }

    private static Long nullableManifestId(JSONObject manifest, String key) {
        // TaskPackager serializes absent historical IDs as empty strings.
        return "".equals(manifest.get(key)) ? null : manifest.getLong(key);
    }
}

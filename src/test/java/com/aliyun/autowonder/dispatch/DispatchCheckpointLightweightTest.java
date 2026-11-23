package com.aliyun.autowonder.dispatch;

import com.aliyun.autowonder.storage.ObjectStorage;
import com.aliyun.autowonder.storage.OssProperties;
import com.aliyun.autowonder.storage.StoredObject;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.GZIPOutputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DispatchCheckpointLightweightTest {

    private final DispatchCheckpointDao dao = mock(DispatchCheckpointDao.class);
    private final DispatchDao dispatchDao = mock(DispatchDao.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);
    private final DispatchCheckpointService service;

    DispatchCheckpointLightweightTest() {
        OssProperties properties = new OssProperties();
        properties.setArtifactBucket("bucket");
        service = new DispatchCheckpointService(dao, mock(DispatchRuntimeEventDao.class),
                dispatchDao, storage, properties);
    }

    static byte[] archive(String schemaVersion) throws Exception {
        ByteArrayOutputStream raw = new ByteArrayOutputStream();
        try (TarArchiveOutputStream tar = new TarArchiveOutputStream(new GZIPOutputStream(raw))) {
            put(tar, "state/sdlc-progress.json", "{}");
            put(tar, "checkpoint.json", "{\"schemaVersion\":\"" + schemaVersion + "\",\"checkpointSeq\":7}");
        }
        return raw.toByteArray();
    }

    private static void put(TarArchiveOutputStream tar, String name, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        TarArchiveEntry entry = new TarArchiveEntry(name);
        entry.setSize(bytes.length);
        tar.putArchiveEntry(entry);
        tar.write(bytes);
        tar.closeArchiveEntry();
    }

    private String storedKey(byte[] archive) {
        when(storage.put(eq("bucket"), anyString(), any(byte[].class)))
                .thenAnswer(call -> new StoredObject("bucket/" + call.getArgument(1), "md5", 1L));
        DispatchDO dispatch = new DispatchDO();
        dispatch.setTenantId(100L); dispatch.setId(55L); dispatch.setWorkitemId(200L); dispatch.setAgentId(9L);
        return service.store(dispatch, 7L, null, null, null, null, archive).getOssRef();
    }

    @Test
    void uploadMarksOnlyLightweightArchives() throws Exception {
        String light = storedKey(archive("autowonder.runtimeCheckpoint.lightweight.v1"));
        assertTrue(light.endsWith(".lightweight-v1.tar.gz"), light);
        for (String legacy : List.of("autowonder.runtimeCheckpoint.v2", "autowonder.runtimeCheckpoint.v1",
                "autowonder.runtimeCheckpoint.experimentalLightweight.v1")) {
            String key = storedKey(archive(legacy));
            assertTrue(key.endsWith(".tar.gz") && !key.endsWith(".lightweight-v1.tar.gz"), key);
        }
        String opaque = storedKey(new byte[]{1, 2, 3});
        assertFalse(opaque.endsWith(".lightweight-v1.tar.gz"), opaque);
    }

    private DispatchDO resume(String mode) {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(77L);
        dispatch.setTenantId(100L); dispatch.setResumeMode(mode); dispatch.setResumeFromDispatchId(55L);
        return dispatch;
    }

    private DispatchCheckpointDO row(long seq, String ref) {
        DispatchCheckpointDO row = new DispatchCheckpointDO();
        row.setDispatchId(55L); row.setCheckpointSeq(seq); row.setOssRef(ref); row.setSha256("sha-" + seq);
        when(storage.exists(ref)).thenReturn(true);
        return row;
    }

    @Test
    void readerIsRequiredWhenAnyRestorableCandidateIsLightweight() {
        DispatchCheckpointServiceTest.configureRecoveryRound(service, 100L, 55L, 55L, 77L);
        List<DispatchCheckpointDO> rows = List.of(
                row(2L, "bucket/checkpoint-2-x.lightweight-v1.tar.gz"), row(1L, "bucket/checkpoint-1-y.tar.gz"));
        when(dao.listLatestByDispatch(100L, 55L, 2)).thenReturn(rows);

        for (String mode : List.of("RECOVERY", "COMMENT_REWORK", "COMMENT_INTERACTION", "SIDE_INTERACTION",
                "CANONICAL_INTERACTION", "CONTINUOUS", "DEGRADED_CONTINUOUS")) {
            assertTrue(service.requiresLightweightReader(resume(mode)), mode);
        }
        assertFalse(service.requiresLightweightReader(resume("RETURNING_WORKER")));
        DispatchDO fresh = resume("RECOVERY");
        fresh.setResumeFromDispatchId(null);
        assertFalse(service.requiresLightweightReader(fresh));
        assertFalse(service.requiresLightweightReader(null));
    }

    @Test
    void legacyOrMissingLightweightObjectsKeepOriginalSelection() {
        DispatchCheckpointServiceTest.configureRecoveryRound(service, 100L, 55L, 55L, 77L);
        DispatchCheckpointDO latest = row(2L, "bucket/checkpoint-2-x.tar.gz");
        DispatchCheckpointDO previous = row(1L, "bucket/checkpoint-1-y.tar.gz");
        when(dao.listLatestByDispatch(100L, 55L, 2)).thenReturn(List.of(latest, previous));
        assertFalse(service.requiresLightweightReader(resume("RECOVERY")));

        DispatchCheckpointDO gone = row(3L, "bucket/checkpoint-3-z.lightweight-v1.tar.gz");
        when(storage.exists(gone.getOssRef())).thenReturn(false);
        when(dao.listLatestByDispatch(100L, 55L, 2)).thenReturn(List.of(gone, latest));
        assertFalse(service.requiresLightweightReader(resume("RECOVERY")));
    }
}

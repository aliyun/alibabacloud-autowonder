package com.aliyun.autowonder.sdlc;

import com.aliyun.autowonder.dispatch.DispatchDO;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONObject;
import com.aliyun.autowonder.storage.ObjectStorage;
import com.aliyun.autowonder.storage.InMemoryObjectStorage;
import com.aliyun.autowonder.taskpackage.PackageContext;
import com.aliyun.autowonder.taskpackage.TaskPackageResult;
import com.aliyun.autowonder.taskpackage.TaskPackager;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SdlcExecutionSnapshotServiceTest {
    private final SdlcExecutionSnapshotDao dao = mock(SdlcExecutionSnapshotDao.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);
    private final SdlcExecutionSnapshotService service = new SdlcExecutionSnapshotService(dao, storage);
    private final Date firstEvent = Date.from(Instant.parse("2026-10-22T12:01:00Z"));

    @Test
    void canonicalHashIgnoresEntryCursorAndMapOrderButPreservesContentAndStepOrder() {
        var original = configuration();
        var reordered = JSON.parseObject(JSON.toJSONString(original));
        reordered.put("currentStepId", "11");
        reordered.put("sdlcId", "999");
        assertEquals(snapshot(original).getContentHash(), snapshot(reordered).getContentHash());
        var changes = JSON.parseObject(JSON.toJSONString(original));
        changes.getJSONArray("steps").getJSONObject(0).put("instruction", "Updated 原文");
        assertNotEquals(snapshot(original).getContentHash(), snapshot(changes).getContentHash());
        Collections.reverse(changes.getJSONArray("steps"));
        assertNotEquals(snapshot(original).getContentHash(), snapshot(changes).getContentHash());
        assertEquals("User 指令", JSON.parseObject(snapshot(original).getConfigurationJson())
                .getJSONArray("steps").getJSONObject(0).getString("instruction"));
    }

    @Test
    void captureBindsTheDeduplicatedConfigurationToTheExactPackagedDispatch() {
        var saved = snapshot(configuration()); saved.setId(40L);
        when(dao.find(eq(9L), eq(5L), anyString())).thenReturn(saved);
        var context = new PackageContext();
        context.setTenantId(9L); context.setDispatchId(1L); context.setSdlcId(999L); context.setSdlc(configuration());
        service.capture(context, new TaskPackageResult("bucket/9/100/1.zip", "md5", 100, "url", "archive-hash"), 3);
        verify(dao).capture(9, 1, 40, "archive-hash", 3, "bucket/9/100/1.zip");
        verifyNoInteractions(storage);
    }

    @Test
    void rejectsMalformedOrAmbiguousStageDefinitionsBeforePersisting() throws Exception {
        for (Object steps : List.of(List.of(), List.of("invalid"), List.of(Map.of("name", "missing id")),
                List.of(Map.of("id", "10"), Map.of("id", "10")), List.of(Map.of("id", 10)),
                List.of(Map.of("id", "10", "required", "false")), List.of(Map.of("id", "10", "name", Map.of())))) {
            var invalid = configuration(); invalid.put("steps", steps);
            assertNull(snapshot(invalid));
            assertTrue(readArchive(dispatch(), firstEvent, archive(manifest(), invalid)).isEmpty());
        }
        when(storage.get(anyString(), anyInt())).thenThrow(new IllegalStateException("temporary storage failure"));
        assertThrows(IllegalStateException.class, () -> service.recover(dispatch(), firstEvent));
        verify(dao, never()).insert(any());
        verify(dao, never()).recover(any(), any(), any(), any());
    }

    @Test
    void recoversVerifiedHistoricalPackageWithoutReplacingLiveCapture() throws Exception {
        var saved = snapshot(configuration()); saved.setId(40L);
        when(dao.find(eq(9L), eq(5L), anyString())).thenReturn(saved);
        byte[] bytes = archive(manifest(), configuration());
        when(storage.get("bucket/9/100/1.zip", 64 * 1024 * 1024)).thenReturn(bytes);
        when(dao.hasVerifiedBinding(9, 1)).thenReturn(true);
        assertTrue(service.recover(dispatch(), firstEvent));
        verify(dao).recover(argThat(row -> row.getVersion() == 3 && "SUCCEEDED".equals(row.getStatus())
                && "bucket/9/100/1.zip".equals(row.getPackageOssRef())), eq(40L), eq(SdlcExecutionSnapshot.sha256(bytes)), eq("RECOVERED_FROZEN"));
        verify(dao, never()).capture(anyLong(), anyLong(), anyLong(), anyString(), anyInt(), anyString());
        var parsed = readArchive(dispatch(), firstEvent, bytes).orElseThrow();
        assertEquals(5, parsed.getSdlcId());
        assertEquals(snapshot(configuration()).getContentHash(), parsed.getContentHash());
    }

    @Test
    void recoveryNeedsTheConfigurationFrozenForTheOriginalDispatch() throws Exception {
        var changed = configuration(); changed.put("workflow", "later configuration");
        var rebuilt = manifest();
        rebuilt.put("workflowSnapshotSha256", SdlcExecutionSnapshot.sha256(JSON.toJSONString(changed).getBytes(StandardCharsets.UTF_8)));
        when(storage.get(anyString(), anyInt())).thenReturn(archive(rebuilt, changed));
        assertFalse(service.recover(dispatch(), firstEvent));
        verify(dao, never()).insert(any());

        when(dao.frozenWorkflowHash(any(), eq(firstEvent))).thenReturn(null);
        assertFalse(service.recover(dispatch(), firstEvent));
        verify(storage, times(1)).get(anyString(), anyInt());
    }

    @Test
    void readsTheRealTaskPackagerArchiveAndDigestFormat() {
        var objects = new InMemoryObjectStorage();
        var packager = new TaskPackager(objects, "bucket", "https://e2e.example.com");
        var context = new PackageContext();
        context.setTenantId(9L); context.setDispatchId(1L); context.setWorkitemId(100L);
        context.setAgentId(7L); context.setAgentVersionId(70L);
        context.setSdlcId(999L); // The workitem was rebound after this dispatch selected its step.
        context.setSdlcStepId(10L); context.setSdlc(configuration());
        context.setDeliveryRoundId(1L); context.setWorkflowSnapshotSha256(workflowHash());
        var execution = dispatch(); execution.setGmtCreate(new Date());
        for (boolean legacyNullIds : List.of(false, true)) {
            if (legacyNullIds) {
                context.setAgentVersionId(null); context.setSdlcStepId(null);
                execution.setAgentVersionId(null); execution.setSdlcStepId(null);
            }
            var packaged = packager.build(context);
            var parsed = readArchive(execution, new Date(), objects.get(packaged.getOssRef())).orElseThrow();
            assertEquals(snapshot(configuration()).getContentHash(), parsed.getContentHash());
            if (legacyNullIds) {
                execution.setAgentVersionId(70L);
                assertTrue(readArchive(execution, new Date(), objects.get(packaged.getOssRef())).isEmpty());
                execution.setAgentVersionId(null); execution.setSdlcStepId(10L);
                assertTrue(readArchive(execution, new Date(), objects.get(packaged.getOssRef())).isEmpty());
            }
        }
    }

    @Test
    void recoversLegacyMissingManifestFlowOnlyFromDigestVerifiedSdlcContent() throws Exception {
        var missing = manifest(); missing.remove("sdlcId");
        assertEquals(5, readArchive(dispatch(), firstEvent, archive(missing, configuration())).orElseThrow().getSdlcId());
        for (String empty : Arrays.asList(null, "", " ")) {
            var legacy = manifest(); legacy.put("sdlcId", empty);
            assertTrue(readArchive(dispatch(), firstEvent, archive(legacy, configuration())).isPresent());
        }
        missing.put("fileDigests", Map.of("sdlc.json", "sha256:" + "0".repeat(64)));
        assertTrue(readArchive(dispatch(), firstEvent, archive(missing, configuration())).isEmpty());
    }

    @Test
    void rejectsCrossTenantForeignVersionTamperedDigestAndRebuiltPackages() throws Exception {
        for (String field : List.of("tenantId", "dispatchId", "workitemId", "sdlcStepId", "agentId", "agentVersionId")) {
            JSONObject wrong = manifest(); wrong.put(field, "999");
            assertTrue(readArchive(dispatch(), firstEvent, archive(wrong, configuration())).isEmpty(), field);
        }
        var rebuilt = manifest(); rebuilt.put("createdAt", "2026-10-22T12:10:00Z");
        assertTrue(readArchive(dispatch(), firstEvent, archive(rebuilt, configuration())).isEmpty());
        var wrongDigest = manifest(); wrongDigest.put("fileDigests", Map.of("sdlc.json", "sha256:" + "0".repeat(64)));
        assertTrue(readArchive(dispatch(), firstEvent, archive(wrongDigest, configuration())).isEmpty());
        var wrongEntry = configuration(); wrongEntry.put("currentStepId", "11");
        assertTrue(readArchive(dispatch(), firstEvent, archive(manifest(), wrongEntry)).isEmpty());
        var tooLarge = configuration(); tooLarge.put("padding", "x".repeat(2 * 1024 * 1024));
        assertTrue(readArchive(dispatch(), firstEvent, archive(manifest(), tooLarge)).isEmpty());
    }

    @Test
    void permanentSizeLimitIsUnavailableWhileTransientReadFailuresRemainRetryable() {
        when(storage.get(anyString(), anyInt())).thenThrow(new ObjectStorage.SizeLimitExceededException());
        assertFalse(service.recover(dispatch(), firstEvent));
        verify(dao).recover(any(DispatchDO.class), isNull(), isNull(), eq("UNAVAILABLE"));
        verify(dao, never()).insert(any());
    }

    @Test
    void ignoresLargeUnrelatedExpandedPayloadsWhileBoundingSnapshotEntries() throws Exception {
        byte[] config = JSON.toJSONString(configuration()).getBytes(StandardCharsets.UTF_8);
        var manifest = manifest();
        manifest.put("fileDigests", Map.of("sdlc.json", "sha256:" + SdlcExecutionSnapshot.sha256(config)));
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            byte[] block = new byte[1024 * 1024];
            for (int packageIndex = 0; packageIndex < 2; packageIndex++) {
                zip.putNextEntry(new ZipEntry("capabilities/large-" + packageIndex));
                for (int i = 0; i < 40; i++) zip.write(block);
                zip.closeEntry();
            }
            zip.putNextEntry(new ZipEntry("sdlc.json")); zip.write(config); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("manifest.json"));
            zip.write(JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
        }
        assertTrue(readArchive(dispatch(), firstEvent, bytes.toByteArray()).isPresent());
    }

    @Test
    void unavailableOrUnverifiedHistoryRemainsUnknownAndNeverUsesCurrentDefinitions() {
        assertFalse(service.recover(dispatch(), firstEvent));
        verify(dao).recover(any(DispatchDO.class), isNull(), isNull(), eq("UNAVAILABLE"));
        var wrongRef = dispatch(); wrongRef.setPackageOssRef("bucket/99/100/1.zip");
        assertFalse(service.recover(wrongRef, firstEvent));
        verify(dao).recover(eq(wrongRef), isNull(), isNull(), eq("UNVERIFIED"));
        verify(storage, times(1)).get(anyString(), eq(64 * 1024 * 1024));
        verify(dao, never()).insert(any());
    }

    @org.junit.jupiter.api.BeforeEach
    void freezeOriginalWorkflow() {
        when(dao.frozenWorkflowHash(any(), eq(firstEvent))).thenReturn(workflowHash());
    }

    private String workflowHash() {
        return SdlcExecutionSnapshot.sha256(JSON.toJSONString(configuration()).getBytes(StandardCharsets.UTF_8));
    }

    private Optional<SdlcExecutionSnapshot> readArchive(DispatchDO dispatch, Date firstEventAt, byte[] bytes) {
        return SdlcExecutionSnapshotService.readArchive(dispatch, firstEventAt, bytes, workflowHash());
    }

    private SdlcExecutionSnapshot snapshot(Map<String, Object> value) { return SdlcExecutionSnapshot.from(9, 5, value); }

    private JSONObject configuration() {
        return new JSONObject(Map.of("sdlcId", "5", "currentStepId", "10", "workflow", "agent-internal-workflow", "steps", List.of(
                Map.of("id", "10", "name", "设计", "instruction", "User 指令", "required", true, "checklist", List.of("Check A")),
                Map.of("id", "11", "name", "交付", "required", true))));
    }

    private JSONObject manifest() {
        return new JSONObject(Map.of("tenantId", "9", "dispatchId", "1", "workitemId", "100", "agentId", "7",
                "agentVersionId", "70", "sdlcId", "5", "sdlcStepId", "10", "createdAt", "2026-10-22T12:00:01Z", "workflowSnapshotSha256", workflowHash()));
    }

    private DispatchDO dispatch() {
        var dispatch = new DispatchDO();
        dispatch.setId(1L); dispatch.setTenantId(9L); dispatch.setWorkitemId(100L); dispatch.setAgentId(7L);
        dispatch.setAgentVersionId(70L); dispatch.setPackageOssRef("bucket/9/100/1.zip");
        dispatch.setSdlcStepId(10L);
        dispatch.setVersion(3); dispatch.setStatus("SUCCEEDED");
        dispatch.setGmtCreate(Date.from(Instant.parse("2026-10-22T12:00:00Z")));
        return dispatch;
    }

    private byte[] archive(JSONObject manifest, JSONObject config) throws Exception {
        byte[] configuration = JSON.toJSONString(config).getBytes(StandardCharsets.UTF_8);
        manifest.putIfAbsent("fileDigests", Map.of("sdlc.json", "sha256:" + SdlcExecutionSnapshot.sha256(configuration)));
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("sdlc.json")); zip.write(configuration); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("manifest.json")); zip.write(JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
        }
        return bytes.toByteArray();
    }
}

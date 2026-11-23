package com.aliyun.autowonder.artifact;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.storage.InMemoryObjectStorage;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

import static org.junit.jupiter.api.Assertions.*;

class LogArchiveUploadTest {
    private final InMemoryObjectStorage storage = new InMemoryObjectStorage();
    private final String bucket = "logs";
    private final String prefix = "t/10/workitem/20/dispatch/30/";
    private final String path = "observability/events.jsonl";

    private static String hash(byte[] data) throws Exception {
        return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    }

    private Map<String, Object> archive(byte[] original, int partSize) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (var gzip = new GZIPOutputStream(output)) { gzip.write(original); }
        return archivePayload(original, output.toByteArray(), "gzip", partSize);
    }

    private Map<String, Object> archivePayload(byte[] original, byte[] compressed, String encoding, int partSize) throws Exception {
        String root = "observability/.log-archives/" + hash((path + "\0" + hash(original)).getBytes(StandardCharsets.UTF_8)).substring(7) + "/";
        List<Map<String, Object>> parts = new ArrayList<>();
        for (int offset = 0, index = 1; offset < compressed.length; offset += partSize, index++) {
            byte[] body = Arrays.copyOfRange(compressed, offset, Math.min(offset + partSize, compressed.length));
            String name = String.format(java.util.Locale.ROOT, "%spart-%06d", root, index);
            String digest = hash(body);
            storage.put(bucket, prefix + "objects/sha256/" + digest.substring(7) + "/" + name, body);
            parts.add(Map.of("path", name, "sha256", digest, "sizeBytes", body.length));
        }
        return new java.util.LinkedHashMap<>(Map.of("schemaVersion", "autowonder.logArchive.v1", "path", path,
                "sha256", hash(original), "sizeBytes", original.length, "encoding", encoding, "parts", parts));
    }

    @Test
    void reconstructsExactOriginalFromOrderedPartsAndKeepsPreviousObject() throws Exception {
        byte[] original = "完整日志，包含原始诊断信息\n".repeat(1024).getBytes(StandardCharsets.UTF_8);
        var manifest = archive(original, 31);
        var stored = LogArchiveUpload.store(storage, bucket, prefix, path, JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8));
        assertEquals(original.length, stored.getSize());
        assertArrayEquals(original, storage.get(stored.getOssRef()));
        byte[] later = "later immutable log".getBytes(StandardCharsets.UTF_8);
        LogArchiveUpload.store(storage, bucket, prefix, path, JSON.toJSONString(archive(later, 9)).getBytes(StandardCharsets.UTF_8));
        assertArrayEquals(original, storage.get(stored.getOssRef()));
    }

    @Test
    void cannotReadPartsFromAnotherDispatch() throws Exception {
        var manifest = archive("private original".getBytes(StandardCharsets.UTF_8), 10);
        assertThrows(LogArchiveUpload.MissingPartException.class, () -> LogArchiveUpload.store(storage, bucket,
                "t/11/workitem/21/dispatch/31/", path, JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    @SuppressWarnings("unchecked")
    void permitsBufferedTrailingBytesButRejectsUnverifiedDeclaredParts() throws Exception {
        byte[] original = "complete original log".getBytes(StandardCharsets.UTF_8);
        var compressed = new ByteArrayOutputStream();
        try (var gzip = new GZIPOutputStream(compressed)) { gzip.write(original); }
        compressed.write(new byte[]{0x13, 0x37});
        var manifest = archivePayload(original, compressed.toByteArray(), "gzip", 1024);
        var stored = LogArchiveUpload.store(storage, bucket, prefix, path, JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8));
        assertArrayEquals(original, storage.get(stored.getOssRef()));
        var parts = (List<Map<String, Object>>) manifest.get("parts");
        String first = (String) parts.getFirst().get("path");
        parts.add(Map.of("path", first.replace("part-000001", "part-000002"),
                "sha256", hash(new byte[]{7}), "sizeBytes", 1));
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix, path,
                JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void rejectsOversizedDeclarationsBeforeFetchingOrDecodingParts() throws Exception {
        var manifest = archive(new byte[]{1}, 100);
        var cloud = org.mockito.Mockito.mock(com.aliyun.autowonder.storage.ObjectStorage.class);
        org.mockito.Mockito.when(cloud.maxPutFileBytes()).thenReturn(1L << 30);
        for (var backend : List.of(storage, cloud)) {
            long maximum = LogArchiveUpload.maxDecodedBytes(backend);
            assertEquals(backend == storage ? 64L << 20 : 1L << 30, maximum);
            manifest.put("sizeBytes", maximum + 1);
            var error = assertThrows(LogArchiveUpload.SizeLimitException.class, () -> LogArchiveUpload.store(
                    backend, bucket, prefix, path, JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)));
            assertEquals(maximum, error.maximum);
        }
        var encodedManifest = archive(new byte[]{1}, 100);
        encodedManifest.put("parts", List.of(Map.of("path", ((Map<?, ?>)((List<?>)encodedManifest.get("parts")).getFirst()).get("path"),
                "sha256", hash(new byte[]{1}), "sizeBytes", (1L << 20) + 2)));
        var expanded = JSON.toJSONString(encodedManifest).getBytes(StandardCharsets.UTF_8);
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(cloud, bucket, prefix, path, expanded));
        encodedManifest.put("sizeBytes", (50L << 20) + 1);
        for (String jsonPath : List.of("observability/usage.json", "observability/nested/observability/usage.json",
                "observability/trace.json",
                "observability/nested/observability/trace.json")) {
            encodedManifest.put("path", jsonPath);
            var oversized = JSON.toJSONString(encodedManifest).getBytes(StandardCharsets.UTF_8);
            assertEquals(50L << 20, assertThrows(LogArchiveUpload.SizeLimitException.class,
                    () -> LogArchiveUpload.store(cloud, bucket, prefix, jsonPath, oversized)).maximum);
        }
        org.mockito.Mockito.verify(cloud, org.mockito.Mockito.never()).get(org.mockito.Mockito.anyString());
    }

    @Test
    void decodeBudgetReservesDiskAndConcurrencyAndReleasesExactlyOnce() throws Exception {
        var budget = new LogArchiveUpload.DecodeBudget();
        long margin = 256L << 20;
        var first = budget.reserve(100, margin + 150);
        assertThrows(IOException.class, () -> budget.reserve(51, margin + 150));
        var second = budget.reserve(50, margin + 150);
        assertThrows(IOException.class, () -> budget.reserve(0, Long.MAX_VALUE));
        first.close();
        first.close();
        try (var third = budget.reserve(100, margin + 150)) {
            assertThrows(IOException.class, () -> budget.reserve(0, Long.MAX_VALUE));
        }
        second.close();
        assertThrows(IOException.class, () -> budget.reserve(1, margin));
        try (var available = budget.reserve(150, margin + 150)) { }
    }

    @Test
    void rejectsReorderedPartsBadDigestAndDecompressionPastDeclaredSize() throws Exception {
        for (String mutation : List.of("order", "hash", "size")) {
            var manifest = archive("full original bytes".repeat(20).getBytes(StandardCharsets.UTF_8), 8);
            if (mutation.equals("order")) java.util.Collections.reverse((List<?>) manifest.get("parts"));
            if (mutation.equals("hash")) manifest.put("sha256", "sha256:" + "0".repeat(64));
            if (mutation.equals("size")) manifest.put("sizeBytes", 1);
            assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix, path,
                    JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)), mutation);
        }
    }

    @Test
    void rejectsForgedOrNonLogReferences() throws Exception {
        var manifest = archive(new byte[]{1, 2, 3}, 10);
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix,
                "artifacts/output/deliverables/report.json", JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)));
        manifest.put("parts", List.of(Map.of("path", "../another-tenant", "sha256", "sha256:" + "1".repeat(64), "sizeBytes", 2)));
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix, path,
                JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8)));
    }
    @Test
    void reconstructsClientGoldenArchiveBeforeAndAfterGzipAndFragmentation() throws Exception {
        byte[] original;
        byte[] compact;
        try (var input = getClass().getResourceAsStream("/log-archive/events-original.jsonl")) { original = input.readAllBytes(); }
        try (var input = getClass().getResourceAsStream("/log-archive/events-compact.jsonl")) { compact = input.readAllBytes(); }
        for (String encoding : List.of("events-jsonl-v1", "events-jsonl-v1+gzip")) {
            byte[] payload = compact;
            if (encoding.endsWith("gzip")) {
                var output = new ByteArrayOutputStream();
                try (var gzip = new GZIPOutputStream(output)) { gzip.write(compact); }
                payload = output.toByteArray();
            }
            var manifest = archivePayload(original, payload, encoding, 257);
            var stored = LogArchiveUpload.store(storage, bucket, prefix, path, JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8));
            assertEquals(original.length, stored.getSize());
            assertTrue(stored.getOssRef().contains(hash(original).substring(7)));
            assertArrayEquals(original, storage.get(stored.getOssRef()));
        }
    }

    @Test
    void rejectsMissingBodyWrongBodyHashInvalidRowsAndUnknownRecords() {
        for (String encoded : List.of(
                "{\"$awEvents\":\"tool\",\"id\":\"" + "a".repeat(64) + "\",\"prefix\":\"x\",\"suffix\":\"y\"}\n",
                "{\"$awEvents\":\"tool\",\"id\":\"" + "a".repeat(64) + "\",\"body\":\"" + "x".repeat(1024) + "\"}\n",
                "{\"$awEvents\":\"messages\",\"template\":[\"x\",\"y\"],\"rows\":[[]]}\n",
                "{\"$awEvents\":\"future\"}\n")) {
            assertThrows(IllegalArgumentException.class, () -> EventLogArchive.decode(
                    new java.io.ByteArrayInputStream(encoded.getBytes(StandardCharsets.UTF_8)), new ByteArrayOutputStream(), 1 << 20));
        }
    }

    private byte[] manifestBytes(Map<String, Object> manifest) {
        return JSON.toJSONString(manifest).getBytes(StandardCharsets.UTF_8);
    }

    private void assertStoreRejected(Map<String, Object> manifest) {
        assertThrows(IllegalArgumentException.class,
                () -> LogArchiveUpload.store(storage, bucket, prefix, path, manifestBytes(manifest)));
    }

    private static byte[] gzipOf(byte[] data) throws Exception {
        var output = new ByteArrayOutputStream();
        try (var gzip = new GZIPOutputStream(output)) { gzip.write(data); }
        return output.toByteArray();
    }

    @Test
    void rejectsManifestPathAndSizePreconditions() throws Exception {
        var manifest = archive("precondition".getBytes(StandardCharsets.UTF_8), 4);
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix,
                "observability/.log-archives/manifest.json", manifestBytes(manifest)));
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix,
                path, new byte[(1 << 20) + 1]));
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix,
                path, "null".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void rejectsManifestIdentityMutations() throws Exception {
        byte[] original = "identity".getBytes(StandardCharsets.UTF_8);
        for (var mutation : List.<java.util.function.Consumer<Map<String, Object>>>of(
                mutated -> mutated.put("schemaVersion", "autowonder.logArchive.v2"),
                mutated -> mutated.put("path", "observability/other.jsonl"),
                mutated -> mutated.put("encoding", "bzip2"),
                mutated -> mutated.put("sha256", null),
                mutated -> mutated.put("sha256", "sha256:XYZ"),
                mutated -> mutated.put("sizeBytes", -1L),
                mutated -> mutated.put("parts", null),
                mutated -> mutated.put("parts", List.of()))) {
            var manifest = archive(original, 4);
            mutation.accept(manifest);
            assertStoreRejected(manifest);
        }
        var tooManyParts = archive(original, 4);
        var parts = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < 4097; i++) {
            parts.add(Map.of("path", "part-" + i, "sha256", hash(original), "sizeBytes", 1));
        }
        tooManyParts.put("parts", parts);
        assertStoreRejected(tooManyParts);
    }

    @Test
    void rejectsPartIdentityAndSizeMutations() throws Exception {
        byte[] original = "part identity".getBytes(StandardCharsets.UTF_8);
        List<java.util.function.Consumer<List<Map<String, Object>>>> mutations = List.of(
                list -> list.set(0, null),
                list -> list.set(0, Map.of("path", "observability/.log-archives/other/part-000001",
                        "sha256", (String) ((Map<?, ?>) list.get(0)).get("sha256"), "sizeBytes", 1)),
                list -> list.set(0, Map.of("path", (String) ((Map<?, ?>) list.get(0)).get("path"),
                        "sha256", "sha256:zz", "sizeBytes", 1)),
                list -> list.set(0, Map.of("path", (String) ((Map<?, ?>) list.get(0)).get("path"),
                        "sha256", (String) ((Map<?, ?>) list.get(0)).get("sha256"), "sizeBytes", 0)),
                list -> list.set(0, Map.of("path", (String) ((Map<?, ?>) list.get(0)).get("path"),
                        "sha256", (String) ((Map<?, ?>) list.get(0)).get("sha256"), "sizeBytes", (50L << 20) + 1)));
        for (var mutation : mutations) {
            var manifest = archive(original, 4);
            var parts = new ArrayList<Map<String, Object>>((List<Map<String, Object>>) manifest.get("parts"));
            mutation.accept(parts);
            manifest.put("parts", parts);
            assertStoreRejected(manifest);
        }
    }

    @Test
    void rejectsDecodedLengthMismatchAndCorruptedStoredParts() throws Exception {
        byte[] original = "decoded length".getBytes(StandardCharsets.UTF_8);
        var longer = archive(original, 1024);
        longer.put("sizeBytes", (long) original.length + 1);
        assertStoreRejected(longer);

        var manifest = archive(original, 1024);
        var part = (Map<?, ?>) ((List<?>) manifest.get("parts")).getFirst();
        String partSha = (String) part.get("sha256");
        String partKey = prefix + "objects/sha256/" + partSha.substring(7) + "/" + part.get("path");
        byte[] corrupted = storage.get(bucket + "/" + partKey).clone();
        corrupted[0] ^= 1;
        storage.put(bucket, partKey, corrupted);
        assertStoreRejected(manifest);
    }

    private Map<String, Object> archivePayloadFor(String logicalPath, byte[] original, byte[] compressed,
                                                  String encoding, int partSize) throws Exception {
        String root = "observability/.log-archives/"
                + hash((logicalPath + "\0" + hash(original)).getBytes(StandardCharsets.UTF_8)).substring(7) + "/";
        List<Map<String, Object>> parts = new ArrayList<>();
        for (int offset = 0, index = 1; offset < compressed.length; offset += partSize, index++) {
            byte[] body = Arrays.copyOfRange(compressed, offset, Math.min(offset + partSize, compressed.length));
            String name = String.format(java.util.Locale.ROOT, "%spart-%06d", root, index);
            String digest = hash(body);
            storage.put(bucket, prefix + "objects/sha256/" + digest.substring(7) + "/" + name, body);
            parts.add(Map.of("path", name, "sha256", digest, "sizeBytes", body.length));
        }
        return new java.util.LinkedHashMap<>(Map.of("schemaVersion", "autowonder.logArchive.v1", "path", logicalPath,
                "sha256", hash(original), "sizeBytes", original.length, "encoding", encoding, "parts", parts));
    }

    @Test
    void acceptsGzipForNonEventLogButRejectsEventCodecElsewhere() throws Exception {
        byte[] original = "daemon log bytes".repeat(32).getBytes(StandardCharsets.UTF_8);
        String daemonPath = "observability/daemon.log";
        var gzipManifest = archivePayloadFor(daemonPath, original, gzipOf(original), "gzip", 8);
        var stored = LogArchiveUpload.store(storage, bucket, prefix, daemonPath, manifestBytes(gzipManifest));
        assertArrayEquals(original, storage.get(stored.getOssRef()));

        var codecManifest = archivePayloadFor(daemonPath, original, gzipOf(original), "events-jsonl-v1", 8);
        assertThrows(IllegalArgumentException.class, () -> LogArchiveUpload.store(storage, bucket, prefix,
                daemonPath, manifestBytes(codecManifest)));
    }

    @Test
    void decodeBudgetRejectsInsufficientUsableSpace() {
        var budget = new LogArchiveUpload.DecodeBudget();
        long margin = 256L << 20;
        assertThrows(IOException.class, () -> budget.reserve(1, margin - 1));
    }

}

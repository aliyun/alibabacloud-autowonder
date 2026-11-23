package com.aliyun.autowonder.storage;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class InMemoryObjectStorageTest {

    @Test
    void rejectsSparseOversizedFileBeforeAllocatingItsContents() throws Exception {
        var storage = new InMemoryObjectStorage();
        var file = java.nio.file.Files.createTempFile("memory-store-limit-", ".log");
        try {
            try (var sparse = new java.io.RandomAccessFile(file.toFile(), "rw")) {
                sparse.setLength(storage.maxPutFileBytes() + 1);
            }
            assertThrows(IllegalArgumentException.class, () -> storage.putFile("bucket", "too-large", file));
            assertFalse(storage.exists("bucket/too-large"));
        } finally {
            java.nio.file.Files.deleteIfExists(file);
        }
    }

    @Test
    void put_then_get_roundtrips_and_computes_md5_size() {
        InMemoryObjectStorage s = new InMemoryObjectStorage();
        byte[] data = "hello".getBytes(StandardCharsets.UTF_8);
        StoredObject obj = s.put("bkt", "a/b.zip", data);

        assertEquals("bkt/a/b.zip", obj.getOssRef());
        assertEquals(5L, obj.getSize());
        assertEquals("5d41402abc4b2a76b9719d911017c592", obj.getMd5());
        assertArrayEquals(data, s.get(obj.getOssRef()));
    }

    @Test
    void presign_returns_nonblank_url_containing_ref() {
        InMemoryObjectStorage s = new InMemoryObjectStorage();
        StoredObject obj = s.put("bkt", "k", new byte[]{1, 2, 3});
        String url = s.presignGet(obj.getOssRef(), 600);
        assertTrue(url.contains("bkt/k"));
    }

    @Test
    void get_missing_returns_null_and_delete_is_idempotent() {
        InMemoryObjectStorage s = new InMemoryObjectStorage();
        assertNull(s.get("nope/x"));
        s.delete("nope/x"); // no throw
        StoredObject obj = s.put("b", "k", new byte[]{9});
        s.delete(obj.getOssRef());
        assertNull(s.get(obj.getOssRef()));
    }

    @Test
    void putFileRejectsUnreadableSourcePath() throws Exception {
        var storage = new InMemoryObjectStorage();
        var directory = java.nio.file.Files.createTempDirectory("memory-store-dir-");
        try {
            ObjectStorageException failure = assertThrows(ObjectStorageException.class,
                    () -> storage.putFile("bucket", "directory", directory));
            assertNull(failure.getErrorCode());
            assertFalse(storage.exists("bucket/directory"));
        } finally {
            java.nio.file.Files.deleteIfExists(directory);
        }
    }

    @Test
    void presignPutReturnsRecognizableFakeUrl() {
        InMemoryObjectStorage storage = new InMemoryObjectStorage();

        String url = storage.presignPut("bucket", "debug/1/k.log.gz", java.time.Duration.ofMinutes(20));

        assertEquals("mem-put://bucket/debug/1/k.log.gz?ttl=1200", url);
    }
}

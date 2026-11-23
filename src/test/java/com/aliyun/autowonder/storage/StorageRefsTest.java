package com.aliyun.autowonder.storage;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class StorageRefsTest {

    @Test
    void md5Hex_matches_known_vector() {
        assertEquals("5d41402abc4b2a76b9719d911017c592",
                StorageRefs.md5Hex("hello".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void md5HexFromPathMatchesBytes() throws Exception {
        var file = java.nio.file.Files.createTempFile("storage-refs-", ".bin");
        try {
            byte[] data = "hello".getBytes(StandardCharsets.UTF_8);
            java.nio.file.Files.write(file, data);
            assertEquals(StorageRefs.md5Hex(data), StorageRefs.md5Hex(file));
        } finally {
            java.nio.file.Files.deleteIfExists(file);
        }
    }

    @Test
    void split_parses_bucket_and_key_on_first_slash() {
        assertArrayEquals(new String[]{"bkt", "a/b/c.zip"}, StorageRefs.split("bkt/a/b/c.zip"));
        assertArrayEquals(new String[]{"b", "k"}, StorageRefs.split("b/k"));
    }

    @Test
    void split_rejects_missing_or_empty_parts() {
        assertThrows(IllegalArgumentException.class, () -> StorageRefs.split(null));
        assertThrows(IllegalArgumentException.class, () -> StorageRefs.split("bucketonly"));
        assertThrows(IllegalArgumentException.class, () -> StorageRefs.split("/key"));
        assertThrows(IllegalArgumentException.class, () -> StorageRefs.split("bucket/"));
    }
}

package com.aliyun.autowonder.storage;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ObjectStorageDefaultsTest {

    private static ObjectStorage withoutFileUpload() {
        return new ObjectStorage() {
            @Override
            public StoredObject put(String bucket, String key, byte[] data) {
                throw new UnsupportedOperationException();
            }

            @Override
            public byte[] get(String ossRef) {
                return null;
            }

            @Override
            public String presignGet(String ossRef, int ttlSeconds) {
                return "";
            }

            @Override
            public String presignPut(String bucket, String key, Duration ttl) {
                return "";
            }

            @Override
            public boolean exists(String ossRef) {
                return false;
            }

            @Override
            public void delete(String ossRef) {
            }
        };
    }

    @Test
    void defaultPutFileLimitAndUnsupportedFileUploadAreExplicit() throws Exception {
        ObjectStorage storage = withoutFileUpload();
        assertEquals(1L << 30, storage.maxPutFileBytes());
        var file = java.nio.file.Files.createTempFile("object-storage-default-", ".bin");
        try {
            assertThrows(UnsupportedOperationException.class, () -> storage.putFile("bucket", "key", file));
        } finally {
            java.nio.file.Files.deleteIfExists(file);
        }
    }
}

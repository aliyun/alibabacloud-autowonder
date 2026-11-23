package com.aliyun.autowonder.storage;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;

public class InMemoryObjectStorage implements ObjectStorage {

    private final ConcurrentHashMap<String, byte[]> store = new ConcurrentHashMap<>();

    @Override
    public StoredObject put(String bucket, String key, byte[] data) {
        String ossRef = bucket + "/" + key;
        store.put(ossRef, data.clone());
        return new StoredObject(ossRef, StorageRefs.md5Hex(data), data.length);
    }

    @Override
    public byte[] get(String ossRef) {
        byte[] v = store.get(ossRef);
        return v == null ? null : v.clone();
    }

    @Override
    public long maxPutFileBytes() {
        return 64L << 20;
    }

    @Override
    public StoredObject putFile(String bucket, String key, java.nio.file.Path file) {
        try {
            if (java.nio.file.Files.size(file) > maxPutFileBytes()) {
                throw new IllegalArgumentException("file exceeds in-memory storage limit");
            }
            return put(bucket, key, java.nio.file.Files.readAllBytes(file));
        } catch (java.io.IOException failure) {
            throw new ObjectStorageException("read upload file failed", bucket, key, null, failure);
        }
    }

    @Override
    public String presignGet(String ossRef, int ttlSeconds) {
        return "mem://" + ossRef + "?ttl=" + ttlSeconds;
    }

    @Override
    public String presignPut(String bucket, String key, Duration ttl) {
        return "mem-put://" + bucket + "/" + key + "?ttl=" + ttl.toSeconds();
    }

    @Override
    public boolean exists(String ossRef) {
        return store.containsKey(ossRef);
    }

    @Override
    public void delete(String ossRef) {
        store.remove(ossRef);
    }
}

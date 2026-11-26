package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.storage.ObjectStorage;
import com.aliyun.autowonder.storage.OssProperties;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Immutable, bundled template; only its short-lived URL is generated at dispatch time. */
@Service
public class PrdDesignTemplateService {
    private final ObjectStorage storage;
    private final OssProperties properties;

    public PrdDesignTemplateService(ObjectStorage storage, OssProperties properties) {
        this.storage = storage;
        this.properties = properties;
    }

    public record Download(String url, String sha256) {}

    public Download download() {
        try {
            byte[] bytes;
            try (var input = new ClassPathResource("templates/uxer-fe-template.zip").getInputStream()) {
                bytes = input.readAllBytes();
            }
            String hash = digest(bytes);
            String bucket = properties.getTaskPkgBucket();
            if (bucket == null || bucket.isBlank()) bucket = properties.getBucket();
            String ref = bucket + "/design-templates/uxer-fe-template/" + hash + ".zip";
            if (!storage.exists(ref)) storage.put(bucket, "design-templates/uxer-fe-template/" + hash + ".zip", bytes);
            return new Download(storage.presignGet(ref, 3600), hash);
        } catch (IOException failure) {
            throw new IllegalStateException("Bundled design template is unavailable", failure);
        }
    }

    static String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}

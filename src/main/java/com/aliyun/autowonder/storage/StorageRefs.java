package com.aliyun.autowonder.storage;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Shared helpers for object-storage references: md5 digests and ossRef ("{bucket}/{key}") parsing.
 * Kept impl-neutral so neither storage backend depends on the other.
 */
final class StorageRefs {

    private StorageRefs() {
    }

    /** Lowercase hex MD5 of the given bytes. */
    static String md5Hex(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("MD5").digest(data);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String md5Hex(java.nio.file.Path file) throws java.io.IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("MD5");
            try (var input = new java.security.DigestInputStream(java.nio.file.Files.newInputStream(file), digest)) {
                input.transferTo(java.io.OutputStream.nullOutputStream());
            }
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException(failure);
        }
    }

    /** Split "{bucket}/{key}" on the first slash into [bucket, key]; throws if either part is empty. */
    static String[] split(String ossRef) {
        int i = ossRef == null ? -1 : ossRef.indexOf('/');
        if (i <= 0 || i == ossRef.length() - 1) {
            throw new IllegalArgumentException("bad ossRef: " + ossRef);
        }
        return new String[]{ossRef.substring(0, i), ossRef.substring(i + 1)};
    }
}

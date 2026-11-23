package com.aliyun.autowonder.artifact;

import com.aliyun.autowonder.aiusage.DispatchAiUsageService;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.storage.ObjectStorage;
import com.aliyun.autowonder.storage.StoredObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.FilterOutputStream;
import java.io.OutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.zip.GZIPInputStream;

/** Resolves only immutable objects owned by this authenticated dispatch. */
final class LogArchiveUpload {
    private static final DecodeBudget BUDGET = new DecodeBudget();

    static long maxDecodedBytes(ObjectStorage storage) {
        return Math.min(1L << 30, storage.maxPutFileBytes());
    }

    record Part(String path, String sha256, long sizeBytes) {}
    record Manifest(String schemaVersion, String path, String sha256, long sizeBytes, String encoding, List<Part> parts) {}

    static StoredObject store(ObjectStorage storage, String bucket, String dispatchPrefix,
                              String logicalPath, byte[] manifestBytes) throws IOException {
        if (!logicalPath.startsWith("observability/") || logicalPath.startsWith("observability/.log-archives/")
                || manifestBytes.length > 1 << 20) throw invalid();
        Manifest manifest;
        try {
            manifest = JSON.parseObject(new String(manifestBytes, StandardCharsets.UTF_8), Manifest.class);
        } catch (RuntimeException failure) {
            throw invalid();
        }
        if (manifest == null || !"autowonder.logArchive.v1".equals(manifest.schemaVersion())
                || !logicalPath.equals(manifest.path()) || !validEncoding(manifest.encoding(), logicalPath)
                || !validHash(manifest.sha256()) || manifest.sizeBytes() < 0
                || manifest.parts() == null || manifest.parts().isEmpty() || manifest.parts().size() > 4096) throw invalid();
        long maximum = maxDecodedBytes(storage);
        // These JSON artifacts are read into memory by their consumers.
        if (DispatchAiUsageService.isUsageArtifact(logicalPath) || ("/" + logicalPath).endsWith("/observability/trace.json")) {
            maximum = Math.min(maximum, 50L << 20);
        }
        if (manifest.sizeBytes() > maximum) throw new SizeLimitException(maximum);
        String partPrefix = "observability/.log-archives/" + hash((logicalPath + "\0" + manifest.sha256()).getBytes(StandardCharsets.UTF_8)) + "/";
        long encodedBytes = 0;
        for (int i = 0; i < manifest.parts().size(); i++) {
            Part part = manifest.parts().get(i);
            if (part == null || !String.format(java.util.Locale.ROOT, "%spart-%06d", partPrefix, i + 1).equals(part.path())
                    || !validHash(part.sha256()) || part.sizeBytes() <= 0 || part.sizeBytes() > (50L << 20)) throw invalid();
            encodedBytes += part.sizeBytes();
            // gzip may slightly expand incompressible input; the event codec is selected only when smaller.
            if (encodedBytes > manifest.sizeBytes() + (1L << 20)) throw invalid();
        }
        try (var reservation = BUDGET.reserve(manifest.sizeBytes(), Files.getFileStore(
                Path.of(System.getProperty("java.io.tmpdir"))).getUsableSpace())) {
            Path decoded = Files.createTempFile("autowonder-log-archive-", ".decoded");
            try {
                MessageDigest digest = digest();
                try (Parts parts = new Parts(storage, bucket, dispatchPrefix, manifest.parts());
                     InputStream payload = manifest.encoding().endsWith("gzip") ? new GZIPInputStream(parts) : parts;
                     var fileOutput = new BufferedOutputStream(Files.newOutputStream(decoded))) {
                    BoundedOutput output = new BoundedOutput(fileOutput, digest, manifest.sizeBytes());
                    if (manifest.encoding().startsWith("events-jsonl-v1")) {
                        EventLogArchive.decode(payload, output, manifest.sizeBytes());
                    } else {
                        byte[] buffer = new byte[64 << 10];
                        int read;
                        while ((read = payload.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                    if (output.count != manifest.sizeBytes() || !("sha256:" + HexFormat.of().formatHex(digest.digest())).equals(manifest.sha256())) throw invalid();
                    // Accept JDK gzip's buffered trailing bytes only within verified declared parts.
                    if (parts.index != manifest.parts().size() || (parts.current != null && parts.current.available() != 0)) throw invalid();
                } catch (java.util.zip.ZipException | java.io.EOFException failure) {
                    throw invalid();
                }
                return storage.putFile(bucket, dispatchPrefix + "objects/sha256/" + manifest.sha256().substring(7) + "/" + logicalPath, decoded);
            } finally {
                Files.deleteIfExists(decoded);
            }
        }
    }

    static final class SizeLimitException extends IllegalArgumentException {
        final long maximum;
        SizeLimitException(long maximum) {
            super("log archive exceeds decoded storage limit");
            this.maximum = maximum;
        }
    }

    static final class MissingPartException extends IllegalArgumentException {
        MissingPartException() { super("log archive part was not accepted"); }
    }

    /** Reserve before creating a file; concurrent uploads keep a shared free-space margin. */
    static final class DecodeBudget {
        private static final long FREE_MARGIN = 256L << 20;
        private int active;
        private long reserved;

        synchronized Reservation reserve(long bytes, long usableSpace) throws IOException {
            if (active >= 2 || usableSpace < FREE_MARGIN || bytes > usableSpace - FREE_MARGIN - reserved) {
                throw new IOException("log archive decode capacity is temporarily unavailable");
            }
            active++;
            reserved += bytes;
            return new Reservation(bytes);
        }

        final class Reservation implements AutoCloseable {
            private final long bytes;
            private boolean closed;
            Reservation(long bytes) { this.bytes = bytes; }
            @Override public void close() {
                synchronized (DecodeBudget.this) {
                    if (!closed) { active--; reserved -= bytes; closed = true; }
                }
            }
        }
    }

    private static boolean validEncoding(String encoding, String path) {
        return "gzip".equals(encoding) || ("observability/events.jsonl".equals(path)
                && ("events-jsonl-v1".equals(encoding) || "events-jsonl-v1+gzip".equals(encoding)));
    }

    private static final class BoundedOutput extends FilterOutputStream {
        private final MessageDigest digest;
        private final long expected;
        private long count;

        BoundedOutput(OutputStream output, MessageDigest digest, long expected) {
            super(output);
            this.digest = digest;
            this.expected = expected;
        }

        @Override
        public void write(int value) throws IOException {
            write(new byte[]{(byte) value}, 0, 1);
        }

        @Override
        public void write(byte[] bytes, int offset, int length) throws IOException {
            if (length > expected - count) throw invalid();
            out.write(bytes, offset, length);
            digest.update(bytes, offset, length);
            count += length;
        }
    }

    private static boolean validHash(String hash) {
        return hash != null && hash.matches("sha256:[a-f0-9]{64}");
    }

    private static String hash(byte[] bytes) {
        return HexFormat.of().formatHex(digest().digest(bytes));
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("invalid log archive identity or content");
    }

    private static final class Parts extends InputStream {
        private final ObjectStorage storage;
        private final String bucket;
        private final String prefix;
        private final List<Part> parts;
        private int index;
        private ByteArrayInputStream current;

        private Parts(ObjectStorage storage, String bucket, String prefix, List<Part> parts) {
            this.storage = storage;
            this.bucket = bucket;
            this.prefix = prefix;
            this.parts = parts;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            while (current == null || current.available() == 0) {
                current = null;
                if (index == parts.size()) return -1;
                Part part = parts.get(index++);
                // shortcut: two decodes retain one <=50 MiB part each; stream storage reads if these limits grow.
                byte[] bytes = storage.get(bucket + "/" + prefix + "objects/sha256/" + part.sha256().substring(7) + "/" + part.path());
                if (bytes == null) throw new MissingPartException();
                if (bytes.length != part.sizeBytes() || !("sha256:" + hash(bytes)).equals(part.sha256())) throw invalid();
                current = new ByteArrayInputStream(bytes);
            }
            return current.read(buffer, offset, length);
        }
    }
}

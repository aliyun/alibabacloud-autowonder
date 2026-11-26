package com.aliyun.autowonder.storage;

import com.aliyun.oss.HttpMethod;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSException;
import com.aliyun.oss.model.GeneratePresignedUrlRequest;
import com.aliyun.oss.model.OSSObject;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.net.URI;
import java.net.URL;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AliyunOssObjectStorageTest {

    @Test
    void putFileStreamsOriginalContentWithExplicitLength() throws Exception {
        var file=java.nio.file.Files.createTempFile("oss-stream-", ".log");
        try {
            byte[] data={4,3,2,1};
            java.nio.file.Files.write(file,data);
            OSS client=mock(OSS.class);
            org.mockito.Mockito.doAnswer(invocation -> {
                assertArrayEquals(data,((InputStream)invocation.getArgument(2)).readAllBytes());
                assertEquals(data.length,((com.aliyun.oss.model.ObjectMetadata)invocation.getArgument(3)).getContentLength());
                return null;
            }).when(client).putObject(eq("bucket"),eq("key"),any(InputStream.class),any(com.aliyun.oss.model.ObjectMetadata.class));
            var stored=new AliyunOssObjectStorage(client,mock(OSS.class)).putFile("bucket","key",file);
            assertEquals(StorageRefs.md5Hex(data),stored.getMd5());
            assertEquals(data.length,stored.getSize());
        } finally { java.nio.file.Files.delete(file); }
    }

    @Test
    void boundedGetRejectsLargeBodiesAndClosesTheStream() throws Exception {
        OSS client = mock(OSS.class); OSSObject object = new OSSObject();
        var response = mock(com.aliyun.oss.common.comm.ResponseMessage.class);
        object.setResponse(response);
        var closed = new java.util.concurrent.atomic.AtomicBoolean();
        var input = new ByteArrayInputStream(new byte[20]) {
            @Override public void close() { closed.set(true); }
        };
        object.setObjectContent(input); when(client.getObject("bucket", "key")).thenReturn(object);
        var storage = new AliyunOssObjectStorage(client, client);
        assertThrows(ObjectStorage.SizeLimitExceededException.class, () -> storage.get("bucket/key", 4));
        verify(response).abort();
        assertEquals(15, input.available());
        assertTrue(closed.get());
    }

    @Test
    void boundedGetRejectsOversizeMetadataEvenIfAbortFails() throws Exception {
        OSS client = mock(OSS.class);
        OSSObject object = new OSSObject();
        var response = mock(com.aliyun.oss.common.comm.ResponseMessage.class);
        org.mockito.Mockito.doThrow(new java.io.IOException("abort failed")).when(response).abort();
        object.setResponse(response);
        var metadata = new com.aliyun.oss.model.ObjectMetadata();
        metadata.setContentLength(20);
        object.setObjectMetadata(metadata);
        var input = new ByteArrayInputStream(new byte[20]);
        object.setObjectContent(input);
        when(client.getObject("bucket", "key")).thenReturn(object);
        var failure = assertThrows(ObjectStorage.SizeLimitExceededException.class,
                () -> new AliyunOssObjectStorage(client, client).get("bucket/key", 4));
        assertEquals(20, input.available());
        assertEquals(1, failure.getSuppressed().length);
    }

    @Test
    void putUsesServiceClientWithoutCallingPublicClient() {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        storage.put("bucket", "object", new byte[]{1, 2, 3});

        verify(serviceClient).putObject(eq("bucket"), eq("object"), any(InputStream.class));
        verifyNoInteractions(publicClient);
    }

    @Test
    void presignUsesPublicClientWithoutCallingServiceClient() throws MalformedURLException {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        when(publicClient.generatePresignedUrl(any()))
                .thenReturn(new URL("https://bucket.oss-cn-shanghai.aliyuncs.com/object?signature=test"));
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        String url = storage.presignGet("bucket/object", 600);

        assertEquals("https://bucket.oss-cn-shanghai.aliyuncs.com/object?signature=test", url);
        verify(publicClient).generatePresignedUrl(any());
        verifyNoInteractions(serviceClient);
    }

    @Test
    void presignUpgradesHttpUrlToHttpsWithoutChangingSignature() throws MalformedURLException {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        when(publicClient.generatePresignedUrl(any()))
                .thenReturn(new URL("http://bucket.oss-cn-beijing.aliyuncs.com/object?Expires=1&Signature=test"));
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        String url = storage.presignGet("bucket/object", 600);

        assertEquals("https://bucket.oss-cn-beijing.aliyuncs.com/object?Expires=1&Signature=test", url);
        verify(publicClient).generatePresignedUrl(any());
        verifyNoInteractions(serviceClient);
    }

    @Test
    void presignBuildsUrlFromPublicEndpointWithoutRewritingSignedHost() {
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(
                "https://oss-cn-shanghai-internal.aliyuncs.com",
                "https://oss-cn-shanghai.aliyuncs.com",
                "test-access-key-id", "test-access-key-secret");

        URI url = URI.create(storage.presignGet("bucket/object", 600));

        assertEquals("bucket.oss-cn-shanghai.aliyuncs.com", url.getHost());
    }

    @Test
    void getReturnsBytesOnSuccess() {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        byte[] data = {10, 20, 30};
        OSSObject ossObject = mock(OSSObject.class);
        when(ossObject.getObjectContent()).thenReturn(new ByteArrayInputStream(data));
        when(serviceClient.getObject("bucket", "key")).thenReturn(ossObject);
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        byte[] result = storage.get("bucket/key");

        assertArrayEquals(data, result);
    }

    @Test
    void getReturnsNullForNoSuchKey() {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        when(serviceClient.getObject("bucket", "key"))
                .thenThrow(new OSSException("NoSuchKey", "NoSuchKey", null, null, null, null, null));
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        assertNull(storage.get("bucket/key"));
    }

    @Test
    void getThrowsObjectStorageExceptionForTransientOssError() {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        when(serviceClient.getObject("bucket", "key"))
                .thenThrow(new OSSException("InternalError", "InternalError", null, null, null, null, null));
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        ObjectStorageException ex = assertThrows(ObjectStorageException.class,
                () -> storage.get("bucket/key"));
        assertEquals("InternalError", ex.getErrorCode());
    }

    @Test
    void getThrowsObjectStorageExceptionForNonOssException() {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        when(serviceClient.getObject("bucket", "key"))
                .thenThrow(new RuntimeException("connection reset"));
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        ObjectStorageException ex = assertThrows(ObjectStorageException.class,
                () -> storage.get("bucket/key"));
        assertNull(ex.getErrorCode());
    }

    @Test
    void presignPutUsesPublicClientWithPutMethodAndTtl() throws Exception {
        OSS serviceClient = mock(OSS.class);
        OSS publicClient = mock(OSS.class);
        when(publicClient.generatePresignedUrl(any()))
                .thenReturn(new URL("https://bucket.oss-cn-shanghai.aliyuncs.com/debug/1/k.log.gz?sig=put"));
        AliyunOssObjectStorage storage = new AliyunOssObjectStorage(serviceClient, publicClient);

        long before = System.currentTimeMillis();
        String url = storage.presignPut("bucket", "debug/1/k.log.gz", Duration.ofMinutes(20));
        long after = System.currentTimeMillis();

        assertEquals("https://bucket.oss-cn-shanghai.aliyuncs.com/debug/1/k.log.gz?sig=put", url);
        ArgumentCaptor<GeneratePresignedUrlRequest> cap =
                ArgumentCaptor.forClass(GeneratePresignedUrlRequest.class);
        verify(publicClient).generatePresignedUrl(cap.capture());
        verifyNoInteractions(serviceClient);
        GeneratePresignedUrlRequest req = cap.getValue();
        assertEquals("bucket", req.getBucketName());
        assertEquals("debug/1/k.log.gz", req.getKey());
        assertEquals(HttpMethod.PUT, req.getMethod());
        long expiry = req.getExpiration().getTime();
        assertTrue(expiry >= before + 20 * 60_000L && expiry <= after + 20 * 60_000L,
                "expiration must be ~20 minutes out");
    }

    @Test
    void putFileMapsOssErrorCodeAndGenericFailures() throws Exception {
        var file = java.nio.file.Files.createTempFile("oss-stream-failure-", ".log");
        try {
            java.nio.file.Files.write(file, new byte[]{1, 2, 3});
            OSS failing = mock(OSS.class);
            org.mockito.Mockito.doThrow(new OSSException("AccessDenied", "AccessDenied", null, null, null, null, null))
                    .when(failing).putObject(eq("bucket"), eq("key"), any(InputStream.class),
                            any(com.aliyun.oss.model.ObjectMetadata.class));
            ObjectStorageException coded = assertThrows(ObjectStorageException.class,
                    () -> new AliyunOssObjectStorage(failing, mock(OSS.class)).putFile("bucket", "key", file));
            assertEquals("AccessDenied", coded.getErrorCode());

            OSS broken = mock(OSS.class);
            org.mockito.Mockito.doThrow(new IllegalStateException("boom"))
                    .when(broken).putObject(eq("bucket"), eq("key"), any(InputStream.class),
                            any(com.aliyun.oss.model.ObjectMetadata.class));
            ObjectStorageException generic = assertThrows(ObjectStorageException.class,
                    () -> new AliyunOssObjectStorage(broken, mock(OSS.class)).putFile("bucket", "key", file));
            assertNull(generic.getErrorCode());
        } finally {
            java.nio.file.Files.deleteIfExists(file);
        }
    }
}

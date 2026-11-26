package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.storage.ObjectStorage;
import com.aliyun.autowonder.storage.OssProperties;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import java.util.HashMap;
import java.util.zip.ZipInputStream;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PrdDesignTemplateServiceTest {
    @Test void bundledArchiveHasPinnedSourceAndCollaborationCommandWithoutPrivateFiles() throws Exception {
        var files = new HashMap<String, String>();
        try (var zip = new ZipInputStream(new ClassPathResource("templates/uxer-fe-template.zip").getInputStream())) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                String name = entry.getName();
                assertFalse(name.startsWith("/") || name.contains("..") || name.startsWith(".git/")
                        || name.startsWith("node_modules/") || name.startsWith("dist/")
                        || (name.startsWith(".env") && !name.equals(".env.example")), name);
                files.put(name, new String(zip.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            }
        }
        var manifest = com.aliyun.autowonder.json.JSON.parseObject(files.get("package.json"));
        assertTrue(manifest.getJSONObject("scripts").getString("dev:autowonder").contains("--mode autowonder"));
        var dependencies = manifest.getJSONObject("dependencies");
        assertEquals("0.3.0", dependencies.getString("@uxerjs/universal-inspector"));
        assertFalse(dependencies.containsKey("@ali/uxer-inspector"));
        assertFalse(files.get("pnpm-lock.yaml").contains("@ali/uxer-inspector"));
        assertTrue(files.get("src/main.tsx").contains("from '@uxerjs/universal-inspector/react'"));
        var metadata = com.aliyun.autowonder.json.JSON.parseObject(files.get(".autowonder-template.json"));
        assertFalse(metadata.containsKey("repository"));
        assertEquals("5ac298c4aed3d1b2240eaf7e754d44bb36032ce0", metadata.getString("sourceCommit"));
    }

    @Test void immutableObjectUsesArchiveHashAndFreshExpiringDownload() {
        var storage = mock(ObjectStorage.class);
        var properties = new OssProperties();
        properties.setTaskPkgBucket("test-packages");
        when(storage.presignGet(anyString(), eq(3600))).thenReturn("https://download.test/first", "https://download.test/second");
        var service = new PrdDesignTemplateService(storage, properties);
        var first = service.download();
        when(storage.exists(anyString())).thenReturn(true);
        var second = service.download();
        assertEquals(first.sha256(), second.sha256());
        assertNotEquals(first.url(), second.url());
        verify(storage, times(1)).put(eq("test-packages"), eq("design-templates/uxer-fe-template/" + first.sha256() + ".zip"), any(byte[].class));
        verify(storage, times(2)).presignGet("test-packages/design-templates/uxer-fe-template/" + first.sha256() + ".zip", 3600);
    }
}

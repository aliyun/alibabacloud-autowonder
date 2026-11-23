package com.aliyun.autowonder.im;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/** Platform collaboration notifications use a custom Feishu app and the recipient's user_id. */
@Component
public class FeishuImProvider implements ImProvider {
    static final String DEFAULT_BASE_URL = "https://open.feishu.cn/open-apis";
    private final PlatformImChannelConfigService configs;
    private final ObjectMapper json;
    private final OkHttpClient http;
    private final String defaultBaseUrl;

    @Autowired
    public FeishuImProvider(PlatformImChannelConfigService configs, ObjectMapper json) {
        this(configs, json, new OkHttpClient.Builder().callTimeout(Duration.ofSeconds(10))
                .followRedirects(false).followSslRedirects(false).build(), DEFAULT_BASE_URL);
    }

    FeishuImProvider(PlatformImChannelConfigService configs, ObjectMapper json, OkHttpClient http, String defaultBaseUrl) {
        this.configs = configs;
        this.json = json;
        this.http = http;
        this.defaultBaseUrl = defaultBaseUrl;
    }

    @Override
    public String provider() { return "FEISHU"; }

    @Override
    public void send(ImSendCommand command) {
        PlatformImChannelConfigDO config = configs.findEnabled(provider());
        if (config == null || config.getAppKey() == null || config.getAppKey().isBlank()) {
            throw failure(false, "channelNotReady");
        }
        String secret = configs.decryptSecret(config);
        if (secret == null || secret.isBlank()) throw failure(false, "channelNotReady");
        String base = resolveBase(config.getBaseUrl());
        try {
            JsonNode auth = exchange(base, "/auth/v3/tenant_access_token/internal", null,
                    Map.of("app_id", config.getAppKey(), "app_secret", secret));
            String token = auth.path("tenant_access_token").asText();
            if (token.isBlank()) throw failure(false, "invalidTokenResponse");
            String content = json.writeValueAsString(Map.of("zh_cn", Map.of(
                    "title", command.title(), "content", List.of(List.of(Map.of("tag", "md", "text", command.markdown()))))));
            exchange(base, "/im/v1/messages?receive_id_type=user_id", token,
                    Map.of("receive_id", command.externalUserId(), "msg_type", "post", "content", content));
        } catch (ImDeliveryException e) {
            throw e;
        } catch (IOException e) {
            throw failure(true, "transportFailure");
        }
    }

    private String resolveBase(String configured) {
        if (configured == null || configured.isBlank()) return defaultBaseUrl;
        return configured.endsWith("/") ? configured.substring(0, configured.length() - 1) : configured;
    }

    private JsonNode exchange(String base, String path, String token, Object body) throws IOException {
        Request.Builder request = new Request.Builder().url(base + path)
                .post(RequestBody.create(json.writeValueAsString(body), MediaType.get("application/json; charset=utf-8")));
        if (token != null) request.header("Authorization", "Bearer " + token);
        try (Response response = http.newCall(request.build()).execute()) {
            if (!response.isSuccessful()) throw failure(response.code() == 429 || response.code() >= 500, "http" + response.code());
            if (response.body() == null) throw failure(false, "emptyResponse");
            JsonNode result = json.readTree(response.body().string());
            if (result == null || !result.path("code").isIntegralNumber()) throw failure(false, "invalidResponse");
            int code = result.path("code").asInt();
            if (code != 0) throw failure(code == 99991400 || code == 230020, Integer.toString(code));
            return result;
        }
    }

    private ImDeliveryException failure(boolean retryable, String code) {
        // Provider responses can contain private data. Retain only the numeric/error category.
        return new ImDeliveryException(provider(), retryable, code, null, null);
    }
}

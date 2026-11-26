package com.aliyun.autowonder.prd;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import java.net.URI;
import java.util.*;
import java.util.regex.Pattern;

/** Preview policy and routing. No URL supplied by an executor is trusted. */
@Data
@Component
@ConfigurationProperties(prefix="autowonder.design-preview")
public class PrdReviewPreviewProperties {
    private static final Pattern AUTOMATIC_ID =
            Pattern.compile("auto-([1-9][0-9]{0,18})-([1-9][0-9]{0,18})-([1-9][0-9]{0,18})-([a-f0-9]{12})");
    private String platformOrigin="http://localhost:3000";
    private List<Binding> bindings=new ArrayList<>();
    private Cluster cluster = new Cluster();
    private PrdDesignRuntimeDao runtimeDao;

    @Autowired
    void usePlatformAddress(@Value("${autowonder.public-base-url:http://localhost:3000}") String publicUrl) {
        URI base = URI.create(publicUrl);
        boolean secure = "https".equals(base.getScheme())
                || "http".equals(base.getScheme()) && isLoopbackHost(base.getHost());
        platformOrigin = secure && base.getHost() != null && base.getRawUserInfo() == null
                ? base.getScheme() + "://" + base.getRawAuthority() : null;
    }

    @Autowired
    void setRuntimeDao(PrdDesignRuntimeDao runtimeDao) {
        this.runtimeDao = runtimeDao;
    }
    @javax.annotation.PostConstruct
    public void validate() {
        if (platformOrigin == null && bindings.isEmpty() && !cluster.isEnabled()) return;
        origin(platformOrigin);
        if (cluster.enabled) cluster.validate(origin(platformOrigin));
        var ids=new HashSet<String>(); var scopes=new HashSet<String>();
        for(var binding:bindings) {
            binding.validate(platformOrigin);
            if (binding.isAutomatic() || AUTOMATIC_ID.matcher(binding.getId()).matches()) {
                throw new IllegalArgumentException("Reserved design preview binding ID");
            }
            String scope=binding.workspaceId+":"+binding.conversationId+":"+binding.sourceKey;
            if(!ids.add(binding.id) || !scopes.add(scope)) throw new IllegalArgumentException("Duplicate design preview binding");
        }
    }
    @Data
    public static class Cluster {
        private boolean enabled;
        private String namespace;
        private String node;
        private Map<String, URI> peers = new LinkedHashMap<>();

        void validate(URI platform) {
            if (!identifier(namespace) || !nodeIdentifier(node) || peers.keySet().stream().noneMatch(id -> !node.equals(id))) {
                throw new IllegalArgumentException("Preview cluster requires an environment namespace, local node and peer origins");
            }
            var normalized = new LinkedHashMap<String, URI>();
            var origins = new HashSet<URI>();
            peers.forEach((id, peer) -> {
                if (!nodeIdentifier(id) || peer == null || peer.getHost() == null || peer.getRawUserInfo() != null
                        || peer.getRawQuery() != null || peer.getRawFragment() != null
                        || !Set.of("", "/").contains(peer.getRawPath())
                        || !Set.of("https", "http").contains(peer.getScheme())) {
                    throw new IllegalArgumentException("Invalid preview peer origin");
                }
                URI origin = URI.create(peer.getScheme() + "://" + peer.getRawAuthority());
                if (origin.equals(platform) || !origins.add(origin)) {
                    throw new IllegalArgumentException("Preview origins must address distinct instances directly");
                }
                if (!node.equals(id)) normalized.put(id, origin);
            });
            peers = normalized;
        }

        private static boolean identifier(String value) {
            return value != null && value.matches("[a-z0-9][a-z0-9-]{0,63}");
        }

        private static boolean nodeIdentifier(String value) {
            return value != null && value.length() <= 253
                    && value.matches("[a-z0-9][a-z0-9-]{0,63}(?:\\.[a-z0-9][a-z0-9-]{0,63})*");
        }
    }

    @Data
    public static class Binding {
        private String id;
        private long workspaceId;
        private long workitemId;
        private long conversationId;
        private long executorId;
        private String sourceKey;
        private String executorConfigPath;
        private String executorCliPath;
        private boolean automatic;
        public boolean matches(PrdDesignRuntimeDO row) {
            return row!=null && Objects.equals(row.getWorkspaceId(),workspaceId) && Objects.equals(row.getWorkitemId(),workitemId)
                    && Objects.equals(row.getConversationId(),conversationId) && Objects.equals(row.getExecutorId(),executorId)
                    && Objects.equals(row.getSourceKey(),sourceKey);
        }
        public void validate(String platformOrigin) {
            origin(platformOrigin);
            if(workspaceId<=0 || workitemId<=0 || conversationId<=0 || executorId<=0 || sourceKey==null || !sourceKey.matches("[A-Za-z0-9_-]{1,64}") || id==null || !id.matches("[A-Za-z0-9_-]{1,100}")
                    || !automatic && (executorConfigPath==null || !executorConfigPath.startsWith("/") || executorConfigPath.chars().anyMatch(Character::isISOControl))
                    || executorCliPath!=null && (!executorCliPath.startsWith("/") || executorCliPath.chars().anyMatch(Character::isISOControl))) throw new IllegalArgumentException("Invalid design preview binding");
        }
        public String basePath() { return "/design-preview/"+id+"/"; }
    }
    public static URI origin(String value) {
        URI uri=URI.create(Objects.requireNonNull(value));
        boolean loopback = isLoopbackHost(uri.getHost());
        if(uri.getHost()==null || uri.getRawUserInfo()!=null || uri.getRawQuery()!=null || uri.getRawFragment()!=null
                || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                || !("https".equals(uri.getScheme()) || (loopback && "http".equals(uri.getScheme())))) throw new IllegalArgumentException("Preview origins require HTTPS (loopback HTTP only for development)");
        return URI.create(uri.getScheme()+"://"+uri.getRawAuthority());
    }
    private static boolean isLoopbackHost(String host) {
        return host != null && (Set.of("localhost", "127.0.0.1", "[::1]").contains(host) || host.endsWith(".localhost"));
    }
    public Binding forRuntime(PrdDesignRuntimeDO runtime) {
        if(platformOrigin == null || runtime == null) return null;
        var found=bindings.stream().filter(b->b.matches(runtime)).toList();
        if(found.isEmpty()) return automaticBinding(runtime);
        if(found.size()!=1) return null;
        var binding=found.getFirst(); binding.validate(platformOrigin); return binding;
    }
    public Binding byId(String id) {
        if(platformOrigin == null || id==null) return null;
        var configured = bindings.stream().filter(b -> id.equals(b.id)).findFirst().orElse(null);
        if (configured != null || runtimeDao == null) return configured;
        var match = AUTOMATIC_ID.matcher(id);
        if (!match.matches()) return null;
        try {
            var runtime = runtimeDao.find(Long.parseLong(match.group(1)), Long.parseLong(match.group(2)));
            var binding = forRuntime(runtime);
            return binding != null && id.equals(binding.getId()) ? binding : null;
        } catch (NumberFormatException malformedId) {
            return null;
        }
    }
    public Binding forPath(String path) {
        String id = bindingIdFromPath(path);
        return id == null ? null : byId(id);
    }

    static String bindingIdFromPath(String path) {
        String prefix = "/design-preview/";
        if (path == null || !path.startsWith(prefix)) return null;
        int slash = path.indexOf('/', prefix.length());
        return slash <= prefix.length() ? null : path.substring(prefix.length(), slash);
    }

    private Binding automaticBinding(PrdDesignRuntimeDO runtime) {
        if (runtime.getExecutorId() == null
                || runtime.getWorkspaceId() == null || runtime.getWorkitemId() == null
                || runtime.getConversationId() == null || runtime.getSourceKey() == null) return null;
        var binding = new Binding();
        binding.setAutomatic(true);
        binding.setWorkspaceId(runtime.getWorkspaceId());
        binding.setWorkitemId(runtime.getWorkitemId());
        binding.setConversationId(runtime.getConversationId());
        binding.setExecutorId(runtime.getExecutorId());
        binding.setSourceKey(runtime.getSourceKey());
        binding.setId("auto-%d-%d-%d-%s".formatted(binding.getWorkspaceId(),
                binding.getConversationId(), binding.getExecutorId(), binding.getSourceKey()));
        if (!AUTOMATIC_ID.matcher(binding.getId()).matches()) return null;
        binding.validate(platformOrigin);
        return binding;
    }
}

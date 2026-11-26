package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.prd.PrdDesignHandoffDao.Review;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Component
class PrdDesignRepository {
    private static final Pattern REPOSITORY = Pattern.compile(
            "(?:git@([a-zA-Z0-9.-]+):|https://([a-zA-Z0-9.-]+)/)([a-zA-Z0-9_./-]+)");
    private static final Pattern DIGEST = Pattern.compile("[0-9a-f]{64}");
    private final Set<String> hosts;

    PrdDesignRepository(@Value("${autowonder.prd.git-hosts:github.com,gitlab.com}") String hosts) {
        this.hosts = Arrays.stream(hosts.split(",")).map(String::strip)
                .map(value -> value.toLowerCase(Locale.ROOT)).collect(Collectors.toUnmodifiableSet());
    }

    static String designBranch(long item, String sourceKey) {
        return "autowonder-design/" + item + "-" + sourceKey;
    }

    static String reviewBranch(Review review) {
        if (!DIGEST.matcher(review.getDesignDigest()).matches()) throw new IllegalArgumentException("Invalid design digest");
        return "autowonder-review/" + review.getWorkspaceId() + "/" + review.getWorkitemId()
                + "/" + review.getId() + "-" + review.getDesignDigest().substring(0, 16);
    }

    boolean supportsRepository(String url) {
        if (url == null) return false;
        var match = REPOSITORY.matcher(url);
        if (!match.matches()) return false;
        String host = match.group(1) == null ? match.group(2) : match.group(1);
        return hosts.contains(host.toLowerCase(Locale.ROOT));
    }
}

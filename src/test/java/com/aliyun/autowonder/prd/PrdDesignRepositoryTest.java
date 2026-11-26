package com.aliyun.autowonder.prd;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PrdDesignRepositoryTest {
    @Test
    void onlyAcceptsConfiguredGitHostsAndUrlsWithoutCredentials() {
        var repositories = new PrdDesignRepository("git.example.invalid");
        assertTrue(repositories.supportsRepository("git@git.example.invalid:team/design.git"));
        assertFalse(repositories.supportsRepository("https://token@git.example.invalid/team/design.git"));
        assertFalse(repositories.supportsRepository("https://git.example.invalid.evil/team/design.git"));
        assertFalse(repositories.supportsRepository("file:///tmp/design.git"));
    }
}

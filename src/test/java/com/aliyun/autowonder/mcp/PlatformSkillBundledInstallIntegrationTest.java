package com.aliyun.autowonder.mcp;

import com.aliyun.autowonder.access.WorkspaceAccessLevel;
import com.aliyun.autowonder.agent.AgentSkillDao;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.harness.HarnessToolService;
import com.aliyun.autowonder.skill.SkillDO;
import com.aliyun.autowonder.skill.SkillDao;
import com.aliyun.autowonder.skill.SkillPackageService;
import com.aliyun.autowonder.skill.SkillService;
import com.aliyun.autowonder.skill.dto.SkillVO;
import com.aliyun.autowonder.storage.InMemoryObjectStorage;
import com.aliyun.autowonder.storage.StoredObject;
import com.aliyun.autowonder.user.UserDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 官方内置包安装链路的真实服务集成测试：SkillService 与 SkillPackageService 使用真实实现，
 * 只有 DAO 与对象存储用替身，确保安装包类型校验真实参与，而不是被 mock 掩盖。
 */
class PlatformSkillBundledInstallIntegrationTest {

    private static final long WORKSPACE_ID = 100L;
    private static final long USER_ID = 7L;
    private static final String SKILL_MD = "---\nname: initialize-autowonder-workspace\n"
            + "description: AutoWonder 工作空间初始化\n---\n# AutoWonder 工作空间初始化\n";

    /** 记录上传次数，用于断言重复安装不会重新打包上传。 */
    static class CountingStorage extends InMemoryObjectStorage {
        private int puts;

        @Override
        public StoredObject put(String bucket, String key, byte[] data) {
            puts++;
            return super.put(bucket, key, data);
        }
    }

    private final Map<Long, SkillDO> rows = new LinkedHashMap<>();
    private SkillDao skillDao;
    private CountingStorage storage;
    private SkillPackageService skillPackageService;
    private McpToolService service;

    @BeforeEach
    void setUp() {
        skillDao = mock(SkillDao.class);
        var skillService = new SkillService(skillDao, mock(AgentSkillDao.class), mock(UserDao.class));
        var ossProperties = new com.aliyun.autowonder.storage.OssProperties();
        ossProperties.setSkillBucket("artifact-bucket");
        storage = new CountingStorage();
        skillPackageService = new SkillPackageService(skillDao, skillService, storage, ossProperties);

        doAnswer(invocation -> {
            SkillDO skill = invocation.getArgument(0);
            skill.setId(900L + rows.size());
            rows.put(skill.getId(), skill);
            return null;
        }).when(skillDao).insert(any(SkillDO.class));
        when(skillDao.findById(anyLong())).thenAnswer(invocation -> rows.get(invocation.<Long>getArgument(0)));
        when(skillDao.findByTypeAndName(anyLong(), anyString(), anyString())).thenAnswer(invocation -> {
            long tenantId = invocation.getArgument(0);
            String type = invocation.getArgument(1);
            String name = invocation.getArgument(2);
            return rows.values().stream()
                    .filter(row -> Long.valueOf(tenantId).equals(row.getTenantId()))
                    .filter(row -> type.equals(row.getType()) && name.equals(row.getName()))
                    .findFirst().orElse(null);
        });
        when(skillDao.list(anyLong(), anyString(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenAnswer(invocation -> {
                    long tenantId = invocation.getArgument(0);
                    String type = invocation.getArgument(1);
                    return new ArrayList<>(rows.values().stream()
                            .filter(row -> Long.valueOf(tenantId).equals(row.getTenantId()))
                            .filter(row -> type.equals(row.getType()))
                            .toList());
                });
        doAnswer(invocation -> {
            SkillDO row = rows.get(invocation.<Long>getArgument(0));
            if (row != null) {
                row.setType(invocation.getArgument(2));
                row.setInstallSpec(invocation.getArgument(3));
                row.setName(invocation.getArgument(4));
                row.setDescription(invocation.getArgument(5));
                row.setSourceType(invocation.getArgument(6));
                row.setPackageOssRef(invocation.getArgument(7));
                row.setPackageFileName(invocation.getArgument(8));
                row.setPackageSize(invocation.getArgument(9));
                row.setPackageMd5(invocation.getArgument(10));
            }
            return 1;
        }).when(skillDao).updatePackage(anyLong(), anyLong(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyLong(), anyString(), anyInt(), anyLong());

        var harness = mock(HarnessToolService.class);
        when(harness.onboardingSkillFiles()).thenReturn(Map.of("SKILL.md", SKILL_MD));
        var workspaceService = mock(com.aliyun.autowonder.workspace.WorkspaceService.class);
        when(workspaceService.activeAccessLevel(WORKSPACE_ID, USER_ID)).thenReturn(WorkspaceAccessLevel.ADMIN);
        var uploadTokenService = mock(WorkitemCliUploadTokenService.class);
        when(uploadTokenService.commandTemplate()).thenReturn("upload");
        when(uploadTokenService.tokenEnvHint()).thenReturn("export AUTOWONDER_UPLOAD_TOKEN=token");
        when(uploadTokenService.scheduledTaskCommandTemplate()).thenReturn("scheduled-task upload");
        var downloadTokenService = mock(WorkitemCliDownloadTokenService.class);
        when(downloadTokenService.commandTemplate()).thenReturn("download");

        service = new McpToolService(workspaceService,
                mock(com.aliyun.autowonder.workitem.WorkitemService.class),
                mock(com.aliyun.autowonder.guidance.GuidanceService.class),
                skillService, skillPackageService,
                mock(com.aliyun.autowonder.sdlc.SdlcService.class),
                mock(com.aliyun.autowonder.agent.AgentService.class),
                mock(com.aliyun.autowonder.statemachine.StatusTemplateService.class),
                new PlatformSkillCatalog(),
                mock(com.aliyun.autowonder.dispatch.DispatchDao.class),
                mock(com.aliyun.autowonder.artifact.RequirementDocumentService.class),
                uploadTokenService,
                downloadTokenService,
                mock(com.aliyun.autowonder.repo.RepoService.class),
                mock(com.aliyun.autowonder.squad.SquadService.class),
                mock(com.aliyun.autowonder.dispatch.DispatchPauseService.class),
                mock(com.aliyun.autowonder.category.CategoryService.class));
        ReflectionTestUtils.setField(service, "harnessToolService", harness);
    }

    private Object installPlatformSkill(String skillId) {
        var conversation = new McpAccessTokenService.Principal(WORKSPACE_ID, USER_ID, 88L,
                WorkspaceAccessLevel.ADMIN, McpAccessTokenService.CredentialType.CONVERSATION);
        return service.call(conversation, "autowonder.install_platform_skill",
                Map.of("workspaceId", WORKSPACE_ID, "skillId", skillId));
    }

    private Object installOnboardingSkill() {
        return installPlatformSkill(PlatformSkillCatalog.ONBOARDING_SKILL_ID);
    }

    /** 模拟空间内同类型技能超过 100 条：列表首页只返回无关记录，目标记录落在分页之外。 */
    private ArrayList<SkillDO> unrelatedFirstPage() {
        ArrayList<SkillDO> page = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            SkillDO other = new SkillDO();
            other.setId(10_000L + i);
            other.setTenantId(WORKSPACE_ID);
            other.setType("SKILL");
            other.setName("other-skill-" + i);
            other.setVersion(0);
            page.add(other);
        }
        return page;
    }

    @Test
    void bundledPlatformSkillInstallsWithCanonicalType() {
        SkillVO installed = (SkillVO) installOnboardingSkill();

        assertEquals("SKILL", installed.getType());
        assertEquals(1, rows.size());
        assertEquals("SKILL", rows.values().iterator().next().getType());
    }

    @Test
    void repeatedBundledInstallReusesInstalledRecord() {
        SkillVO first = (SkillVO) installOnboardingSkill();
        SkillVO second = (SkillVO) installOnboardingSkill();

        assertEquals(first.getId(), second.getId());
        assertEquals(1, rows.size());
        verify(skillDao, times(1)).insert(any(SkillDO.class));
    }

    @Test
    void repeatedBundledInstallReusesRecordBeyondListPageWithoutRepacking() {
        SkillVO first = (SkillVO) installOnboardingSkill();
        int putsAfterFirstInstall = storage.puts;
        when(skillDao.list(anyLong(), anyString(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenAnswer(invocation -> unrelatedFirstPage());

        SkillVO second = (SkillVO) installOnboardingSkill();

        assertEquals(first.getId(), second.getId());
        assertEquals(putsAfterFirstInstall, storage.puts, "重复安装不得重新上传安装包");
        assertEquals(1, rows.size());
        verify(skillDao, times(1)).insert(any(SkillDO.class));
    }

    @Test
    void plainInstallReusesRecordBeyondListPageSize() {
        SkillDO existing = new SkillDO();
        existing.setId(500L);
        existing.setTenantId(WORKSPACE_ID);
        existing.setType("SKILL");
        existing.setName("AutoWonder Workitem Operator");
        existing.setVersion(0);
        rows.put(existing.getId(), existing);
        when(skillDao.list(anyLong(), anyString(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenAnswer(invocation -> unrelatedFirstPage());

        SkillVO installed = (SkillVO) installPlatformSkill("autowonder-workitem-operator");

        assertEquals(500L, installed.getId());
        verify(skillDao, never()).insert(any(SkillDO.class));
        verify(skillDao, never()).list(anyLong(), anyString(), any(), anyBoolean(), anyInt(), anyInt());
    }

    @Test
    void packagedInstallStillRejectsLegacyCodexSkillType() {
        String encoded = Base64.getEncoder().encodeToString(SKILL_MD.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        byte[] archive = skillPackageService.packDirectory(Map.of("SKILL.md", encoded));

        BizException failure = assertThrows(BizException.class, () -> skillPackageService.uploadMcpPackage(
                "initialize-autowonder-workspace.zip", archive,
                PlatformSkillCatalog.LEGACY_PLATFORM_SKILL_TYPE, "AutoWonder 工作空间初始化", "desc",
                null, null, WORKSPACE_ID));

        assertEquals(ErrorCode.PARAM_INVALID.getCode(), failure.getCode());
    }
}

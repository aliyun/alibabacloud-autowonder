package com.aliyun.autowonder.prd;

import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

/** Renders the same version for the workbench, Git and the requirement attachment. */
final class PrdMarkdown {
    static String render(String json) {
        var data = PrdDesignCodec.parse(json);
        boolean en = "en-US".equals(data.getLanguage());
        var out = new StringBuilder("# ").append(inline(data.getTitle())).append("\n");
        section(out, en ? "Background" : "背景", data.getBackground());
        section(out, en ? "Goals" : "目标", data.getGoals());
        section(out, en ? "User roles" : "用户角色", bullets(data.getUserRoles()));
        section(out, en ? "In scope" : "需求范围", bullets(data.getInScope()));
        section(out, en ? "Out of scope" : "范围外", bullets(data.getNonGoals()));
        section(out, en ? "Entry points" : "功能入口", bullets(data.getFeatureEntries().stream()
                .map(entry -> join(entry.getLocation(), entry.getCapability())).toList()));
        section(out, en ? "User flows" : "用户流程", bullets(data.getUserFlows().stream()
                .map(step -> join(Integer.toString(step.getOrder()), step.getActor(), step.getAction())).toList()));
        for (var page : data.getPages()) {
            heading(out, 2, join(page.getName(), page.getRoute()));
            paragraph(out, page.getLayout());
            paragraph(out, bullets(page.getInteractions()));
            paragraph(out, bullets(java.util.stream.Stream.of(
                    state(en ? "Normal" : "正常", page.getNormalState()),
                    state(en ? "Loading" : "加载", page.getLoadingState()),
                    state(en ? "Empty" : "空态", page.getEmptyState()),
                    state(en ? "Error" : "错误", page.getErrorState()),
                    state(en ? "Forbidden" : "无权限", page.getForbiddenState())).filter(Objects::nonNull).toList()));
        }
        section(out, en ? "Data fields" : "数据字段", bullets(data.getDataFields().stream()
                .map(field -> join(field.getName(), field.getType(),
                        field.isRequired() ? (en ? "Required" : "必填") : null,
                        field.getValidation(), field.getDescription())).toList()));
        section(out, en ? "API dependencies" : "接口依赖", bullets(data.getInterfaces().stream()
                .map(api -> join(api.getName(), api.getMethod(), api.getPath(), api.getStatus(), api.getDescription())).toList()));
        section(out, en ? "Project integration" : "工程适配", data.getTargetProjectAdaptation());
        if (!data.getRequirements().isEmpty()) {
            heading(out, 2, en ? "Requirements and acceptance criteria" : "需求与验收标准");
            for (var requirement : data.getRequirements()) {
                heading(out, 3, join(requirement.getKey(), requirement.getTitle(), requirement.getPriority(),
                        requirement.isExcluded() ? (en ? "Excluded" : "已排除") : null));
                paragraph(out, requirement.getDescription());
                paragraph(out, bullets(requirement.getAcceptanceCriteria()));
            }
        }
        section(out, en ? "Questions" : "待确认问题", bullets(data.getOpenQuestions().stream()
                .map(question -> join(question.getKey(), question.getQuestion(),
                        question.isResolved() ? (en ? "Resolved" : "已解决")
                                : question.isBlocking() ? (en ? "Blocking" : "阻塞") : (en ? "Open" : "待确认"),
                        question.getResolution())).toList()));
        section(out, en ? "Risks" : "风险", bullets(data.getRisks()));
        section(out, en ? "Change history" : "变更记录", data.getChangeLog());
        return out.toString();
    }

    private static void section(StringBuilder out, String title, String body) {
        if (body == null || body.isBlank()) return;
        heading(out, 2, title);
        paragraph(out, body);
    }

    private static void heading(StringBuilder out, int level, String title) {
        out.append('\n').append("#".repeat(level)).append(' ').append(inline(title)).append('\n');
    }

    private static void paragraph(StringBuilder out, String text) {
        if (text != null && !text.isBlank()) out.append('\n').append(text.strip()).append('\n');
    }

    private static String bullets(List<String> values) {
        return values.stream().filter(value -> value != null && !value.isBlank())
                .map(value -> "- " + value.strip().replace("\r\n", "\n").replace("\n", "\n  "))
                .collect(Collectors.joining("\n"));
    }

    private static String inline(String value) {
        return value == null ? "" : value.replace('\r', ' ').replace('\n', ' ').strip();
    }

    private static String state(String label, String value) {
        return value == null || value.isBlank() ? null : join(label, value);
    }

    private static String join(String... parts) {
        return java.util.Arrays.stream(parts).filter(part -> part != null && !part.isBlank())
                .map(String::strip).collect(Collectors.joining(" · "));
    }

    private PrdMarkdown() {}
}

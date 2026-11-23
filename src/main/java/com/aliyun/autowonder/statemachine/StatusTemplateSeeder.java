package com.aliyun.autowonder.statemachine;

import com.aliyun.autowonder.common.i18n.SystemLabelKeys;
import org.springframework.stereotype.Component;

@Component
public class StatusTemplateSeeder {

    private final StatusTemplateDao templateDao;
    private final StatusNodeDao nodeDao;
    private final StatusTransitionDao transitionDao;

    public StatusTemplateSeeder(StatusTemplateDao templateDao, StatusNodeDao nodeDao,
                                StatusTransitionDao transitionDao) {
        this.templateDao = templateDao;
        this.nodeDao = nodeDao;
        this.transitionDao = transitionDao;
    }

    private record SeedNode(String code, String name, String category, String labelKey) {
    }

    /** 为新工作空间播种 REQ/TASK/BUG 三套默认状态模版(节点 + 流转边)。 */
    public void seed(long tenantId, long creatorId) {
        seedTemplate(tenantId, creatorId, "REQ", "需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ, new SeedNode[]{
                new SeedNode("new", "新建", "INIT", SystemLabelKeys.STATUS_NODE_REQ_NEW),
                new SeedNode("developing", "开发中", "IN_PROGRESS", SystemLabelKeys.STATUS_NODE_REQ_DEVELOPING),
                new SeedNode("verifying", "验证中", "IN_PROGRESS", SystemLabelKeys.STATUS_NODE_REQ_VERIFYING),
                new SeedNode("released", "已发布", "DONE", SystemLabelKeys.STATUS_NODE_REQ_RELEASED),
                new SeedNode("canceled", "已取消", "CANCELED", SystemLabelKeys.STATUS_NODE_REQ_CANCELED)}, true);
        seedTemplate(tenantId, creatorId, "TASK", "任务默认流程", SystemLabelKeys.STATUS_TEMPLATE_TASK, new SeedNode[]{
                new SeedNode("todo", "待办", "INIT", SystemLabelKeys.STATUS_NODE_TASK_TODO),
                new SeedNode("doing", "进行中", "IN_PROGRESS", SystemLabelKeys.STATUS_NODE_TASK_DOING),
                new SeedNode("done", "已完成", "DONE", SystemLabelKeys.STATUS_NODE_TASK_DONE)}, false);
        seedTemplate(tenantId, creatorId, "BUG", "缺陷默认流程", SystemLabelKeys.STATUS_TEMPLATE_BUG, new SeedNode[]{
                new SeedNode("open", "待修复", "INIT", SystemLabelKeys.STATUS_NODE_BUG_OPEN),
                new SeedNode("fixing", "修复中", "IN_PROGRESS", SystemLabelKeys.STATUS_NODE_BUG_FIXING),
                new SeedNode("verifying", "验证中", "IN_PROGRESS", SystemLabelKeys.STATUS_NODE_BUG_VERIFYING),
                new SeedNode("closed", "已关闭", "DONE", SystemLabelKeys.STATUS_NODE_BUG_CLOSED)}, false);
    }

    private void seedTemplate(long tenantId, long creatorId, String workType, String name,
                              String templateLabelKey, SeedNode[] nodes, boolean withCancel) {
        StatusTemplateDO tpl = new StatusTemplateDO();
        tpl.setTenantId(tenantId);
        tpl.setWorkType(workType);
        tpl.setName(name);
        tpl.setSystemLabelKey(templateLabelKey);
        tpl.setIsDefault(1);
        tpl.setCreatorId(creatorId);
        templateDao.insert(tpl);
        long templateId = tpl.getId();

        long[] nodeIds = new long[nodes.length];
        Long cancelNodeId = null;
        for (int i = 0; i < nodes.length; i++) {
            StatusNodeDO node = new StatusNodeDO();
            node.setTenantId(tenantId);
            node.setTemplateId(templateId);
            node.setCode(nodes[i].code());
            node.setName(nodes[i].name());
            node.setSystemLabelKey(nodes[i].labelKey());
            node.setCategory(nodes[i].category());
            node.setSort(i);
            nodeDao.insert(node);
            long nodeId = node.getId();
            nodeIds[i] = nodeId;
            if ("CANCELED".equals(nodes[i].category())) {
                cancelNodeId = nodeId;
            }
        }
        // 线性正向流转:相邻非取消节点
        Integer prevIdx = null;
        for (int i = 0; i < nodes.length; i++) {
            if ("CANCELED".equals(nodes[i].category())) continue;
            if (prevIdx != null) {
                insertTransition(tenantId, templateId, nodeIds[prevIdx], nodeIds[i],
                        "前进", SystemLabelKeys.STATUS_TRANSITION_FORWARD);
            }
            prevIdx = i;
        }
        // 任意非终态 → canceled
        if (withCancel && cancelNodeId != null) {
            for (int i = 0; i < nodes.length; i++) {
                String cat = nodes[i].category();
                if ("INIT".equals(cat) || "IN_PROGRESS".equals(cat)) {
                    insertTransition(tenantId, templateId, nodeIds[i], cancelNodeId,
                            "取消", SystemLabelKeys.STATUS_TRANSITION_CANCEL);
                }
            }
        }
    }

    private void insertTransition(long tenantId, long templateId, long fromNodeId, long toNodeId,
                                  String name, String labelKey) {
        StatusTransitionDO tr = new StatusTransitionDO();
        tr.setTenantId(tenantId);
        tr.setTemplateId(templateId);
        tr.setFromNodeId(fromNodeId);
        tr.setToNodeId(toNodeId);
        tr.setName(name);
        tr.setSystemLabelKey(labelKey);
        transitionDao.insert(tr);
    }
}

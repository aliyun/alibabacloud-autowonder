package com.aliyun.autowonder.statemachine;

import com.aliyun.autowonder.common.i18n.SystemLabelKeys;
import com.aliyun.autowonder.statemachine.dto.TemplateDetailVO;
import com.aliyun.autowonder.statemachine.dto.TemplateVO;
import com.aliyun.autowonder.statemachine.dto.CreateNodeRequest;
import com.aliyun.autowonder.statemachine.dto.CreateTransitionRequest;
import com.aliyun.autowonder.statemachine.dto.UpdateNodeRequest;
import com.aliyun.autowonder.statemachine.dto.UpdateTemplateRequest;
import com.aliyun.autowonder.statemachine.dto.UpdateTransitionRequest;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StatusTemplateServiceTest {

    private final StatusTemplateDao templateDao = mock(StatusTemplateDao.class);
    private final StatusNodeDao nodeDao = mock(StatusNodeDao.class);
    private final StatusTransitionDao transitionDao = mock(StatusTransitionDao.class);
    private final StatusTemplateService service = new StatusTemplateService(templateDao, nodeDao, transitionDao);

    private static UpdateTemplateRequest templateUpdate(String name, Boolean isDefault) {
        UpdateTemplateRequest req = new UpdateTemplateRequest();
        req.setName(name);
        req.setIsDefault(isDefault);
        return req;
    }

    private static UpdateNodeRequest nodeUpdate(String code, String name, String category, Integer sort) {
        UpdateNodeRequest req = new UpdateNodeRequest();
        req.setCode(code);
        req.setName(name);
        req.setCategory(category);
        req.setSort(sort);
        return req;
    }

    private static CreateNodeRequest newNode(String code, String name, String category, Integer sort) {
        CreateNodeRequest req = new CreateNodeRequest();
        req.setCode(code);
        req.setName(name);
        req.setCategory(category);
        req.setSort(sort);
        return req;
    }

    private static UpdateTransitionRequest transitionUpdate(Long fromNodeId, Long toNodeId, String name) {
        UpdateTransitionRequest req = new UpdateTransitionRequest();
        req.setFromNodeId(fromNodeId);
        req.setToNodeId(toNodeId);
        req.setName(name);
        return req;
    }

    private static CreateTransitionRequest newTransition(Long fromNodeId, Long toNodeId, String name) {
        CreateTransitionRequest req = new CreateTransitionRequest();
        req.setFromNodeId(fromNodeId);
        req.setToNodeId(toNodeId);
        req.setName(name);
        return req;
    }

    private static com.aliyun.autowonder.statemachine.dto.CreateTemplateRequest newTemplate(String workType, String name) {
        com.aliyun.autowonder.statemachine.dto.CreateTemplateRequest req =
                new com.aliyun.autowonder.statemachine.dto.CreateTemplateRequest();
        req.setWorkType(workType);
        req.setName(name);
        return req;
    }

    private static StatusTemplateDO template(String name, String labelKey) {
        StatusTemplateDO t = new StatusTemplateDO();
        t.setId(1L);
        t.setTenantId(9L);
        t.setWorkType("REQ");
        t.setName(name);
        t.setSystemLabelKey(labelKey);
        t.setIsDefault(1);
        t.setVersion(2);
        return t;
    }

    private static StatusNodeDO node(String code, String name, String labelKey) {
        StatusNodeDO n = new StatusNodeDO();
        n.setId(11L);
        n.setTenantId(9L);
        n.setTemplateId(1L);
        n.setCode(code);
        n.setName(name);
        n.setSystemLabelKey(labelKey);
        n.setCategory("IN_PROGRESS");
        n.setSort(1);
        return n;
    }

    private static StatusTransitionDO transition(String name, String labelKey) {
        StatusTransitionDO tr = new StatusTransitionDO();
        tr.setId(21L);
        tr.setTenantId(9L);
        tr.setTemplateId(1L);
        tr.setFromNodeId(11L);
        tr.setToNodeId(12L);
        tr.setName(name);
        tr.setSystemLabelKey(labelKey);
        return tr;
    }

    @Test
    void detailExposesSystemLabelKeysWithOriginalNames() {
        when(templateDao.findById(1L)).thenReturn(template("需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ));
        when(nodeDao.listByTemplateId(1L)).thenReturn(List.of(node("new", "新建", SystemLabelKeys.STATUS_NODE_REQ_NEW)));
        when(transitionDao.listByTemplateId(1L)).thenReturn(List.of(transition("前进", SystemLabelKeys.STATUS_TRANSITION_FORWARD)));

        TemplateDetailVO detail = service.getTemplateDetail(1L);

        assertEquals("需求默认流程", detail.getName());
        assertEquals(SystemLabelKeys.STATUS_TEMPLATE_REQ, detail.getSystemLabelKey());
        assertEquals("新建", detail.getNodes().get(0).getName());
        assertEquals(SystemLabelKeys.STATUS_NODE_REQ_NEW, detail.getNodes().get(0).getSystemLabelKey());
        assertEquals("前进", detail.getTransitions().get(0).getName());
        assertEquals(SystemLabelKeys.STATUS_TRANSITION_FORWARD, detail.getTransitions().get(0).getSystemLabelKey());
    }

    @Test
    void renamingTemplateClearsSystemLabelKey() {
        when(templateDao.update(1L, 9L, "自定义流程", null, 1, 2, 7L)).thenReturn(1);
        when(templateDao.findById(1L))
                .thenReturn(template("需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ))
                .thenReturn(template("自定义流程", null));

        TemplateVO result = service.updateTemplate(1L, templateUpdate("自定义流程", null), 9L, 7L);

        assertNull(result.getSystemLabelKey());
        verify(templateDao).update(1L, 9L, "自定义流程", null, 1, 2, 7L);
    }

    @Test
    void unchangedTemplateNameKeepsSystemLabelKey() {
        when(templateDao.findById(1L)).thenReturn(template("需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ));
        when(templateDao.update(1L, 9L, "需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ, 1, 2, 7L)).thenReturn(1);

        service.updateTemplate(1L, templateUpdate("需求默认流程", null), 9L, 7L);

        verify(templateDao).update(1L, 9L, "需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ, 1, 2, 7L);
    }

    @Test
    void renamingNodeClearsSystemLabelKey() {
        StatusNodeDO existing = node("new", "新建", SystemLabelKeys.STATUS_NODE_REQ_NEW);
        when(nodeDao.findById(11L)).thenReturn(existing);

        service.updateNode(11L, nodeUpdate(null, "新名称", null, null));

        verify(nodeDao).update(11L, "new", "新名称", null, "IN_PROGRESS", 1);
    }

    @Test
    void changingNodeCodeClearsSystemLabelKey() {
        when(nodeDao.findById(11L)).thenReturn(node("new", "新建", SystemLabelKeys.STATUS_NODE_REQ_NEW));
        when(nodeDao.findByTemplateAndCode(1L, "renamed")).thenReturn(null);

        service.updateNode(11L, nodeUpdate("renamed", null, null, null));

        verify(nodeDao).update(11L, "renamed", "新建", null, "IN_PROGRESS", 1);
    }

    @Test
    void nodeStructureEditKeepsSystemLabelKey() {
        when(nodeDao.findById(11L)).thenReturn(node("new", "新建", SystemLabelKeys.STATUS_NODE_REQ_NEW));

        service.updateNode(11L, nodeUpdate(null, null, "DONE", 4));

        verify(nodeDao).update(11L, "new", "新建", SystemLabelKeys.STATUS_NODE_REQ_NEW, "DONE", 4);
    }

    @Test
    void userCreatedNodeHasNoSystemLabelKey() {
        when(templateDao.findById(1L)).thenReturn(template("自定义流程", null));
        when(nodeDao.findByTemplateAndCode(1L, "custom")).thenReturn(null);

        service.createNode(1L, newNode("custom", "自定义节点", "IN_PROGRESS", 3), 9L);

        ArgumentCaptor<StatusNodeDO> captor = ArgumentCaptor.forClass(StatusNodeDO.class);
        verify(nodeDao).insert(captor.capture());
        assertNull(captor.getValue().getSystemLabelKey());
        assertEquals("custom", captor.getValue().getCode());
    }

    @Test
    void renamingTransitionClearsSystemLabelKey() {
        when(transitionDao.findById(21L)).thenReturn(transition("前进", SystemLabelKeys.STATUS_TRANSITION_FORWARD));

        service.updateTransition(21L, transitionUpdate(null, null, "推进"));

        verify(transitionDao).update(21L, 11L, 12L, "推进", null);
    }

    @Test
    void transitionEndpointChangeKeepsSystemLabelKey() {
        when(transitionDao.findById(21L)).thenReturn(transition("前进", SystemLabelKeys.STATUS_TRANSITION_FORWARD));

        service.updateTransition(21L, transitionUpdate(13L, 14L, null));

        verify(transitionDao).update(21L, 13L, 14L, "前进", SystemLabelKeys.STATUS_TRANSITION_FORWARD);
    }

    @Test
    void listTemplatesCarriesSystemLabelKeys() {
        when(templateDao.listByWorkType(9L, "REQ"))
                .thenReturn(List.of(template("需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ)));

        List<TemplateVO> templates = service.listTemplates(9L, "REQ");

        assertEquals(1, templates.size());
        assertEquals(SystemLabelKeys.STATUS_TEMPLATE_REQ, templates.get(0).getSystemLabelKey());
    }

    @Test
    void userCreatedTransitionHasNoSystemLabelKey() {
        when(templateDao.findById(1L)).thenReturn(template("需求默认流程", SystemLabelKeys.STATUS_TEMPLATE_REQ));
        when(transitionDao.findByTemplateFromTo(1L, 11L, 12L)).thenReturn(null);

        service.createTransition(1L, newTransition(11L, 12L, "自定义流转"), 9L);

        ArgumentCaptor<StatusTransitionDO> captor = ArgumentCaptor.forClass(StatusTransitionDO.class);
        verify(transitionDao).insert(captor.capture());
        assertNull(captor.getValue().getSystemLabelKey());
    }

    @Test
    void createTemplateHasNoSystemLabelKey() {
        service.createTemplate(newTemplate("REQ", "自定义"), 9L, 7L);

        ArgumentCaptor<StatusTemplateDO> captor = ArgumentCaptor.forClass(StatusTemplateDO.class);
        verify(templateDao).insert(captor.capture());
        assertNull(captor.getValue().getSystemLabelKey());
    }
}

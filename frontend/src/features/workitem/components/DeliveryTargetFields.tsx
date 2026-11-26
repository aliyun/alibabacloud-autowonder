import { useEffect, useRef } from 'react';
import { Form, Select, Space } from 'antd';
import type { FormInstance } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { designEmployeeTag, DesignEmployeeTag } from '@/features/agent/designSdlc';
import { getSquadMembers, listAllSquads, listSquads } from '@/features/squad/api';
import type { SquadMember } from '@/features/squad/api';
import './createFields.css';

interface DeliveryTargetFieldsProps {
  form: FormInstance;
  /** 交付弹窗必须选择小队与数字员工；工作台默认创建允许留空表示暂不指派。 */
  required: boolean;
  conversation?: boolean;
  design?: boolean;
  disabled?: boolean;
}

/** 小队/数字员工选择联动，交付弹窗与工作台创建表单共用同一查询与校验来源。 */
export function DeliveryTargetFields({ form, required, conversation = false, design = false, disabled = false }: DeliveryTargetFieldsProps) {
  const { t } = useTranslation('workitem');
  const client = useQueryClient();
  const manualSquad = useRef<number>();
  const squadId = Form.useWatch('squadId', form);
  const { data: deliverySquads } = useQuery({
    queryKey: ['squads', 'delivery-start'],
    queryFn: () => listSquads({ pageNum: 1, pageSize: 100 }),
    enabled: !design,
  });
  const designSquads = useQuery({
    queryKey: ['squads', 'design-launch'],
    queryFn: () => listAllSquads(),
    enabled: design,
  });
  const defaults = useQuery({
    queryKey: ['design-launch-employee', designSquads.data?.map(squad => squad.id)],
    enabled: design && !!designSquads.data?.length && !squadId,
    queryFn: async () => {
      for (const squad of designSquads.data ?? []) {
        if (!squad.memberCount) continue;
        const members = await client.fetchQuery({
          queryKey: ['squad-members', squad.id],
          queryFn: () => getSquadMembers(squad.id),
          staleTime: 30_000,
        });
        const employee = members.find(designEmployeeTag);
        if (employee) return { squadId: squad.id, agentId: employee.agentId };
      }
      return null;
    },
  });
  const { data: members, isFetching: membersLoading } = useQuery({
    queryKey: ['squad-members', squadId],
    queryFn: () => getSquadMembers(squadId),
    enabled: !!squadId,
  });
  useEffect(() => {
    if (design && defaults.data && !form.getFieldValue('squadId')) form.setFieldsValue(defaults.data);
  }, [defaults.data, design, form]);
  useEffect(() => {
    if (!design || !squadId || manualSquad.current !== squadId || !members) return;
    manualSquad.current = undefined;
    if (!form.getFieldValue('agentId')) {
      form.setFieldValue('agentId', members.find(designEmployeeTag)?.agentId);
    }
  }, [design, form, members, squadId]);

  const squads = design ? designSquads.data : deliverySquads?.list;
  const memberOptions = (members ?? [])
    .filter((member: SquadMember) => conversation || member.agentKind !== 'PLATFORM')
    .map((member: SquadMember) => ({
      value: member.agentId,
      label: conversation
        ? t('clarification.agentOption', {
            name: member.agentName,
            status: t(member.executorOnline ? 'clarification.executorOnline' : 'clarification.executorOffline'),
          })
        : member.roleCode
          ? t('start.memberLabel', { name: member.agentName, role: member.roleCode })
          : member.agentName,
      designTag: designEmployeeTag(member),
    }));
  const renderMember = (label: React.ReactNode, tag: ReturnType<typeof designEmployeeTag>) => tag
    ? <span className="aw-design-employee"><span>{label}</span><DesignEmployeeTag tag={tag} /></span>
    : label;

  const FieldGroup = design ? Space.Compact : 'div';
  return (
    <>
      <FieldGroup className={design ? 'aw-launch-team' : required ? undefined : 'aw-delivery-row'}>
        <Form.Item
          name="squadId"
          label={required ? t('start.squad') : (
            <>{t('create.deliverySquad')}<span className="aw-optional-tag">{t('create.optional')}</span></>
          )}
          rules={required ? [{ required: true, message: t('start.squadRequired') }] : undefined}
        >
          <Select
            showSearch
            optionFilterProp="label"
            disabled={disabled}
            placeholder={t(conversation ? 'clarification.selectSquad' : 'start.squadPlaceholder')}
            allowClear={!required}
            loading={design && (designSquads.isFetching || defaults.isFetching)}
            options={(squads ?? []).map((s) => ({ value: s.id, label: s.name }))}
            onChange={value => { manualSquad.current = value; form.setFieldValue('agentId', undefined); }}
          />
        </Form.Item>
        <Form.Item
          name="agentId"
          label={required ? t(conversation ? 'clarification.agent' : 'start.agent') : (
            <>{t('create.deliveryAgent')}<span className="aw-optional-tag">{t('create.optional')}</span></>
          )}
          rules={required ? [{ required: true, message: t('start.agentRequired') }] : undefined}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={squadId ? t('start.memberPlaceholder') : t('start.chooseSquadFirst')}
            disabled={disabled || !squadId}
            allowClear={!required}
            loading={membersLoading}
            options={memberOptions}
            optionRender={design ? option => renderMember(option.label, option.data.designTag) : undefined}
            labelRender={design ? option => renderMember(option.label,
              memberOptions.find(member => member.value === option.value)?.designTag) : undefined}
          />
        </Form.Item>
      </FieldGroup>
      {design && !squadId && (defaults.data === null || designSquads.data?.length === 0)
        && <div className="aw-delivery-hint" role="status">{t('launch.noDesignEmployee')}</div>}
      {!required && <div className="aw-delivery-hint">{t('create.deliveryOptionalHint')}</div>}
    </>
  );
}

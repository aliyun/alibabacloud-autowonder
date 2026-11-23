import { Form, Select } from 'antd';
import type { FormInstance } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getSquadMembers, listSquads } from '@/features/squad/api';
import type { SquadMember } from '@/features/squad/api';

interface DeliveryTargetFieldsProps {
  form: FormInstance;
  /** 交付弹窗必须选择小队与数字员工；工作台默认创建允许留空表示暂不指派。 */
  required: boolean;
}

/** 小队/数字员工选择联动，交付弹窗与工作台创建表单共用同一查询与校验来源。 */
export function DeliveryTargetFields({ form, required }: DeliveryTargetFieldsProps) {
  const { t } = useTranslation('workitem');
  const squadId = Form.useWatch('squadId', form);
  const { data: squads } = useQuery({
    queryKey: ['squads', 'delivery-start'],
    queryFn: () => listSquads({ pageNum: 1, pageSize: 100 }),
  });
  const { data: members = [], isFetching: membersLoading } = useQuery({
    queryKey: ['squad-members', squadId],
    queryFn: () => getSquadMembers(squadId),
    enabled: !!squadId,
  });

  return (
    <>
      <Form.Item
        name="squadId"
        label={t('start.squad')}
        rules={required ? [{ required: true, message: t('start.squadRequired') }] : undefined}
      >
        <Select
          placeholder={t('start.squadPlaceholder')}
          allowClear={!required}
          options={(squads?.list || []).map((s) => ({ value: s.id, label: s.name }))}
          onChange={() => form.setFieldValue('agentId', undefined)}
        />
      </Form.Item>
      <Form.Item
        name="agentId"
        label={t('start.agent')}
        rules={required ? [{ required: true, message: t('start.agentRequired') }] : undefined}
      >
        <Select
          placeholder={squadId ? t('start.memberPlaceholder') : t('start.chooseSquadFirst')}
          disabled={!squadId}
          allowClear={!required}
          loading={membersLoading}
          options={members
            .filter((member: SquadMember) => member.agentKind !== 'PLATFORM')
            .map((member: SquadMember) => ({
              value: member.agentId,
              label: member.roleCode
                ? t('start.memberLabel', { name: member.agentName, role: member.roleCode })
                : member.agentName,
            }))}
        />
      </Form.Item>
    </>
  );
}

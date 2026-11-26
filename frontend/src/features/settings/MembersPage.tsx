import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/shared/i18n/format';
import { PageHead } from '@/shared/ui/PageHead';
import { TableFooter } from '@/shared/ui/TableCard';
import { Toolbar } from '@/shared/ui/Toolbar';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { TimeCell } from '@/shared/ui/TimeCell';
import { humanAvatarColor } from '@/shared/ui/AiIdentity';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Avatar,
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tooltip} from 'antd';
import { CloseCircleFilled } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Table } from '@/shared/theme/ThemedTable';
import type { ColumnsType } from 'antd/es/table';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import {
  useAddMember,
  useCurrentMembership,
  useMembers,
  useRemoveMember,
  useTransferOwner,
  useUpdateMemberRole,
  useWorkspaceRoles,
  useUpdateMemberIdentityTags,
} from './hooks';
import { AccessRequestsPanel } from './AccessRequestsPanel';
import { workspaceRoleLabel } from './roles';
import { WorkspaceRolesPanel } from './WorkspaceRolesPanel';
import { AddMemberModal } from './AddMemberModal';
import { MemberAccessModal } from './MemberAccessModal';
import { OwnerTransferModal } from './OwnerTransferModal';
import type { MemberVO } from './api';

export const DEFAULT_MEMBERS_TAB = 'members';
const MEMBERS_TAB_KEYS: readonly string[] = [DEFAULT_MEMBERS_TAB, 'roles', 'requests'];

const ROLE_TAG_COLOR: Record<string, StatusColorKey> = {
  ADMIN: 'green',
  READ_WRITE: 'plain',
  READ_ONLY: 'gray',
};

const MISSING = '-';

/** Whitelisted so an unknown `tab` value keeps the historical default instead of blanking the pane. */
export function resolveMembersTab(tabParam: string | null): string {
  return tabParam !== null && MEMBERS_TAB_KEYS.includes(tabParam)
    ? tabParam
    : DEFAULT_MEMBERS_TAB;
}

export function MembersPage() {
  useTranslation('shared');
  const { t } = useTranslation('settings');
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveMembersTab(searchParams.get('tab'));
  const accessCommand = useAccessCommand();
  const { data: members = [], isLoading } = useMembers();
  const { data: roles = [] } = useWorkspaceRoles();
  const { data: membership } = useCurrentMembership();
  const isAdmin = membership?.accessLevel === 'ADMIN';
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const addMemberMutation = useAddMember();
  const removeMemberMutation = useRemoveMember();
  const updateRoleMutation = useUpdateMemberRole();
  const updateTagsMutation = useUpdateMemberIdentityTags();
  const transferOwnerMutation = useTransferOwner();

  const [roleFilter, setRoleFilter] = useState<number | 'ALL'>('ALL');
  const [memberKeyword, setMemberKeyword] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [memberPageSize, setMemberPageSize] = usePageSizePreference(
    'autowonder.members.pageSize', [10, 20, 50, 100], 10);
  const [editTarget, setEditTarget] = useState<MemberVO | null>(null);
  const [removeConfirmUserId, setRemoveConfirmUserId] = useState<number>();
  const [ownerTransferOpen, setOwnerTransferOpen] = useState(false);

  const adminOnlyTip = (control: ReactNode) => {
    if (isAdmin) {
      return <>{control}</>;
    }
    return (
      <Tooltip title={t('adminOnly')}>
        {/* antd Tooltip 对 disabled 控件不触发鼠标事件，须用 span 包裹 */}
        <span>{control}</span>
      </Tooltip>
    );
  };

  const normalizedKeyword = memberKeyword.trim().toLowerCase();
  const isSearching = normalizedKeyword.length > 0;
  const filteredMembers = members.filter((member) => {
    if (roleFilter !== 'ALL' && member.roleId !== roleFilter) return false;
    if (!normalizedKeyword) return true;
    return [member.nickname, member.username, member.email].some(
      (value) => Boolean(value) && value.toLowerCase().includes(normalizedKeyword),
    );
  });

  const handleAddMember = (userId: number, roleId?: number) => {
    accessCommand('ADMIN', t('addMember'), () => {
      addMemberMutation.mutate({ userId, roleId }, {
        onSuccess: () => setAddMemberOpen(false),
      });
    });
  };

  const handleEditConfirm = async (values: {
    roleId: number;
    identityTags: string[];
  }) => {
    if (!editTarget) return;
    await accessCommand('ADMIN', t('editMember'), async () => {
      const tagsChanged =
        JSON.stringify(values.identityTags) !== JSON.stringify(editTarget.identityTags);
      try {
        if (values.roleId !== editTarget.roleId) {
          await updateRoleMutation.mutateAsync({ userId: editTarget.userId, roleId: values.roleId });
        }
        if (tagsChanged) {
          await updateTagsMutation.mutateAsync({
            userId: editTarget.userId,
            identityTags: values.identityTags,
          });
        }
        setEditTarget(null);
      } catch {
        // Mutation hooks preserve the backend error message and keep the editor open.
      }
    });
  };

  const handleTransferOwner = async (targetUserId: number) => {
    await accessCommand('ADMIN', t('transferOwner'), async () => {
      try {
        await transferOwnerMutation.mutateAsync(targetUserId);
        setOwnerTransferOpen(false);
      } catch {
        // Mutation hook reports the backend error and keeps the explicit selection.
      }
    });
  };

  const columns: ColumnsType<MemberVO> = [
    {
      title: t('user'),
      key: 'user',
      render: (_, member) => {
        const displayName = member.nickname || member.username;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar
              aria-hidden="true"
              size={20}
              style={{ backgroundColor: humanAvatarColor(displayName), flexShrink: 0, fontSize: 11 }}
            >
              {displayName.slice(0, 1)}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{displayName}</span>
                {member.owner && (
                  <Tooltip title={t('workspaceOwner')}>
                    <span
                      aria-label={t('workspaceOwner')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: 'var(--aw-warning-deep)',
                        cursor: 'default',
                      }}
                    >
                      <AwStrokeIcon name="crown" size={12} />
                    </span>
                  </Tooltip>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--aw-text-3)' }}>{member.email || MISSING}</div>
            </div>
          </div>
        );
      },
    },
    {
      title: t('role'),
      key: 'role',
      width: 110,
      render: (_, member) => (
        <StatusTag
          size="sm"
          label={workspaceRoleLabel({ id: member.roleId, code: member.roleCode, name: member.roleName })}
          colorKey={ROLE_TAG_COLOR[member.accessLevel] ?? 'plain'}
          dot={member.accessLevel === 'ADMIN'}
        />
      ),
    },
    {
      title: t('tags'),
      dataIndex: 'identityTags',
      width: 220,
      render: (tags: string[]) => (
        <Space size={4} wrap>
          {tags.length
            ? tags.map((tag) => <StatusTag key={tag} size="sm" label={tag} colorKey="gray" />)
            : <span style={{ color: 'var(--aw-text-3)' }}>{MISSING}</span>}
        </Space>
      ),
    },
    {
      title: t('joinedAt'),
      dataIndex: 'joinedAt',
      width: 150,
      render: (value: string) => <TimeCell value={value} />,
    },
    {
      title: t('actions'),
      key: 'action',
      width: 104,
      render: (_, member) => (
        <Space size={6}>
          {adminOnlyTip(
            <Button
              type="text"
              size="small"
              className="aw-op-btn"
              title={t('editMember')}
              aria-label={t('editMember')}
              disabled={!isAdmin}
              icon={<AwStrokeIcon name="edit" />}
              onClick={() => accessCommand('ADMIN', t('editMember'), () => setEditTarget(member))}
            />,
          )}
          {!member.owner && adminOnlyTip(
            <Popconfirm
              title={t('removeConfirm')}
              open={removeConfirmUserId === member.userId}
              onOpenChange={(open) => {
                if (!open) {
                  setRemoveConfirmUserId(undefined);
                  return;
                }
                accessCommand('ADMIN', t('removeMember'), () => setRemoveConfirmUserId(member.userId));
              }}
              onConfirm={() => accessCommand('ADMIN', t('removeMember'), () =>
                removeMemberMutation.mutate(member.userId, {
                  onSettled: () => setRemoveConfirmUserId(undefined),
                }))}
            >
              <Button
                type="text"
                size="small"
                className="aw-op-btn aw-op-btn--del"
                title={t('removeMember')}
                aria-label={t('removeMember')}
                disabled={!isAdmin}
                icon={<AwStrokeIcon name="trash" />}
              />
            </Popconfirm>,
          )}
        </Space>
      ),
    },
  ];

  const pagedMembers = filteredMembers.slice(
    (memberPage - 1) * memberPageSize,
    memberPage * memberPageSize,
  );

  const noMatchEmpty = isSearching ? (
    <EmptyState
      icon={<AwStrokeIcon name="search" size={20} />}
      title={t('noMatchingMembers')}
      subtext={t('noMatchingMembersHint')}
      action={(
        <Button
          onClick={() => {
            setMemberKeyword('');
            setMemberPage(1);
          }}
        >
          {t('clearSearch')}
        </Button>
      )}
    />
  ) : undefined;

  const membersPane = (
    <>
      <Toolbar
        left={(
          <>
            <Input
              aria-label={t('searchMembers')}
              placeholder={t('searchMembersPlaceholder')}
              prefix={<AwStrokeIcon name="search" />}
              allowClear={{ clearIcon: <CloseCircleFilled aria-label={t('clearSearch')} /> }}
              style={{ width: 260, maxWidth: '100%' }}
              value={memberKeyword}
              onChange={(event) => {
                setMemberKeyword(event.target.value);
                setMemberPage(1);
              }}
            />
            <Select
              aria-label={t('filterRole')} style={{ width: 180 }}
              options={[
                { label: t('allMembers', { count: members.length, total: formatNumber(members.length) }), value: 'ALL' as const },
                ...roles.map((role) => ({ label: workspaceRoleLabel(role), value: role.id })),
              ]}
              value={roleFilter}
              onChange={(value) => { setRoleFilter(value); setMemberPage(1); }}
            />
          </>
        )}
        right={adminOnlyTip(
          <Button
            type="primary"
            icon={<AwStrokeIcon name="plus" />}
            aria-label={t('addMember')}
            disabled={!isAdmin}
            onClick={() => accessCommand('ADMIN', t('addMember'), () => setAddMemberOpen(true))}
          >
            {t('addMember')}
          </Button>,
        )}
      />
      <Table
        rowKey="userId"
        columns={columns}
        dataSource={pagedMembers}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 880 }}
        locale={noMatchEmpty ? { emptyText: noMatchEmpty } : undefined}
      />
      <TableFooter
        total={filteredMembers.length}
        page={memberPage}
        pageSize={memberPageSize}
        totalText={t('totalMembers', { count: filteredMembers.length, total: formatNumber(filteredMembers.length) })}
        onPageChange={(nextPage, nextSize) => {
          setMemberPage(nextPage);
          if (nextSize !== memberPageSize) setMemberPageSize(nextSize);
        }}
        onPageSizeChange={(size) => {
          setMemberPageSize(size);
          setMemberPage(1);
        }}
      />
    </>
  );

  return (
    <>
      <PageHead
        title={t('members')}
        description={t('membersDescription')}
        actions={
          <Space size={12} wrap>
            {adminOnlyTip(
              <Button
                icon={<AwStrokeIcon name="crown" />}
                disabled={!isAdmin}
                onClick={() =>
                  accessCommand('ADMIN', t('transferOwner'), () => setOwnerTransferOpen(true))}
              >
                {t('transferOwner')}
              </Button>,
            )}
          </Space>
        }
      />
      <Tabs
        className="aw-list-tabs"
        activeKey={activeTab}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams);
          if (key === DEFAULT_MEMBERS_TAB) {
            next.delete('tab');
          } else {
            next.set('tab', key);
          }
          setSearchParams(next, { replace: true });
        }}
        items={[
          {
            key: 'members',
            label: t('membersTab'),
            children: membersPane,
          },
          { key: 'roles', label: t('rolesTab'), children: <WorkspaceRolesPanel isAdmin={isAdmin} /> },
          {
            key: 'requests',
            label: t('accessRequestsTab'),
            children: <AccessRequestsPanel />,
          },
        ]}
      />
      <AddMemberModal
        open={addMemberOpen}
        roles={roles}
        loading={addMemberMutation.isPending}
        onClose={() => setAddMemberOpen(false)}
        onConfirm={handleAddMember}
      />
      <MemberAccessModal
        open={editTarget !== null}
        member={editTarget}
        roles={roles}
        loading={updateRoleMutation.isPending || updateTagsMutation.isPending}
        onClose={() => setEditTarget(null)}
        onConfirm={handleEditConfirm}
      />
      <OwnerTransferModal
        open={ownerTransferOpen}
        candidates={members.filter((member) => !member.owner)}
        loading={transferOwnerMutation.isPending}
        onClose={() => setOwnerTransferOpen(false)}
        onConfirm={handleTransferOwner}
      />
    </>
  );
}

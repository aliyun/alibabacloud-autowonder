import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { WorkspaceDomain } from '@/shared/types/common';
import { ReadOnlyFeatures } from './ReadOnlyFeatures';

function Editor({ initial = [] }: { initial?: WorkspaceDomain[] }) {
  const [value, setValue] = useState(initial);
  return <><ReadOnlyFeatures value={value} onChange={setValue} id="permissions" /><output data-testid="value">{JSON.stringify(value)}</output></>;
}

describe('ReadOnlyFeatures', () => {
  const permission = (domain: string) => screen.getByRole('radiogroup', { name: `${domain}权限` });

  it('shows one category at a time and summarizes the read-only count per category', async () => {
    const user = userEvent.setup();
    render(<Editor initial={['SDLC']} />);
    expect(screen.getByRole('tab', { name: /^交付与工单协作/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^交付与工单协作/ })).toHaveTextContent('0 项只读 · 8 项读写');
    expect(screen.getByRole('tabpanel', { name: '交付与工单协作' })).toBeInTheDocument();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(8);
    expect(screen.getByRole('tab', { name: /^流程与工作空间配置/ })).toHaveTextContent('1 项只读');
    expect(screen.queryByRole('radiogroup', { name: 'SDLC 流程权限' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^流程与工作空间配置/ }));
    expect(screen.getAllByRole('radiogroup')).toHaveLength(7);
    expect(within(permission('SDLC 流程')).getByRole('radio', { name: '只读' })).toBeChecked();
    expect(screen.getByTestId('value')).toHaveTextContent('["SDLC"]');
  });

  it('sets a whole category read-only and clears it again', async () => {
    const user = userEvent.setup();
    render(<Editor initial={['SDLC']} />);
    await user.click(screen.getByRole('tab', { name: /^流程与工作空间配置/ }));
    const bulk = screen.getByRole('checkbox', { name: '全组只读' });
    expect(bulk).toBePartiallyChecked();

    await user.click(bulk);
    expect(bulk).toBeChecked();
    expect(screen.getByRole('tab', { name: /^流程与工作空间配置/ })).toHaveTextContent('7 项只读 · 0 项读写');
    expect(screen.getByTestId('value')).toHaveTextContent(
      '["SDLC","TEMPLATE","STATEMACHINE","INTEGRATION","WORKSPACE","BACKUP","ENVIRONMENT"]',
    );

    await user.click(bulk);
    expect(bulk).not.toBeChecked();
    expect(screen.getByTestId('value')).toHaveTextContent('[]');
  });

  it('toggles one feature without touching other categories', async () => {
    const user = userEvent.setup();
    render(<Editor initial={['SDLC', 'AUDIT']} />);
    await user.click(screen.getByRole('tab', { name: /^数字员工/ }));
    await user.click(within(permission('数字员工 · 员工管理')).getByText('只读', { selector: '.ant-segmented-item-label' }));
    expect(screen.getByTestId('value')).toHaveTextContent('["SDLC","AUDIT","AGENT"]');
    await user.click(within(permission('数字员工 · 员工管理')).getByText('读写', { selector: '.ant-segmented-item-label' }));
    expect(screen.getByTestId('value')).toHaveTextContent('["SDLC","AUDIT"]');
    expect(screen.getByRole('tab', { name: /^数据洞察与审计/ })).toHaveTextContent('1 项只读');
  });

  it('renders the advanced category with its short label and hint', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const advanced = screen.getByRole('tab', { name: /^其他功能/ });
    await user.click(advanced);
    const panel = screen.getByRole('tabpanel', { name: '其他功能' });
    expect(within(panel).getByText(/没有常规菜单入口/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('radiogroup')).toHaveLength(4);
  });

  it('disables every control in view mode', async () => {
    const user = userEvent.setup();
    render(<ReadOnlyFeatures value={['SDLC']} disabled />);
    await user.click(screen.getByRole('tab', { name: /^流程与工作空间配置/ }));
    for (const control of screen.getAllByRole('radio')) expect(control).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '全组只读' })).toBeDisabled();
  });
});

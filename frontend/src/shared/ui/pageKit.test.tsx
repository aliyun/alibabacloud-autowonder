import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHead } from './PageHead';
import { Toolbar } from './Toolbar';
import { TableCard, TableFooter } from './TableCard';
import { PageFrame } from './PageFrame';
import { SectionCard } from './SectionCard';
import { StatCard } from './StatCard';
import { SplitPage } from './SplitPage';
import { PlatformShell } from './PlatformShell';

describe('PageHead', () => {
  it('renders title, description and actions in the prototype three-part layout', () => {
    render(
      <PageHead
        title="工单"
        description="总工单数 128 个"
        actions={<button type="button">新建工单</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: '工单' })).toHaveClass('aw-page-title');
    expect(screen.getByText('总工单数 128 个')).toHaveClass('aw-page-desc');
    expect(screen.getByText('总工单数 128 个').parentElement).toHaveClass('aw-page-head-copy');
    expect(screen.getByRole('button', { name: '新建工单' }).parentElement).toHaveClass('aw-page-actions');
  });

  it('omits the description and actions wrappers when not provided', () => {
    render(<PageHead title="总览" />);
    expect(screen.getByRole('heading', { level: 1, name: '总览' })).toBeInTheDocument();
    expect(document.querySelector('.aw-page-desc')).toBeNull();
    expect(document.querySelector('.aw-page-actions')).toBeNull();
  });
});

describe('Toolbar', () => {
  it('places a flexible gap between left filters and right actions', () => {
    const { container } = render(
      <Toolbar
        left={<input aria-label="搜索" />}
        right={<button type="button">高级筛选</button>}
      />,
    );
    const bar = container.firstChild as HTMLElement;
    expect(bar).toHaveClass('aw-toolbar');
    expect(bar.querySelector('.aw-toolbar-gap')).not.toBeNull();
    expect(screen.getByRole('button', { name: '高级筛选' })).toBeInTheDocument();
  });

  it('renders no gap spacer when only the left side is given', () => {
    const { container } = render(<Toolbar left={<input aria-label="搜索" />} />);
    expect((container.firstChild as HTMLElement).querySelector('.aw-toolbar-gap')).toBeNull();
  });
});

describe('TableCard', () => {
  it('wraps table content in a flush card body and keeps the footer outside it', () => {
    render(
      <TableCard footer={<div className="aw-table-footer">footer</div>}>
        <table>
          <tbody>
            <tr><td>row</td></tr>
          </tbody>
        </table>
      </TableCard>,
    );
    expect(document.querySelector('.aw-table-card')).not.toBeNull();
    const body = document.querySelector('.aw-card-body') as HTMLElement;
    expect(body).toHaveClass('aw-card-body-flush');
    expect(body).toContainElement(screen.getByText('row'));
    expect(body).not.toContainElement(screen.getByText('footer'));
  });

  it('flush variant renders without the bordered card frame for in-frame list tables', () => {
    render(
      <TableCard flush footer={<div className="aw-table-footer">footer</div>}>
        <table>
          <tbody>
            <tr><td>row</td></tr>
          </tbody>
        </table>
      </TableCard>,
    );
    const card = document.querySelector('.aw-table-card') as HTMLElement;
    expect(card).toHaveClass('aw-table-card--flush');
    expect(card).not.toHaveClass('aw-card');
    expect(document.querySelector('.aw-card-body')).toBeNull();
    expect(card).toContainElement(screen.getByText('footer'));
  });
});

describe('TableFooter', () => {
  it('renders the localized total and a small pager that reports page changes', async () => {
    const onPageChange = vi.fn();
    render(
      <TableFooter total={128} page={1} pageSize={10} onPageChange={onPageChange} />,
    );
    expect(screen.getByText('共 128 条')).toBeInTheDocument();
    await userEvent.click(screen.getByTitle('2'));
    expect(onPageChange).toHaveBeenCalledWith(2, 10);
  });
});

describe('PageFrame', () => {
  it('renders a page-level content frame section', () => {
    render(<PageFrame><div>内容</div></PageFrame>);
    const frame = document.querySelector('.aw-content-frame') as HTMLElement;
    expect(frame.tagName).toBe('SECTION');
    expect(frame).toContainElement(screen.getByText('内容'));
  });
});

describe('SectionCard', () => {
  it('renders header with title and extra, plus a padded body by default', () => {
    render(
      <SectionCard title="关键洞察" extra={<button type="button">导出</button>}>
        <div>body</div>
      </SectionCard>,
    );
    expect(screen.getByText('关键洞察')).toHaveClass('aw-card-title');
    expect(screen.getByRole('button', { name: '导出' }).parentElement).toHaveClass('aw-card-extra');
    expect(screen.getByText('关键洞察').closest('.aw-card-head')).not.toBeNull();
    expect(screen.getByText('body').parentElement).not.toHaveClass('aw-card-body-flush');
  });

  it('drops the header entirely when no title is given and supports flush bodies', () => {
    render(<SectionCard flush><div>flushbody</div></SectionCard>);
    expect(document.querySelector('.aw-card-head')).toBeNull();
    expect(screen.getByText('flushbody').parentElement).toHaveClass('aw-card-body-flush');
  });
});

describe('StatCard', () => {
  it('renders the value and unit above the label, then the optional foot line', () => {
    render(<StatCard label="本周新建" value={128} unit="个" foot={<span>日均 18</span>} />);
    const label = screen.getByText('本周新建');
    expect(label).toHaveClass('aw-stat-label');
    const value = screen.getByText('128');
    expect(value).toHaveClass('aw-stat-value');
    expect(value.parentElement?.firstElementChild).toBe(value);
    expect(value.nextElementSibling).toBe(label);
    expect(screen.getByText('个')).toHaveClass('aw-stat-unit');
    expect(screen.getByText('日均 18').parentElement).toHaveClass('aw-stat-foot');
    expect(label.nextElementSibling).toHaveClass('aw-stat-foot');
  });

  it('retains zero and ReactNode values without adding absent unit or foot wrappers', () => {
    const { container } = render(<StatCard label="待决策" value={<span>0</span>} />);
    const value = container.querySelector('.aw-stat-value');
    expect(value).toHaveTextContent('0');
    expect(value?.nextElementSibling).toHaveTextContent('待决策');
    expect(container.querySelector('.aw-stat-unit')).toBeNull();
    expect(container.querySelector('.aw-stat-foot')).toBeNull();
  });
});

describe('SplitPage', () => {
  it('renders a fluid main column and a 380px aside stack', () => {
    render(
      <SplitPage aside={<div>右栏</div>}>
        <div>主栏</div>
      </SplitPage>,
    );
    const main = screen.getByText('主栏').parentElement as HTMLElement;
    expect(main).toHaveClass('aw-split-main');
    const aside = screen.getByText('右栏').parentElement as HTMLElement;
    expect(aside.tagName).toBe('ASIDE');
    expect(aside).toHaveClass('aw-split-aside');
  });

  it('omits the aside column when not provided', () => {
    render(<SplitPage><div>主栏</div></SplitPage>);
    expect(document.querySelector('.aw-split-aside')).toBeNull();
  });
});

describe('PlatformShell', () => {
  it('renders the top bar slot and a centered main column', () => {
    render(
      <PlatformShell topbar={<div>顶栏</div>}>
        <div>平台内容</div>
      </PlatformShell>,
    );
    expect(document.querySelector('.aw-platform-shell')).not.toBeNull();
    const main = screen.getByRole('main');
    expect(main).toHaveClass('ws-wrap');
    expect(main).toContainElement(screen.getByText('平台内容'));
    expect(screen.getByText('顶栏')).toBeInTheDocument();
  });
});

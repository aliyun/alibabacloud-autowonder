import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Table } from './ThemedTable';

it('keeps prototype left alignment by default, preserves declared align and table callbacks', () => {
  const click = vi.fn();
  render(<Table pagination={false} rowKey="id" dataSource={[{id: 1, title: 'A long workitem title'}]} columns={[
    {title: 'ID', dataIndex: 'id', onHeaderCell: () => ({onClick: click, style: {whiteSpace: 'nowrap', textAlign: 'left'}})},
    {title: 'Details', children: [{title: 'Title', dataIndex: 'title', align: 'left'}]},
  ]} />);
  expect(screen.getByRole('columnheader', {name: 'ID'})).toHaveStyle({whiteSpace: 'nowrap'});
  expect(screen.getByRole('columnheader', {name: 'Title'})).toHaveStyle({textAlign: 'left'});
  expect(screen.getByRole('cell', {name: '1'})).not.toHaveAttribute('style');
  expect(screen.getByRole('cell', {name: 'A long workitem title'})).toHaveStyle({textAlign: 'left'});
  fireEvent.click(screen.getByRole('columnheader', {name: 'ID'}));
  expect(click).toHaveBeenCalledOnce();
});

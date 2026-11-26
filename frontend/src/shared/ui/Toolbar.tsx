import type { ReactNode } from 'react';

/** Prototype toolbar row: filters on the left, a flexible gap, actions on the right. */
export function Toolbar({ left, right, inCard }: {
  left?: ReactNode;
  right?: ReactNode;
  /** 原型 13 面板内档：工具栏位于表格卡片 body 顶部，左右留白对齐 panel-body。 */
  inCard?: boolean;
}) {
  return (
    <div className={inCard ? 'aw-toolbar aw-toolbar-in-card' : 'aw-toolbar'}>
      {left}
      {right != null && <span className="aw-toolbar-gap" aria-hidden="true" />}
      {right}
    </div>
  );
}

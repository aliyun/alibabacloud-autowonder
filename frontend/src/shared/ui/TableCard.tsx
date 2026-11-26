import type { ReactNode } from 'react';
import { Pagination } from 'antd';
import { useTranslation } from 'react-i18next';

/** Card frame for list pages: flush table body plus a footer slot (total + pager).
 * `flush` renders without the bordered card frame — prototype pattern-A list pages
 * place the table directly inside the white content frame. */
export function TableCard({ children, footer, className, flush }: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  const extra = className == null ? '' : ` ${className}`;
  if (flush) {
    return (
      <div className={`aw-table-card aw-table-card--flush${extra}`}>
        {children}
        {footer != null && footer}
      </div>
    );
  }
  return (
    <div className={`aw-card aw-table-card${extra}`}>
      <div className="aw-card-body aw-card-body-flush">{children}</div>
      {footer != null && footer}
    </div>
  );
}

/** Prototype table footer: 「共 N 条」 on the left, small pager on the right.
 * `totalText` overrides the default total label for pages whose existing i18n key
 * carries more specific plural wording than the shared `table.total`. */
export function TableFooter({ total, page, pageSize, onPageChange, onPageSizeChange, totalText }: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange?: (page: number, pageSize: number) => void;
  onPageSizeChange?: (size: number) => void;
  totalText?: ReactNode;
}) {
  const { t } = useTranslation('shared');
  return (
    <div className="aw-table-footer">
      <span>{totalText ?? t('table.total', { count: total })}</span>
      <div className="aw-table-pager">
        <Pagination
          size="small"
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger={onPageSizeChange != null}
          onChange={onPageChange}
          onShowSizeChange={onPageSizeChange == null ? undefined : (_current, size) => onPageSizeChange(size)}
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from './AwStrokeIcon';
import './MentionMenu.css';

export interface MentionMenuRow {
  key: string;
  name: string;
  isAgent: boolean;
  active?: boolean;
  disabled?: boolean;
  online?: boolean | null;
  meta?: Array<string | null | undefined>;
  reason?: string | null;
  query?: string | null;
}

export interface MentionMenuSection {
  key: string;
  label?: string | null;
  squadName?: string | null;
  rows: MentionMenuRow[];
}

interface MentionMenuProps {
  sections: MentionMenuSection[];
  loading?: boolean;
  query?: string | null;
  onSelect: (row: MentionMenuRow) => void;
  onHover?: (row: MentionMenuRow) => void;
  className?: string;
}

function rowTitle(row: MentionMenuRow): string {
  return row.reason ? row.name + ' — ' + row.reason : row.name;
}

function renderName(name: string, query?: string | null): ReactNode {
  const needle = query?.trim();
  if (!needle) return name;
  const index = name.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return name;
  return (
    <>
      {name.slice(0, index)}
      <span className="aw-mm-mark">{name.slice(index, index + needle.length)}</span>
      {name.slice(index + needle.length)}
    </>
  );
}

export function MentionMenu({ sections, loading = false, query, onSelect, onHover, className }: MentionMenuProps) {
  const { t } = useTranslation('common');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const visibleSections = sections.filter((section) => section.rows.length > 0);
  const total = visibleSections.reduce((sum, section) => sum + section.rows.length, 0);
  const activeKey = visibleSections.flatMap((section) => section.rows).find((row) => row.active)?.key ?? null;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !activeKey) return;
    const active = body.querySelector<HTMLElement>('.aw-mm-item[aria-current="true"]');
    if (!active) return;
    const bodyRect = body.getBoundingClientRect();
    const rowRect = active.getBoundingClientRect();
    const group = active.parentElement?.querySelector('.aw-mm-group');
    const stickyInset = group ? group.getBoundingClientRect().height : 0;
    if (rowRect.top < bodyRect.top + stickyInset) {
      body.scrollTop -= bodyRect.top + stickyInset - rowRect.top;
    } else if (rowRect.bottom > bodyRect.bottom) {
      body.scrollTop += rowRect.bottom - bodyRect.bottom;
    }
  }, [activeKey]);

  return (
    <div
      className={className ? `aw-mm ${className}` : 'aw-mm'}
      role="menu"
      aria-label={t('mention.label')}
      aria-busy={loading || undefined}
    >
      {loading && total === 0 ? (
        <div className="aw-mm-body" role="status" aria-live="polite">
          <span className="aw-mm-sr-only">{t('mention.searching')}</span>
          {[0, 1, 2].map((index) => (
            <div className="aw-mm-skel" aria-hidden="true" key={index}>
              <i />
              <div><i /><i /></div>
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="aw-mm-empty" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20.5 20.5 16.6 16.6" />
          </svg>
          <strong>{query ? t('mention.emptyTitle', { query }) : t('mention.emptyPlain')}</strong>
          <span>{t('mention.emptyHint')}</span>
        </div>
      ) : (
        <div className="aw-mm-body" ref={bodyRef}>
          {visibleSections.map((section) => (
            <div key={section.key}>
              {section.label ? (
                <div className="aw-mm-group" role="presentation">
                  <span className="aw-mm-group-label">
                    {section.label}
                    {section.squadName ? <span className="aw-mm-squad">{section.squadName}</span> : null}
                  </span>
                  <span className="aw-mm-count">{section.rows.length}</span>
                </div>
              ) : null}
              {section.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  role="menuitem"
                  className="aw-mm-item"
                  data-kind={row.isAgent ? 'agent' : 'human'}
                  aria-current={row.active ? 'true' : undefined}
                  aria-disabled={row.disabled ? 'true' : undefined}
                  disabled={row.disabled}
                  title={rowTitle(row)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => { if (!row.disabled) onHover?.(row); }}
                  onClick={() => { if (!row.disabled) onSelect(row); }}
                >
                  {row.isAgent ? (
                    <span className="aw-mm-avatar aw-mm-avatar--agent" aria-hidden="true">
                      <AwStrokeIcon name="spark" size={13} />
                    </span>
                  ) : (
                    <span className="aw-mm-avatar aw-mm-avatar--human" aria-hidden="true">
                      {row.name.trim().slice(0, 1)}
                    </span>
                  )}
                  <span className="aw-mm-main">
                    <span className="aw-mm-name">{renderName(row.name, row.query ?? query)}</span>
                    {row.reason || (row.meta && row.meta.some(Boolean)) ? (
                      <span className="aw-mm-meta">
                        {(row.meta ?? []).filter(Boolean).map((part, index) => <span key={index}>{part}</span>)}
                        {row.reason ? <span className="aw-mm-reason">{row.reason}</span> : null}
                      </span>
                    ) : null}
                  </span>
                  {row.disabled ? (
                    <span className="aw-mm-trailing">{t('mention.unavailable')}</span>
                  ) : row.isAgent && row.online === false ? (
                    <span className="aw-mm-trailing"><span className="aw-mm-dot" />{t('mention.offline')}</span>
                  ) : (
                    <span className="aw-mm-trailing" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {total >= 4 ? (
        <div className="aw-mm-foot" aria-hidden="true">
          <span className="aw-mm-hint"><span className="aw-mm-kbd aw-mm-kbd--arrows" />{t('mention.select')}</span>
          <span className="aw-mm-hint"><span className="aw-mm-kbd aw-mm-kbd--enter" />{t('mention.insert')}</span>
          <span className="aw-mm-hint"><span className="aw-mm-kbd aw-mm-kbd--esc" />{t('mention.close')}</span>
        </div>
      ) : null}
    </div>
  );
}

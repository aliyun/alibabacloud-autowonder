import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { isFoldExpanded, setFoldExpanded } from './foldingState';

/**
 * 折叠状态的会话作用域：同一节点身份（turnId/attempt/eventSeq）可能出现在不同会话，
 * 作用域保证跨会话不串展开状态；未提供时退化为进程内节点键。
 */
export const FoldScopeContext = createContext('');

interface PersistentFoldProps {
  foldKey: string;
  summary: ReactNode;
  summaryStyle: CSSProperties;
  style?: CSSProperties;
  children: ReactNode;
}

/** 原生 details 的展开状态会随卸载丢失；挂载时按 foldKey 恢复，切换时回写。 */
export function PersistentFold({ foldKey, summary, summaryStyle, style, children }: PersistentFoldProps) {
  const scope = useContext(FoldScopeContext);
  const scopedKey = scope ? `${scope}:${foldKey}` : foldKey;
  return <details open={isFoldExpanded(scopedKey)} style={style}
    onToggle={event => setFoldExpanded(scopedKey, event.currentTarget.open)}>
    <summary style={summaryStyle}>{summary}</summary>
    {children}
  </details>;
}

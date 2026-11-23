import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import type { Artifact } from '@/shared/types/workitem';
import { EventWindowBoundary, registerEventWindow } from './eventContentWindows';

const TEXT_WINDOW_CHARS = 64 * 1024;
const OVERLAP_CHARS = 1024;

function bounds(text: string, anchor: number | null) {
  let start = Math.max(0, Math.min(anchor ?? text.length, text.length - TEXT_WINDOW_CHARS));
  if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start--;
  let end = Math.min(text.length, start + TEXT_WINDOW_CHARS);
  if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
  return { start, end };
}

/** Keeps Markdown parsing bounded even when many small model deltas merge into a large reply. */
export function WindowedConversationText({ text, artifacts, onArtifactClick }: {
  text: string; artifacts?: Artifact[]; onArtifactClick?: (artifact: Artifact) => void;
}) {
  const key = useId();
  const [anchor, setAnchor] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const movement = useRef<'earlier' | 'later' | null>(null);
  const { start, end } = bounds(text, anchor);
  useEffect(() => registerEventWindow(key, async cursor => {
    if (cursor < start) {
      follow.current = false; movement.current = 'earlier';
      setAnchor(Math.max(0, start - TEXT_WINDOW_CHARS + OVERLAP_CHARS));
    } else {
      movement.current = 'later';
      const next = Math.min(text.length, end - OVERLAP_CHARS);
      const latest = next + TEXT_WINDOW_CHARS >= text.length;
      follow.current = latest; setAnchor(latest ? null : next);
    }
  }), [end, key, start, text.length]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (movement.current === 'earlier' || (anchor == null && follow.current)) node.scrollTop = node.scrollHeight;
    else if (movement.current === 'later') node.scrollTop = 0;
    movement.current = null;
  }, [anchor, end, start]);
  const content = <MarkdownView className="aw-clarify-md" content={text.slice(start, end)}
    artifacts={artifacts} onArtifactClick={onArtifactClick} />;
  if (text.length <= TEXT_WINDOW_CHARS) return content;
  const window = { key, first: start, last: end - 1, total: text.length };
  return <div ref={scroll} data-testid="text-window-scroll" style={{ maxHeight: 480, overflow: 'auto' }}
    onScroll={event => {
      const node = event.currentTarget;
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      follow.current = atBottom && end === text.length;
      if (!atBottom && anchor == null) setAnchor(start);
      else if (follow.current && anchor != null) setAnchor(null);
    }}>
    {start > 0 && <EventWindowBoundary window={window} direction="earlier" />}
    <div data-text-window-body>{content}</div>
    {end < text.length && <EventWindowBoundary window={window} direction="later" />}
  </div>;
}

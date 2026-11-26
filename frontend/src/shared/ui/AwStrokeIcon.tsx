import type { ReactNode } from 'react';

/** 原型 SVG 图标集（prototype.css 各页 symbol 的 1:1 描边路径，stroke=currentColor）。 */
const ICON_PATHS: Record<string, ReactNode> = {
  dash: (<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  file: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /></>),
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  history: (<><path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>),
  trash: (<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
  robot: (<><rect x="4" y="7" width="16" height="14" rx="2.5" /><path d="M12 7V4" /><path d="M12 3h.01" /><path d="M9.5 12.5h.01" /><path d="M14.5 12.5h.01" /><path d="M9.5 17h5" /></>),
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  branch: (<><circle cx="6" cy="5" r="2.5" /><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="7" r="2.5" /><path d="M6 7.5v9" /><path d="M18 9.5c0 4.5-5 5.5-8 5.5" /></>),
  book: (<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>),
  bulb: (<><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" /></>),
  apartment: (<><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3h14v3" /><path d="M12 12V8" /></>),
  node: (<><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M7.5 11.2 16.5 6" /><path d="M7.5 12.8 16.5 18" /></>),
  api: (<><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" /><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" /></>),
  team: (<><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="3" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" /><path d="M15 4.13a4 4 0 0 1 0 7.75" /></>),
  backup: (<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>),
  key: (<><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 21 2" /><path d="M17 6l3 3" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></>),
  audit: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15l2 2 4-4" /></>),
  compass: (<><circle cx="12" cy="12" r="10" /><path d="M16 8l-2.5 5.5L8 16l2.5-5.5z" /></>),
  gear: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  // 原型 03+ 各页 symbol 扩展（顶栏/工具栏/表格操作图标）
  help: (<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 2" /><path d="M12 17h.01" /></>),
  globe: (<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2c2.7 2.7 4 6.3 4 10s-1.3 7.3-4 10c-2.7-2.7-4-6.3-4-10s1.3-7.3 4-10z" /></>),
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  bell: (<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
  'chev-d': <path d="M6 9l6 6 6-6" />,
  search: (<><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></>),
  star: <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8l-6.2 3.2L7 14.2 2 9.3l6.9-1z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  kanban: (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7v10" /><path d="M12 7v6" /><path d="M16 7v8" /></>),
  table: (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /></>),
  filter: <path d="M22 3H2l8 9.5V19l4 2v-8.5z" />,
  tag: (<><path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><path d="M7 7h.01" /></>),
  refresh: (<><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>),
  edit: (<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></>),
  x: (<><path d="M18 6 6 18" /><path d="M6 6l12 12" /></>),
  cal: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  menu: (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>),
  'chev-l': <path d="M15 18l-6-6 6-6" />,
  play: <path d="M6 4l14 8-14 8z" />,
  pause: (<><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>),
  more: (<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>),
  copy: (<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  'activity': <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  'alert-c': (<><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>),
  'alert-t': (<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>),
  back: (<><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></>),
  undo: (<><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></>),
  check: <path d="M20 6 9 17l-5-5" />,
  'check-c': (<><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" /><path d="M22 4 12 14l-3-3" /></>),
  'chev-r': <path d="M9 18l6-6-6-6" />,
  code: <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />,
  coin: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M9.5 9.5h3.7a1.8 1.8 0 0 1 0 3.6h-3.7h4" /></>),
  crown: <path d="M3 7l4 4 5-7 5 7 4-4v12H3z" />,
  dl: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  doc: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>),
  down: <path d="M12 5v14M19 12l-7 7-7-7" />,
  enter: (<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></>),
  ext: (<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></>),
  eye: (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>),
  fullscreen: <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />,
  info: (<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>),
  lock: (<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  msg: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  package: (<><path d="M16.5 9.4 7.5 4.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>),
  paperclip: <path d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9.2-9.2" />,
  palette: (<><circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" /><path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h3a3 3 0 0 0 3-3c0-5-4.5-9-10-9z" /></>),
  reply: (<><path d="M9 17l-6-5 6-5" /><path d="M3 12h11a6 6 0 0 1 6 6v3" /></>),
  send: (<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>),
  share: (<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>),
  shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  shuffle: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
  spark: <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" />,
  term: <path d="M4 17l6-5-6-5M12 19h8" />,
  top: <path d="M12 19V5M5 12l7-7 7 7" />,
  transfer: (<><path d="M17 3l4 4-4 4" /><path d="M21 7H7" /><path d="M7 21l-4-4 4-4" /><path d="M3 17h14" /></>),
  up: (<><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></>),
  upload: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></>),
  user: (<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  'user-plus': (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>),
  link: (<><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>),
  power: (<><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /><path d="M12 2v8" /></>),
  appstore: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  rocket: (<><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2a2.8 2.8 0 0 0-3-3z" /><path d="M9 14a20 20 0 0 1 9-11c2 0 3 1 3 3a20 20 0 0 1-11 9z" /><path d="M9 14l-2-2" /><path d="M12 17l-2-2" /><circle cx="15" cy="7" r="1" /></>),
  inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  'zoom-in': (<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M11 8v6M8 11h6" /></>),
  'zoom-out': (<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M8 11h6" /></>),
};

export function AwStrokeIcon({ name, size = 15, className }: { name: keyof typeof ICON_PATHS | string; size?: number; className?: string }) {
  const paths = ICON_PATHS[name];
  if (!paths) return null;
  return (
    <svg
      data-glyph={name}
      className={className ? `aw-stroke-icon ${className}` : 'aw-stroke-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

/** The iframe may navigate within the reported local server, never to another origin. */
export function designElementText(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

export function designRuntimeUrl(port: number | null | undefined, route = '/'): string | null {
  if (!Number.isInteger(port) || !port || port < 1 || port > 65535) return null;
  return designNavigationUrl(`http://localhost:${port}/`, route);
}

function previewBaseRoot(basePath: string): string {
  return basePath === '/' ? '/' : basePath.replace(/\/+$/, '');
}

export function isDesignPreviewPath(pathname: string, basePath: string): boolean {
  const root = previewBaseRoot(basePath);
  return root === '/' || pathname === root || pathname.startsWith(`${root}/`);
}

export function hasUnsafePreviewUrlCharacter(value: string): boolean {
  for (const character of value) {
    if (character === '\\' || character.charCodeAt(0) < 0x20) return true;
  }
  return false;
}

export function designNavigationUrl(current: string, input: string, remote = false, basePath = '/'): string | null {
  try {
    if (!input.trim() || hasUnsafePreviewUrlCharacter(input)) return null;
    const base = new URL(current);
    const value = input.trim();
    const relative = basePath !== '/' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith(basePath)
      ? basePath + value.slice(1) : value;
    const url = new URL(relative, base);
    if (url.origin !== base.origin || (!remote && (url.hostname !== 'localhost' || url.protocol !== 'http:'))
      || (remote && !['http:', 'https:'].includes(url.protocol))
      || !isDesignPreviewPath(url.pathname, basePath) || /%(?:2e|2f|5c|25)/i.test(url.pathname)
      || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function isDesignFrameMessage(event: MessageEvent, frame: HTMLIFrameElement | null, url: string): boolean {
  if (!frame?.contentWindow || event.source !== frame.contentWindow) return false;
  try { return event.origin === new URL(url).origin && !!event.data && typeof event.data === 'object'; }
  catch { return false; }
}

export interface PrdDesignRuntime {
  conversationId: number;
  executorId: number;
  turnId: number;
  dispatchAttempt: number;
  status: 'STARTING' | 'PREPARED' | 'READY' | 'FAILED';
  port: number | null;
  route: string;
  directory: string;
  error: string | null;
  revision: number;
  sourceKey?: string;
}

import { designNavigationUrl } from './designBrowser';

/** Apply the preview namespace before an embedded inspector captures an app link. */
export function scopePreviewLinks(document: Document, entryUrl: string, basePath: string): () => void {
  const view = document.defaultView;
  if (!view || !basePath.startsWith('/design-preview/')) return () => {};
  const capture = (event: Event) => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a[href]');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href?.startsWith('/') || href.startsWith('//') || href.startsWith(basePath)) return;
    // An explicit link to another preview is not a route of this application.
    if (href.startsWith('/design-preview/')) return;
    const scoped = designNavigationUrl(entryUrl, href, true, basePath);
    if (scoped) anchor.setAttribute('href', scoped);
  };
  view.addEventListener('click', capture, true);
  return () => view.removeEventListener('click', capture, true);
}

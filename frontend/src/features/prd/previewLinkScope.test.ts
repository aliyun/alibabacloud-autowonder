import { afterEach, expect, it } from 'vitest';
import { scopePreviewLinks } from './previewLinkScope';

let dispose = () => {};
afterEach(() => { dispose(); document.body.innerHTML = ''; });

it('scopes a dynamically inserted root link before the inspector captures it', () => {
  const base = '/design-preview/binding/';
  dispose = scopePreviewLinks(document, `https://preview.example${base}`, base);
  document.body.innerHTML = '<a href="/repos?q=one#details"><span>repository</span></a>';
  let captured: string | null = null;
  document.addEventListener('click', event => {
    captured = document.querySelector('a')!.getAttribute('href');
    event.preventDefault();
  }, { capture: true, once: true });
  document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(captured).toBe('https://preview.example/design-preview/binding/repos?q=one#details');
});

it.each(['https://other.example/repos', '//other.example/repos', '#section', '/design-preview/other/repos', '/%2e%2e/admin'])('preserves or rejects destinations outside the app: %s', href => {
  dispose = scopePreviewLinks(document, 'https://preview.example/design-preview/binding/', '/design-preview/binding/');
  const anchor = document.createElement('a'); anchor.setAttribute('href', href); document.body.append(anchor);
  anchor.addEventListener('click', event => event.preventDefault());
  anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(anchor.getAttribute('href')).toBe(href);
});

it('removes the handler when the preview changes', () => {
  dispose = scopePreviewLinks(document, 'https://preview.example/design-preview/binding/', '/design-preview/binding/');
  dispose();
  document.body.innerHTML = '<a href="/repos">repository</a>';
  const anchor = document.querySelector('a')!;
  anchor.addEventListener('click', event => event.preventDefault());
  anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(anchor.getAttribute('href')).toBe('/repos');
});

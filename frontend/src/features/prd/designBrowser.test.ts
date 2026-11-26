import { describe, expect, it } from 'vitest';
import { designNavigationUrl, designRuntimeUrl, isDesignFrameMessage } from './designBrowser';

describe('design browser boundaries', () => {
  it('uses the actual reported port and preserves route query/hash', () => {
    expect(designRuntimeUrl(5174, '/settings?q=1#save')).toBe('http://localhost:5174/settings?q=1#save');
    for (const port of [null, 0, -1, 65536, 1.5]) expect(designRuntimeUrl(port)).toBeNull();
  });
  it('allows local navigation and refuses remote or scripted addresses', () => {
    const base = 'http://localhost:5174/settings';
    expect(designNavigationUrl(base, '/users?sort=name#list')).toBe('http://localhost:5174/users?sort=name#list');
    for (const route of ['https://evil.example', 'http://localhost:5173/', 'javascript:alert(1)', '/\\evil.example', '/x\n']) {
      expect(designNavigationUrl(base, route)).toBeNull();
    }
  });
  it('keeps platform routes and assets inside the assigned preview path', () => {
    const prefix = '/design-preview/session-1/';
    const base = `https://app.example.com${prefix}settings`;
    expect(designNavigationUrl(base, '/details?q=1#save', true, prefix)).toBe(`https://app.example.com${prefix}details?q=1#save`);
    expect(designNavigationUrl(base, 'next', true, prefix)).toBe(`https://app.example.com${prefix}next`);
    expect(designNavigationUrl(base, 'https://app.example.com/design-preview/session-1', true, prefix))
      .toBe('https://app.example.com/design-preview/session-1');
    expect(designNavigationUrl(base, 'https://app.example.com/design-preview/session-10', true, prefix)).toBeNull();
    for (const path of ['https://app.example.com/api/auth/login', 'https://app.example.com/design-preview/other/', '../../api', '/%252e%252e/api', '/%2fapi', '//evil.example/']) {
      expect(designNavigationUrl(base, path, true, prefix)).toBeNull();
    }
  });
  it('requires both the current iframe source and exact local origin', () => {
    const frame = document.createElement('iframe'); document.body.append(frame);
    const make = (origin: string, source: MessageEventSource | null) => new MessageEvent('message', {
      origin, source, data: { type: 'demo:ready' },
    });
    expect(isDesignFrameMessage(make('http://localhost:5174', frame.contentWindow), frame, 'http://localhost:5174/')).toBe(true);
    expect(isDesignFrameMessage(make('http://localhost:5173', frame.contentWindow), frame, 'http://localhost:5174/')).toBe(false);
    expect(isDesignFrameMessage(make('http://localhost:5174', window), frame, 'http://localhost:5174/')).toBe(false);
    frame.remove();
  });
});

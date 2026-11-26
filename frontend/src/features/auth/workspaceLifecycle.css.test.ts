import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// F7's four states and its visible keyboard focus ring exist only in this stylesheet, and vitest
// stubs CSS imports — the plain, `?raw` and `?inline` forms all resolve to an empty string — so
// the rules cannot be observed through an import or through computed styles. The file is read
// straight off disk instead: a component test would still pass if these rules were deleted, which
// is exactly the regression F7 is written against.
// The path is joined with dirname/resolve rather than `new URL('./workspaceLifecycle.css',
// import.meta.url)`: Vite rewrites that pattern into a served http asset URL, which fileURLToPath
// then rejects.
const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'workspaceLifecycle.css'),
  'utf8',
);

/**
 * The declaration block of one selector. Matching on the selector alone would pass for an
 * empty rule, so the block is what gets asserted. `${selector} {` also disambiguates the
 * base rule from its own pseudo-class variants.
 */
function rule(selector: string): string {
  const marker = `${selector} {`;
  const boundary = css.indexOf(`\n${marker}`);
  const start = css.startsWith(marker) ? 0 : boundary === -1 ? -1 : boundary + 1;
  expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', start);
  expect(end, `unterminated rule for ${selector}`).toBeGreaterThan(start);
  return css.slice(start + selector.length + 2, end).replace(/\s+/g, ' ').trim();
}

function expectInteractiveStates(selector: string) {
  for (const state of [':hover', ':active']) {
    expect(rule(`${selector}${state}`), `${selector}${state} is empty`).not.toBe('');
  }
}

describe('workspaceLifecycle.css', () => {
  it('keeps all workspace/new cards at the approved height with manage actions always visible', () => {
    expect(rule('.ws-card, .ws-new')).toContain('height: 148px');
    expect(rule('.ws-card, .ws-new')).toContain('box-sizing: border-box');
    expect(rule('.ws-foot')).not.toContain('opacity: 0');
    expect(rule('.ws-ops')).toContain('gap: 4px');
    expect(rule('.ws-ops')).not.toContain('opacity:');
    expect(rule('.ws-op')).toContain('padding: 0');
    expect(rule('.ws-card.is-unjoined')).toContain('background: var(--aw-gray-bg)');
    expect(rule('.ws-card.is-unjoined .ws-mark')).toContain('opacity: .65');
    expect(rule('.ws-card.is-unjoined')).not.toContain('opacity:');
  });

  it('uses natural 6/24px field spacing in both workspace modals', () => {
    expect(rule('.ws-workspace-form .ant-form-item')).toContain('margin-bottom: 24px');
    expect(rule('.ws-workspace-form .ant-form-item-label')).toContain('padding-bottom: 6px');
    expect(rule('.ws-workspace-form .ant-form-item-margin-offset')).toContain('display: none');
    expect(rule('.ws-workspace-form .ant-form-item-with-help .ant-form-item-explain')).toContain('margin-top: 6px');
    expect(rule('.ws-workspace-form .ant-form-item-explain-error')).toContain('line-height: 20px');
    expect(rule('.ws-modal .ant-modal-footer')).toContain('gap: 8px');
  });

  it('matches the neutral membership badge and anchored card footer', () => {
    expect(rule('.ws-membership')).toContain('color: var(--aw-text-3)');
    expect(rule('.ws-membership')).toContain('background: var(--aw-gray-bg)');
    expect(rule('.ws-cur, .ws-membership')).toContain('font-weight: 600');
    expect(rule('.ws-card-enter')).toContain('margin-bottom: auto');
    expect(rule('.ws-count')).toContain('gap: 3px');
    expect(rule('.ws-background')).toContain('line-height: 24px');
  });

  it('keeps centered modals within 16px edges and prevents header/footer shrinking', () => {
    expect(rule('.ws-modal')).toContain('padding-bottom: 0');
    expect(rule('.ws-modal .ant-modal-content')).toContain('max-height: calc(100dvh - 32px)');
    expect(rule('.ws-modal .ant-modal-header')).toContain('flex-shrink: 0');
    expect(rule('.ws-modal .ant-modal-footer')).toContain('flex-shrink: 0');
    expect(rule('.ws-modal .ant-modal-body')).toContain('overflow-y: auto');
    expect(rule('.ws-modal .ant-modal-body')).toContain('min-height: 0');
  });

  it('styles the apply button with the shared appearance tokens', () => {
    const base = rule('.aw-apply-access-button');
    expect(base).toContain('align-self: flex-end');
    expect(base).toContain('border: 1px solid var(--aw-accent-text)');
    expect(base).toContain('background: var(--aw-panel)');
    expect(base).toContain('color: var(--aw-accent-text)');
    expect(base).not.toContain('#ff6a00');
    expect(base).toContain('cursor: pointer');
    expect(base).not.toContain('cursor: not-allowed');
    expect(base).toContain('font-weight: 400');
    expect(base).toContain('height: 26px');
    expect(base).toContain('padding: 0 8px');
  });

  it('gives the apply button distinct hover and active states', () => {
    expectInteractiveStates('.aw-apply-access-button');
    expect(rule('.aw-apply-access-button:hover')).toContain('background: var(--aw-button-hover)');
    expect(rule('.aw-apply-access-button:active')).toContain('background: var(--aw-button-active)');
  });

  it('keeps every hover and active background distinct from the default', () => {
    const base = rule('.aw-apply-access-button');
    const hover = rule('.aw-apply-access-button:hover');
    const active = rule('.aw-apply-access-button:active');
    const backgrounds = [base, hover, active].map((block) => /background:\s*([^;]+)/.exec(block)?.[1]);
    // Three identical values would mean the states are declared but visually inert, which
    // is exactly the failure F7 is written against.
    expect(new Set(backgrounds).size).toBe(3);
    expect(backgrounds).not.toContain(undefined);
  });

  it('keeps the card management controls borderless icon buttons with danger hover', () => {
    expectInteractiveStates('.aw-card-manage-button');
    const danger = rule('.aw-card-manage-button--danger:hover');
    expect(rule('.aw-card-manage-button')).toContain('border: 0');
    expect(rule('.aw-card-manage-button')).toContain('width: 24px');
    expect(danger).toContain('background: var(--aw-error-bg)');
    expect(danger).toContain('color: var(--aw-error-deep)');
  });

  it('styles the recycle bin entry as a quiet textual control', () => {
    expectInteractiveStates('.aw-recycle-bin-entry');
    const base = rule('.aw-recycle-bin-entry');
    expect(base).toContain('color: var(--aw-text-2)');
    expect(base).toContain('height: 26px');
    expect(base).toContain('background: transparent');
    expect(base).toContain('border-radius: 4px');
  });
});

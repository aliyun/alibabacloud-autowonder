import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Joining the path avoids Vite rewriting new URL(css, import.meta.url) to an HTTP asset.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'spaceDashboard.css'), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start).split('}')[0];
};

// Source-token regressions only: jsdom does not measure layout. Browser geometry is a separate gate.
describe('original 09d dashboard style contract', () => {
  it('uses a 14px/600 title without the old blue stripe', () => {
    expect(rule('.space-dashboard-section-title')).toContain('font-size: 14px');
    expect(rule('.space-dashboard-section-title')).toContain('font-weight: 600');
    expect(css).not.toContain('.space-dashboard-section-rule');
  });

  it('keeps metric numbers fixed at 24px/600 in the theme colour at every width', () => {
    const value = rule('.space-dashboard-stat-value');
    expect(value).toContain('font-size: 24px');
    expect(value).toContain('font-weight: 600');
    expect(value).toContain('color: var(--aw-primary)');
    expect(css).not.toContain('clamp(');
    expect(css.match(/\.space-dashboard-stat-value\s*\{/g)).toHaveLength(1);
  });

  it('uses separate explicit 4/3/2-column rows with the approved card spacing', () => {
    expect(rule('.space-dashboard-grid')).toContain('repeat(3, minmax(0, 1fr))');
    expect(rule('.space-dashboard-grid-four')).toContain('repeat(4, minmax(0, 1fr))');
    expect(rule('.space-dashboard-ranks')).toContain('repeat(2, minmax(0, 1fr))');
    expect(rule('.space-dashboard-ranks')).toContain('margin-top: 12px');
    expect(rule('.space-dashboard-stat.ant-card')).toContain('border-radius: 8px');
    expect(rule('.space-dashboard-section + .space-dashboard-section')).toContain('margin-top: 28px');
    expect(rule('.space-dashboard-section + .space-dashboard-section')).toContain('border-top: 1px solid var(--aw-border)');
    expect(css).not.toContain('auto-fit');
  });

  it('naturally wraps headers and uses two snapshot columns / single other rows on narrow screens', () => {
    expect(rule('.space-dashboard-section-head')).toContain('flex-wrap: wrap');
    expect(rule('.space-dashboard-toolbar')).toContain('margin-left: auto');
    const narrow = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(narrow).toMatch(/\.space-dashboard-grid,\s*\.space-dashboard-ranks\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
    expect(narrow).toMatch(/\.space-dashboard-grid-four\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(narrow).not.toContain('font-size:');
    expect(narrow).not.toContain('display: none');
    expect(css).toContain('.space-dashboard-date-popup');
    expect(css).toContain('max-width: calc(100vw - 32px)');
    const tablet = css.slice(css.indexOf('@media (max-width: 820px)'));
    expect(tablet).toMatch(/\.space-dashboard-date-popup\s*\{\s*left: 0 !important/);
  });
});

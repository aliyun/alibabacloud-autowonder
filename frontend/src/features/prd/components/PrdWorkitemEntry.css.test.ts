import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAppearanceVariables } from '@/shared/theme/appearance';

// antd cssVar is off app-wide and vitest stubs CSS imports, so an undefined theme variable
// silently falls back to a light-mode constant and is only observable on disk.
const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'PrdWorkitemEntry.css'),
  'utf8',
);

describe('PrdWorkitemEntry.css', () => {
  it('styles the entry with appearance tokens defined in both light and dark modes', () => {
    expect(css).not.toMatch(/var\(--ant-/);
    expect(css).toContain('background: var(--aw-panel)');
    const used = [...css.matchAll(/var\((--aw-[\w-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const mode of ['light', 'dark'] as const) {
      const defined = getAppearanceVariables(mode, '#f97316');
      for (const name of used) {
        expect(defined, `${mode} missing ${name}`).toHaveProperty(name);
      }
    }
  });
});

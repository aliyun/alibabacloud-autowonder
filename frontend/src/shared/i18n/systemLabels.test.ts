import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from './index';
import { getSystemLabel } from './systemLabels';

describe('system label resolver', () => {
  afterEach(async () => { await i18n.changeLanguage('zh-CN'); });

  it('translates only registered system keys', async () => {
    expect(getSystemLabel('statusNode.TASK.doing', '进行中')).toBe('进行中');
    await i18n.changeLanguage('en-US');
    expect(getSystemLabel('statusTemplate.REQ', '需求默认流程')).toBe('Requirement Default Flow');
    expect(getSystemLabel('statusNode.TASK.doing', '进行中')).toBe('In Progress');
    expect(getSystemLabel('statusNode.BUG.closed', '已关闭')).toBe('Closed');
    expect(getSystemLabel('statusTransition.forward', '前进')).toBe('Advance');
    expect(getSystemLabel('envPreset.qoder', '自定义说明')).toContain('Qoder API key');
  });

  it('falls back to the original value for missing and unknown keys', async () => {
    await i18n.changeLanguage('en-US');
    expect(getSystemLabel(undefined, '用户自建')).toBe('用户自建');
    expect(getSystemLabel(null, '用户自建')).toBe('用户自建');
    expect(getSystemLabel('', '用户自建')).toBe('用户自建');
    expect(getSystemLabel('statusNode.REQ.unknown', '用户自建')).toBe('用户自建');
    expect(getSystemLabel('user.custom', 'Custom')).toBe('Custom');
  });
});

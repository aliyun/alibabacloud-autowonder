import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from './index';

/**
 * 系统播种/预置文案的有限展示键。服务端只会在系统播种与预置路径写入这些键；
 * 未知键、空键一律回退原文，绝不把任意服务端字符串当作翻译键。
 */
const SYSTEM_LABEL_TRANSLATIONS = {
  'statusTemplate.REQ': 'systemLabels:statusTemplate.REQ',
  'statusTemplate.TASK': 'systemLabels:statusTemplate.TASK',
  'statusTemplate.BUG': 'systemLabels:statusTemplate.BUG',
  'statusNode.REQ.new': 'systemLabels:statusNode.REQ.new',
  'statusNode.REQ.developing': 'systemLabels:statusNode.REQ.developing',
  'statusNode.REQ.verifying': 'systemLabels:statusNode.REQ.verifying',
  'statusNode.REQ.released': 'systemLabels:statusNode.REQ.released',
  'statusNode.REQ.canceled': 'systemLabels:statusNode.REQ.canceled',
  'statusNode.TASK.todo': 'systemLabels:statusNode.TASK.todo',
  'statusNode.TASK.doing': 'systemLabels:statusNode.TASK.doing',
  'statusNode.TASK.done': 'systemLabels:statusNode.TASK.done',
  'statusNode.BUG.open': 'systemLabels:statusNode.BUG.open',
  'statusNode.BUG.fixing': 'systemLabels:statusNode.BUG.fixing',
  'statusNode.BUG.verifying': 'systemLabels:statusNode.BUG.verifying',
  'statusNode.BUG.closed': 'systemLabels:statusNode.BUG.closed',
  'statusTransition.forward': 'systemLabels:statusTransition.forward',
  'statusTransition.cancel': 'systemLabels:statusTransition.cancel',
  'envPreset.qoder': 'systemLabels:envPreset.qoder',
  'envPreset.qodercn': 'systemLabels:envPreset.qodercn',
} as const;

export type SystemLabelKey = keyof typeof SYSTEM_LABEL_TRANSLATIONS;

type SystemLabelTranslation = (typeof SYSTEM_LABEL_TRANSLATIONS)[SystemLabelKey];

function translationFor(key: string | null | undefined): SystemLabelTranslation | null {
  if (!key || !Object.prototype.hasOwnProperty.call(SYSTEM_LABEL_TRANSLATIONS, key)) {
    return null;
  }
  return SYSTEM_LABEL_TRANSLATIONS[key as SystemLabelKey];
}

/** 非 React 上下文使用；组件内请用 useSystemLabel 以订阅语言切换。 */
export function getSystemLabel(key: string | null | undefined, original: string): string {
  const translation = translationFor(key);
  return translation ? i18n.t(translation) : original;
}

/** 返回带有语言订阅的系统标签解析函数。 */
export function useSystemLabel(): (key: string | null | undefined, original: string) => string {
  // 订阅语言变化触发重渲染；解析始终读取 i18n 单例的当前语言。
  useTranslation('systemLabels');
  return useCallback((key: string | null | undefined, original: string) => getSystemLabel(key, original), []);
}

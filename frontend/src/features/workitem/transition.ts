export type TransitionDotColor = 'green' | 'amber' | 'gray' | 'blue';

/** 状态节点圆点颜色：与详情页、工作台改状态弹窗保持一致。 */
export function transitionDotColor(node: { category?: string | null; code?: string | null }): TransitionDotColor {
  const category = node.category?.toUpperCase();
  if (category === 'DONE') return 'green';
  if (category === 'CANCELED') return 'gray';
  if (/WAIT|DECISION|PAUSE|BLOCK|HOLD/i.test(node.code || '')) return 'amber';
  if (category === 'INIT') return 'gray';
  return 'blue';
}

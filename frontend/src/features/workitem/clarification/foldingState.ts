/**
 * 过程节点的展开状态按稳定节点身份保存：渲染窗口只决定挂载哪些 DOM，
 * 节点滚出再滚回时仍保持用户展开的思考/输入/输出。
 */
const MAX_FOLDS = 5000;
const folded = new Map<string, true>();

export function isFoldExpanded(key: string): boolean {
  return folded.has(key);
}

export function setFoldExpanded(key: string, expanded: boolean) {
  folded.delete(key);
  if (!expanded) return;
  folded.set(key, true);
  while (folded.size > MAX_FOLDS) folded.delete(folded.keys().next().value!);
}

export function clearFoldState() {
  folded.clear();
}

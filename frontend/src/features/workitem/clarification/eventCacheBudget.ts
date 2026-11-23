const CONVERSATION_CACHE_BYTES = 8 * 1024 * 1024;
type Entry = { bytes: number; evict: () => void };
const conversations = new Map<number, Map<symbol, Entry>>();

/** Shared LRU admission covers all mounted turn feeds in the same conversation. */
export function accountEventCache(conversationId: number, owner: symbol, bytes: number, evict: () => void) {
  let cache = conversations.get(conversationId);
  if (!cache) { cache = new Map(); conversations.set(conversationId, cache); }
  cache.delete(owner); cache.set(owner, { bytes, evict });
  let total = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (total > CONVERSATION_CACHE_BYTES && cache.size) {
    const [key, entry] = cache.entries().next().value!;
    cache.delete(key); total -= entry.bytes;
    entry.evict();
  }
}

export function releaseEventCache(conversationId: number, owner: symbol) {
  const cache = conversations.get(conversationId);
  cache?.delete(owner);
  if (!cache?.size) conversations.delete(conversationId);
}

/** A payload-free resource gauge for diagnostics and budget verification. */
export function eventCacheUsage(conversationId: number) {
  return [...(conversations.get(conversationId)?.values() ?? [])]
    .reduce((sum, entry) => sum + entry.bytes, 0);
}

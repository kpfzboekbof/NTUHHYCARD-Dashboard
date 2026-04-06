import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 }); // 5 min default

export function getCached<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

export function setCached<T>(key: string, data: T, ttl?: number): void {
  cache.set(key, data, ttl ?? 300);
}

export function clearAllCache(): void {
  cache.flushAll();
}

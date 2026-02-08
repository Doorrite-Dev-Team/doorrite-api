import { redis } from "./redis";

export class CacheMemory {
  // Used for local tracking or L1 bypass; optional for pure Redis setups
  private CacheKeys: Set<string> = new Set();

  public generateKey(module: string, identifier: string = "all"): string {
    return `cache:${module}:${identifier}`;
  }

  public async get<T>(key: string): Promise<T | null> {
    const data = await redis.get<T>(key);

    if (!data) return null;
    return data;
  }

  public async set(
    key: string,
    value: any,
    ttlSeconds: number = 3600,
  ): Promise<void> {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
    this.CacheKeys.add(key);
  }

  public async hasCache(key: string): Promise<boolean> {
    // Check Redis directly for the source of truth
    const exists = await redis.exists(key);
    if (!exists) this.CacheKeys.delete(key);
    return exists === 1;
  }

  public async invalidate(key: string): Promise<void> {
    await redis.del(key);
    this.CacheKeys.delete(key);
  }

  public async invalidatePattern(pattern: string): Promise<void> {
    const keys = await redis.keys(`cache:${pattern}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
      keys.forEach((k) => this.CacheKeys.delete(k));
    }
  }

  public async invalidateAll() {
    this.CacheKeys.forEach(async (k) => {
      await redis.del(k);
      this.CacheKeys.delete(k);
    });
  }

  public async invalidateMultiplePatterns(patterns: string[]): Promise<void> {
    const promises = patterns.map((pattern) => this.invalidatePattern(pattern));
    await Promise.all(promises);
  }
}

export const cacheService = new CacheMemory();

import { redis } from "@config/redis";

const PENDING_REVIEW_TTL = 48 * 60 * 60;

export const PendingReviewService = {
  async add(orderId: string, userId: string) {
    const key = `pending-review:${userId}`;
    await redis.lpush(key, orderId);
    await redis.expire(key, PENDING_REVIEW_TTL);
  },

  async getPending(userId: string): Promise<string[]> {
    return redis.lrange(`pending-review:${userId}`, 0, -1);
  },

  async remove(userId: string, orderId: string) {
    await redis.lrem(`pending-review:${userId}`, 0, orderId);
  },

  async isPending(userId: string, orderId: string): Promise<boolean> {
    const pending = await redis.lrange(`pending-review:${userId}`, 0, -1);
    return pending.includes(orderId);
  },
};

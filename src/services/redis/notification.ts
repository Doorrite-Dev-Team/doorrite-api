import { redis } from "@config/redis";

export const NotificationService = {
  // Save notification to Redis (Hash + List)
  async add(userId: string, notifId: string, data: object) {
    const multi = redis.multi();
    // 1. Store content in Hash
    multi.hset(`notif:${notifId}`, data as any);
    // 2. Add ID to user's unread list
    multi.lpush(`user:${userId}:notifs`, notifId);
    // 3. Set expiry (optional safety net, e.g., 7 days)
    multi.expire(`notif:${userId}`, 604800);
    await multi.exec();
  },

  // Get all pending notifications for a user
  async getPending(userId: string) {
    const notifIds = await redis.lrange(`user:${userId}:notifs`, 0, -1);
    if (!notifIds.length) return [];

    const pipeline = redis.multi();
    notifIds.forEach((id) => pipeline.hgetall(`notif:${id}`));
    const results = await pipeline.exec();

    // Merge IDs with content
    return results.map((content, index) => ({
      id: notifIds[index],
      ...(content as Object),
    }));
  },

  // Remove notification after acknowledgement
  async remove(userId: string, notifId: string) {
    const multi = redis.multi();
    multi.lrem(`user:${userId}:notifs`, 0, notifId); // Remove from list
    multi.del(`notif:${notifId}`); // Delete content
    await multi.exec();
  },
};

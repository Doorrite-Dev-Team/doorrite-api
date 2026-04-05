import { redis } from "@config/redis";

export const NotificationService = {
  // Save notification to Redis (Hash + List)
  async add(userId: string, notifId: string, data: object) {
    const stringifiedData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = typeof value === "string" ? value : JSON.stringify(value);
    }

    const multi = redis.multi();
    multi.hset(`notif:${notifId}`, stringifiedData);
    multi.lpush(`user:${userId}:notifs`, notifId);
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

    if (!results) return [];

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

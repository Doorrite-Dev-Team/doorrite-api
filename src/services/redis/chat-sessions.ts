import { redis } from "@config/redis";

const SESSION_TTL = 2 * 60 * 60;

export const ChatSessionService = {
  async setUserOrderSession(userId: string, orderId: string) {
    const key = `chat:session:${userId}`;
    await redis.hset(key, {
      orderId,
      connectedAt: Date.now().toString(),
    });
    await redis.expire(key, SESSION_TTL);
  },

  async getUserOrderSession(userId: string): Promise<{ orderId?: string; connectedAt?: string } | null> {
    const key = `chat:session:${userId}`;
    const data = await redis.hgetall(key);
    if (!data || Object.keys(data).length === 0) return null;
    return data as { orderId: string; connectedAt: string };
  },

  async removeUserSession(userId: string) {
    const key = `chat:session:${userId}`;
    await redis.del(key);
  },

  async isUserInOrder(userId: string, orderId: string): Promise<boolean> {
    const session = await this.getUserOrderSession(userId);
    return session?.orderId === orderId;
  },
};

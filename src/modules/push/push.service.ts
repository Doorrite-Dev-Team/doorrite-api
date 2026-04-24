import webpush from "web-push";
import prisma from "@config/db";
import { getVapidPublicKey, getVapidPrivateKey, getVapidSubject } from "@lib/utils/vapid";

webpush.setVapidDetails(
  getVapidSubject(),
  getVapidPublicKey(),
  getVapidPrivateKey()
);

interface PushNotificationPayload {
  title: string;
  body?: string;
  tag?: string;
  data?: Record<string, any>;
  icon?: string;
}

export const pushService = {
  async subscribe(userId: string, userType: string, subscription: any) {
    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint: subscription.endpoint },
    });

    if (existing) {
      return existing;
    }

    return prisma.pushSubscription.create({
      data: {
        userId,
        userType,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh || "",
        auth: subscription.keys?.auth || "",
      },
    });
  },

  async unsubscribe(endpoint: string) {
    return prisma.pushSubscription.delete({
      where: { endpoint },
    });
  },

  async sendNotification(subscription: any, payload: PushNotificationPayload) {
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );
      return true;
    } catch (error: any) {
      if (error.statusCode === 410) {
        await this.unsubscribe(subscription.endpoint);
      }
      console.error("Push notification error:", error.message);
      return false;
    }
  },

  async sendToUser(userId: string, payload: PushNotificationPayload) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId, userType: "user" },
    });

    for (const sub of subscriptions) {
      await this.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    }
  },

  async sendToRider(riderId: string, payload: PushNotificationPayload) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: riderId, userType: "rider" },
    });

    for (const sub of subscriptions) {
      await this.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    }
  },

  async sendToVendor(vendorId: string, payload: PushNotificationPayload) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: vendorId, userType: "vendor" },
    });

    for (const sub of subscriptions) {
      await this.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    }
  },

  async sendToAllRiders(payload: PushNotificationPayload) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userType: "rider" },
    });

    for (const sub of subscriptions) {
      await this.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    }
  },

  async sendToAllVendors(payload: PushNotificationPayload) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userType: "vendor" },
    });

    for (const sub of subscriptions) {
      await this.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    }
  },
};
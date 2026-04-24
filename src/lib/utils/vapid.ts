import webPush from "web-push";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
  throw new Error("Missing VAPID environment variables");
}

webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

export const getVapidPublicKey = () => vapidPublicKey;
export const getVapidPrivateKey = () => vapidPrivateKey;
export const getVapidSubject = () => vapidSubject;

export { webPush };
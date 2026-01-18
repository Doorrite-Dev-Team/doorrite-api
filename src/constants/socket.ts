export enum AppSocketEvent {
  // Order Lifecycle
  ORDER_ACCEPTED = "order:accepted", //--vendor, user
  NEW_ORDER = "new:order",
  NOTIFICATION = "notification",

  // System
  SYSTEM = "system:alert",

  // Custom Internal (Optional but helpful)
  EXCEPTION = "exception",
  PENDING_NOTIFICATIONS = "notifications:pending",
}

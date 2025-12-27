// types/notification.ts

export type NotificationType =
  | "ORDER_PLACED"
  | "ORDER_ACCEPTED"
  | "ORDER_PREPARING"
  | "ORDER_OUT_FOR_DELIVERY"
  | "ORDER_DELIVERED"
  | "ORDER_CANCELLED"
  | "PROMOTION"
  | "NEW_RESTAURANT"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "DELIVERY_DELAYED"
  | "RATING_REQUEST"
  | "SYSTEM";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface NotificationMetadata {
  orderId?: string;
  vendorId?: string;
  promotionId?: string;
  deliveryTime?: string;
  amount?: number;
  actionUrl?: string;
  imageUrl?: string;
  [key: string]: any;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  timestamp: string; // ISO string
  expiresAt?: string; // ISO string
  metadata?: NotificationMetadata;
}

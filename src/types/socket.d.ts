import { Socket } from "socket.io";
import { JwtPayloadShape } from "@config/jwt";

declare module "socket.io" {
  interface Socket {
    user?: JwtPayloadShape;
  }
}

declare enum AppSocketEvent {
  // Order Lifecycle
  ORDER_PLACED = "order:placed",
  ORDER_ACCEPTED = "order:accepted",
  ORDER_PREPARING = "order:preparing",
  ORDER_OUT_FOR_DELIVERY = "order:shipping",
  ORDER_DELIVERED = "order:delivered",
  ORDER_CANCELLED = "order:cancelled",

  // Payment
  PAYMENT_SUCCESS = "payment:success",
  PAYMENT_FAILED = "payment:failed",

  // Logistics & Marketing
  DELIVERY_DELAYED = "delivery:delayed",
  PROMOTION = "marketing:promotion",
  NEW_RESTAURANT = "discovery:new-restaurant",
  RATING_REQUEST = "feedback:rating-request",

  // System
  SYSTEM = "system:alert",

  // Custom Internal (Optional but helpful)
  EXCEPTION = "exception",
  PENDING_NOTIFICATIONS = "notifications:pending",
}

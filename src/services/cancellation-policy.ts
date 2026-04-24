import { OrderStatus } from "../generated/prisma";

export interface CancellationRule {
  canCancel: boolean;
  fee: number;
  restoreStock: boolean;
  requireRefund: boolean;
  reason: string;
}

export class CancellationPolicyService {
  private static readonly CANCELLATION_FEE_DEFAULT = 1000;
  private static readonly CANCELLATION_FEE_PREPARING = 1500;
  private static readonly CANCELLATION_FEE_READY = 2000;

  private static readonly RULES: Record<OrderStatus, CancellationRule> = {
    PENDING_PAYMENT: { 
      canCancel: true, 
      fee: 0, 
      restoreStock: true, 
      requireRefund: false, 
      reason: "Order can be cancelled before payment" 
    },
    PENDING: { 
      canCancel: true, 
      fee: 0, 
      restoreStock: true, 
      requireRefund: false, 
      reason: "Order can be cancelled before vendor acceptance" 
    },
    SCHEDULED: { 
      canCancel: true, 
      fee: 0, 
      restoreStock: true, 
      requireRefund: false, 
      reason: "Order can be cancelled before scheduled time" 
    },
    ACCEPTED: { 
      canCancel: true, 
      fee: this.CANCELLATION_FEE_DEFAULT, 
      restoreStock: true, 
      requireRefund: true, 
      reason: "Order cancelled after vendor acceptance" 
    },
    PREPARING: { 
      canCancel: true, 
      fee: this.CANCELLATION_FEE_PREPARING, 
      restoreStock: false, 
      requireRefund: true, 
      reason: "Order cancelled during preparation" 
    },
    READY_FOR_PICKUP: { 
      canCancel: true, 
      fee: this.CANCELLATION_FEE_READY, 
      restoreStock: false, 
      requireRefund: true, 
      reason: "Order cancelled when ready for pickup" 
    },
    OUT_FOR_DELIVERY: { 
      canCancel: false, 
      fee: 0, 
      restoreStock: false, 
      requireRefund: false, 
      reason: "Order cannot be cancelled once out for delivery" 
    },
    DELIVERED: { 
      canCancel: false, 
      fee: 0, 
      restoreStock: false, 
      requireRefund: false, 
      reason: "Order cannot be cancelled after delivery" 
    },
    CANCELLED: { 
      canCancel: false, 
      fee: 0, 
      restoreStock: false, 
      requireRefund: false, 
      reason: "Order is already cancelled" 
    },
  };

  static getRule(status: OrderStatus): CancellationRule {
    const rule = this.RULES[status];
    if (!rule) {
      throw new Error(`No cancellation rule defined for status: ${status}`);
    }
    return rule;
  }

  static canCancel(status: OrderStatus): { allowed: boolean; reason: string } {
    const rule = this.getRule(status);
    return {
      allowed: rule.canCancel,
      reason: rule.reason,
    };
  }
}

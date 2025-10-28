// Re-export order module's payment handlers so payment routes remain compatible
export {
  createPaymentIntent,
  confirmPayment,
  checkPaymentStatus,
  processRefund,
} from "../order/controllers";

export enum OrderStatus {
  REQUESTED = 'REQUESTED',
  PRICED = 'PRICED',
  WAITING_FOR_DEPOSIT = 'WAITING_FOR_DEPOSIT',
  WAITING_FOR_FULL_PAYMENT = 'WAITING_FOR_FULL_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  ORDERED = 'ORDERED',
  READY_FOR_COLLECTION = 'READY_FOR_COLLECTION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export interface Order {
  id: string;
  ref: string;
  created_at: string;
  updated_at?: string;
  customer_name: string;
  phone: string;
  vehicle: string;
  part_description: string;
  price: number;
  delivery_fee: number;
  deposit_paid: number;
  payment_type: string;
  payment_requirement: string;
  order_type: string;
  status: OrderStatus;
  captured_by: string;
  message_timestamps: Record<string, number>;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  screenshot_url: string | null;
}

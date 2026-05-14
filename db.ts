import { supabase } from './lib/supabase';
import { Order, OrderStatus } from './types';

export const getOrders = async (): Promise<Order[]> => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to fetch orders', error);
    return [];
  }
  return (data as Order[]).map(normaliseOrder);
};

export const getAssistantOrders = async (capturedBy: string): Promise<Order[]> => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('captured_by', capturedBy)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to fetch assistant orders', error);
    return [];
  }
  return (data as Order[]).map(normaliseOrder);
};

export const appendOrder = async (
  order: Omit<Order, 'id' | 'ref' | 'created_at' | 'updated_at'>
): Promise<Order | null> => {
  const { data: refData, error: refError } = await supabase.rpc('next_order_ref');
  if (refError) {
    console.error('Failed to get order ref', refError);
    return null;
  }
  const payload = { ...order, ref: refData as string };
  const { data, error } = await supabase
    .from('orders')
    .insert(payload)
    .select()
    .single();
  if (error) {
    console.error('Failed to insert order', error);
    return null;
  }
  return normaliseOrder(data as Order);
};

export const updateOrderRecord = async (
  id: string,
  updates: Partial<Order>,
  role: 'assistant' | 'owner'
): Promise<Order | null> => {
  if (role === 'assistant') {
    if ('price' in updates) {
      const { data: current } = await supabase
        .from('orders')
        .select('price')
        .eq('id', id)
        .single();
      if (current && updates.price !== current.price) {
        alert('Permission Denied: You are not allowed to change the price.');
        delete updates.price;
      }
    }
    if (updates.status === OrderStatus.ORDERED) {
      alert('Permission Denied: Only the owner can mark as Ordered.');
      delete updates.status;
    }
  }
  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('Failed to update order', error);
    return null;
  }
  return normaliseOrder(data as Order);
};

// Ensures nullable fields have safe defaults after fetch
function normaliseOrder(o: Order): Order {
  return {
    ...o,
    phone: o.phone ?? '',
    vehicle: o.vehicle ?? '',
    price: o.price ?? 0,
    delivery_fee: o.delivery_fee ?? 0,
    deposit_paid: o.deposit_paid ?? 0,
    payment_type: o.payment_type ?? '',
    payment_requirement: o.payment_requirement ?? 'Deposit Required',
    order_type: o.order_type ?? 'Collection',
    message_timestamps: o.message_timestamps ?? {},
    refund_amount: o.refund_amount ?? null,
    refund_reason: o.refund_reason ?? null,
    refunded_at: o.refunded_at ?? null,
    screenshot_url: o.screenshot_url ?? null,
  };
}

// Upload screenshot to Supabase Storage, returns path or null
export const uploadScreenshot = async (blob: Blob): Promise<string | null> => {
  const path = `orders/${Date.now()}.jpg`;
  const { data, error } = await supabase.storage
    .from('screenshots')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    console.error('Screenshot upload failed', error);
    return null;
  }
  return data.path;
};

// Get a signed URL for a screenshot path (valid 1 hour)
export const getScreenshotUrl = async (path: string): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from('screenshots')
    .createSignedUrl(path, 3600);
  if (error) {
    console.error('Failed to get signed URL', error);
    return null;
  }
  return data.signedUrl;
};

// Date helpers
export const isThisWeek = (dateStr: string): boolean => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff);
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek && d <= now;
};

export const isThisMonth = (dateStr: string): boolean => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

export const isInMonth = (dateStr: string, year: number, month: number): boolean => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d.getMonth() === month && d.getFullYear() === year;
};

export const isToday = (dateStr: string): boolean => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
};

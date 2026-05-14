import { supabase } from '../lib/supabase';

interface MigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
}

export const migrateLocalStorageToSupabase = async (): Promise<MigrationResult> => {
  const result: MigrationResult = { migrated: 0, skipped: 0, failed: 0 };

  const raw = localStorage.getItem('auto_electrical_orders');
  if (!raw) return result;

  let items: any[];
  try {
    items = JSON.parse(raw);
  } catch {
    console.error('Could not parse localStorage orders');
    return result;
  }

  if (!Array.isArray(items) || items.length === 0) return result;

  for (const item of items) {
    try {
      // Handle both legacy tuple arrays and named objects
      let order: any;
      if (Array.isArray(item)) {
        // Legacy tuple format
        order = {
          ref: item[14] || `AE-LEGACY-${Date.now()}`,
          created_at: item[0] || new Date().toISOString(),
          customer_name: item[1] || 'Unknown',
          phone: item[2] || '',
          vehicle: item[3] || '',
          part_description: item[4] || '',
          price: item[5] || 0,
          delivery_fee: item[10] || 0,
          deposit_paid: item[6] || 0,
          payment_type: item[7] || '',
          payment_requirement: item[12] || 'Deposit Required',
          order_type: item[11] || 'Collection',
          status: item[8] || 'REQUESTED',
          captured_by: item[9] || 'assistant',
          message_timestamps: item[13] || {},
          refund_amount: item[15] || null,
          refund_reason: item[16] || null,
          refunded_at: item[17] || null,
          screenshot_url: null, // Do not migrate base64 screenshots
        };
      } else {
        // Already named object format
        order = { ...item, screenshot_url: null }; // Strip any base64
      }

      // Check if ref already exists
      const { data: existing } = await supabase
        .from('orders')
        .select('id')
        .eq('ref', order.ref)
        .single();

      if (existing) {
        result.skipped++;
        continue;
      }

      const { error } = await supabase.from('orders').insert(order);
      if (error) {
        console.error('Migration insert failed for ref', order.ref, error);
        result.failed++;
      } else {
        result.migrated++;
      }
    } catch (err) {
      console.error('Migration error for item', item, err);
      result.failed++;
    }
  }

  return result;
};

export const hasLocalStorageData = (): boolean => {
  const raw = localStorage.getItem('auto_electrical_orders');
  if (!raw) return false;
  try {
    const items = JSON.parse(raw);
    return Array.isArray(items) && items.length > 0;
  } catch {
    return false;
  }
};

export const clearLocalStorageData = () => {
  localStorage.removeItem('auto_electrical_orders');
  localStorage.removeItem('orderCount');
};

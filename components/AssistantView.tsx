import React, { useState, useEffect } from 'react';
import { Order, OrderStatus } from '../types';
import {
  appendOrder,
  getAssistantOrders,
  updateOrderRecord,
  isThisWeek,
  isThisMonth,
  isToday,
  isInMonth,
} from '../db';
import { generateReceiptPDF } from '../utils/generateReceipt';
import ImageUpload from './ImageUpload';
import ScreenshotModal from './ScreenshotModal';
import { supabase } from '../lib/supabase';

export default function AssistantView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [timeFilter, setTimeFilter] = useState<'today' | 'week' | 'month'>('week');
  const [viewingScreenshot, setViewingScreenshot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Capture forms — separate state for deposit vs balance
  const [capturingDepositFor, setCapturingDepositFor] = useState<string | null>(null);
  const [depositInput, setDepositInput] = useState('');
  const [depositPaymentMethod, setDepositPaymentMethod] = useState('Cash');

  const [capturingBalanceFor, setCapturingBalanceFor] = useState<string | null>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [balancePaymentMethod, setBalancePaymentMethod] = useState('Cash');

  // Refund form
  const [refundingOrder, setRefundingOrder] = useState<Order | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  // Edit order
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  // New request form state
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [partDescription, setPartDescription] = useState('');
  const [orderType, setOrderType] = useState('Collection');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [paymentRequirement, setPaymentRequirement] = useState('Deposit Required');
  const [screenshotPath, setScreenshotPath] = useState<string | undefined>(undefined);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadOrders = async () => {
    const data = await getAssistantOrders('assistant');
    setOrders(data);
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
    const channel = supabase
      .channel('assistant-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        loadOrders();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const sendWhatsApp = async (order: Order, msgType: string, text: string) => {
    if (!order.phone?.trim()) { alert('Please enter a valid phone number'); return; }
    let p = order.phone.replace(/\D/g, '');
    if (p.startsWith('0')) p = '27' + p.substring(1);
    else if (!p.startsWith('27')) p = '27' + p;
    if (p.length < 10) { alert('Please enter a valid phone number'); return; }
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, '_blank');
    const ts = { ...(order.message_timestamps ?? {}), [msgType]: Date.now() };
    await updateOrderRecord(order.id, { message_timestamps: ts }, 'assistant');
    loadOrders();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !vehicle || !partDescription) { alert('Please fill all required fields.'); return; }
    const newOrder: Omit<Order, 'id' | 'ref' | 'created_at' | 'updated_at'> = {
      customer_name: customerName, phone, vehicle, part_description: partDescription,
      price: 0, delivery_fee: orderType === 'Delivery' ? (parseFloat(deliveryFee) || 0) : 0,
      deposit_paid: 0, payment_type: '', payment_requirement: paymentRequirement,
      order_type: orderType, status: OrderStatus.REQUESTED, captured_by: 'assistant',
      message_timestamps: {}, refund_amount: null, refund_reason: null, refunded_at: null,
      screenshot_url: screenshotPath ?? null,
    };
    await appendOrder(newOrder);
    setCustomerName(''); setPhone(''); setVehicle(''); setPartDescription('');
    setOrderType('Collection'); setDeliveryFee(''); setPaymentRequirement('Deposit Required');
    setScreenshotPath(undefined); setShowNewForm(false);
    showToast('Request created');
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    await updateOrderRecord(editingOrder.id, {
      customer_name: customerName, phone, vehicle, part_description: partDescription,
      order_type: orderType,
      delivery_fee: orderType === 'Delivery' ? (parseFloat(deliveryFee) || 0) : editingOrder.delivery_fee,
    }, 'assistant');
    setEditingOrder(null); loadOrders(); showToast('Order updated');
  };

  const openEditForm = (order: Order) => {
    setEditingOrder(order);
    setCustomerName(order.customer_name); setPhone(order.phone); setVehicle(order.vehicle);
    setPartDescription(order.part_description); setOrderType(order.order_type);
    setDeliveryFee(String(order.delivery_fee || '')); setPaymentRequirement(order.payment_requirement);
  };

  const handleStatusChange = async (order: Order, newStatus: OrderStatus) => {
    await updateOrderRecord(order.id, { status: newStatus }, 'assistant');
    loadOrders();
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundingOrder) return;
    const amt = parseFloat(refundAmount);
    const total = (refundingOrder.price ?? 0) + (refundingOrder.delivery_fee ?? 0);
    if (isNaN(amt) || amt <= 0) { alert('Enter a valid refund amount.'); return; }
    if (amt > total) { alert('Refund cannot exceed order total.'); return; }
    if (!refundReason.trim()) { alert('Please enter a reason.'); return; }
    await updateOrderRecord(refundingOrder.id, {
      status: OrderStatus.REFUNDED, refund_amount: amt,
      refund_reason: refundReason, refunded_at: new Date().toISOString(),
    }, 'assistant');
    setRefundingOrder(null); setRefundAmount(''); setRefundReason('');
    loadOrders(); showToast('Refund recorded');
  };

  const inTimeFilter = (dateStr: string) => {
    if (timeFilter === 'today') return isToday(dateStr);
    if (timeFilter === 'week') return isThisWeek(dateStr);
    if (timeFilter === 'month') return isThisMonth(dateStr);
    return true;
  };

  const matchesSearch = (o: Order) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.customer_name?.toLowerCase().includes(q) ||
      o.phone?.toLowerCase().includes(q) ||
      o.vehicle?.toLowerCase().includes(q) ||
      o.part_description?.toLowerCase().includes(q) ||
      o.ref?.toLowerCase().includes(q)
    );
  };

  const completedAll = orders.filter(o => o.status === OrderStatus.COMPLETED || o.status === OrderStatus.REFUNDED);
  const grossSales = completedAll.filter(o => inTimeFilter(o.created_at)).reduce((s, o) => s + (o.price ?? 0) + (o.delivery_fee ?? 0), 0);
  const totalRefunds = orders.filter(o => o.status === OrderStatus.REFUNDED && o.refunded_at && inTimeFilter(o.refunded_at)).reduce((s, o) => s + (o.refund_amount ?? 0), 0);
  const netSales = grossSales - totalRefunds;

  const s1 = orders.filter(o => o.status === OrderStatus.REQUESTED && matchesSearch(o));
  const s2 = orders.filter(o => o.status === OrderStatus.PRICED && matchesSearch(o));
  const s3 = orders.filter(o => (o.status === OrderStatus.WAITING_FOR_DEPOSIT || o.status === OrderStatus.WAITING_FOR_FULL_PAYMENT) && matchesSearch(o));
  const s4 = orders.filter(o => [OrderStatus.CONFIRMED, OrderStatus.ORDERED].includes(o.status) && matchesSearch(o));
  const s5 = orders.filter(o => o.status === OrderStatus.READY_FOR_COLLECTION && matchesSearch(o));
  const s6 = orders.filter(o => o.status === OrderStatus.COMPLETED && inTimeFilter(o.created_at) && matchesSearch(o));
  const s7 = orders.filter(o => o.status === OrderStatus.REFUNDED && inTimeFilter(o.created_at) && matchesSearch(o));

  const infoCard = (order: Order) => (
    <div className="flex-1 flex flex-col gap-2">
      {order.ref && <div className="text-xs text-indigo-600 font-bold uppercase mb-1">Ref: {order.ref}</div>}
      <div className="text-2xl font-black text-gray-900">{order.customer_name}</div>
      {order.phone && <div className="text-sm font-bold text-gray-600">{order.phone}</div>}
      <div className="text-sm"><span className="font-bold text-gray-700">Vehicle:</span> {order.vehicle}</div>
      <div className="text-sm"><span className="font-bold text-gray-700">Part:</span> {order.part_description}</div>
      <div className="text-sm"><span className="font-bold text-gray-700">Type:</span> {order.order_type || 'Collection'}</div>
      {order.screenshot_url && (
        <button onClick={() => setViewingScreenshot(order.screenshot_url)} className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 bg-indigo-50 px-2 py-1.5 rounded-md w-max mt-1 border border-indigo-100">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          View Screenshot
        </button>
      )}
    </div>
  );

  const editBtn = (order: Order) => (
    <button onClick={() => openEditForm(order)} className="text-xs text-gray-500 hover:text-indigo-600 font-bold uppercase flex items-center gap-1 mt-1">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
      Edit Details
    </button>
  );

  const waBtnClass = (sent: boolean) => `w-full font-black py-4 rounded-xl shadow-md text-sm uppercase tracking-wider transition-colors ${sent ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'}`;

  const renderForm = (isEdit: boolean) => {
    const onSubmit = isEdit ? handleEditSubmit : handleSubmit;
    const title = isEdit ? 'Edit Order' : 'New Part Request';
    const onClose = isEdit ? () => setEditingOrder(null) : () => setShowNewForm(false);
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
          <div className="text-lg font-black uppercase tracking-wider text-gray-900 mb-6 border-b border-gray-100 pb-4 flex items-center justify-between">
            {title}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-gray-100 rounded-full p-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Customer Name *</label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required className="w-full p-4 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-600" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Phone Number</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-600" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Vehicle *</label>
              <input type="text" value={vehicle} onChange={e => setVehicle(e.target.value)} required className="w-full p-4 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-600" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Part Description *</label>
              <textarea value={partDescription} onChange={e => setPartDescription(e.target.value)} required rows={3} className="w-full p-4 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-600 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Order Type</label>
                <select value={orderType} onChange={e => setOrderType(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-green-600">
                  <option>Collection</option><option>Delivery</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Payment</label>
                <select value={paymentRequirement} onChange={e => setPaymentRequirement(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-green-600">
                  <option>Deposit Required</option><option>Full Payment Required</option>
                </select>
              </div>
            </div>
            {orderType === 'Delivery' && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Delivery Fee</label>
                <input type="number" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} className="w-full p-4 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-600" />
              </div>
            )}
            {!isEdit && <ImageUpload onImageSelected={setScreenshotPath} />}
            <button type="submit" className="w-full bg-green-600 text-white font-black py-4 rounded-xl text-lg hover:bg-green-700 uppercase tracking-wide">
              {isEdit ? 'Save Changes' : 'Create Request'}
            </button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-10 pb-16 pt-6 px-4">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full text-sm font-bold z-50 shadow-lg">{toastMsg}</div>
      )}

      {/* Top row */}
      <div className="flex flex-col md:flex-row gap-6">
        <button onClick={() => { setShowNewForm(true); setCustomerName(''); setPhone(''); setVehicle(''); setPartDescription(''); setOrderType('Collection'); setDeliveryFee(''); setPaymentRequirement('Deposit Required'); setScreenshotPath(undefined); }}
          className="flex-shrink-0 md:w-1/3 bg-green-600 hover:bg-green-700 text-white font-black py-6 rounded-2xl shadow-md text-xl uppercase tracking-wide flex items-center justify-center gap-2">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" /></svg>
          REQUEST PART
        </button>
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex bg-gray-100 rounded-lg p-1 w-full">
            {(['today','week','month'] as const).map(f => (
              <button key={f} onClick={() => setTimeFilter(f)} className={`flex-1 py-3 text-xs md:text-sm font-bold uppercase tracking-wider rounded-md transition-colors ${timeFilter === f ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:bg-gray-200'}`}>
                {f === 'today' ? 'Today' : f === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Gross Sales', val: `R ${grossSales.toFixed(2)}`, cls: 'text-gray-900' },
              { label: 'Refunds', val: `R ${totalRefunds.toFixed(2)}`, cls: 'text-red-600' },
              { label: 'Net Sales', val: `R ${netSales.toFixed(2)}`, cls: 'text-green-600' },
              { label: 'Orders', val: String(s6.length), cls: 'text-gray-900' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-col items-center text-center">
                <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider mb-2">{c.label}</span>
                <span className={`text-xl font-black ${c.cls}`}>{c.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      <div>
        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by customer, phone, vehicle, part, or ref..."
          className="w-full p-4 border border-gray-200 rounded-xl bg-white shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        {searchQuery && <p className="text-xs text-gray-500 mt-1 ml-1">Showing results for "{searchQuery}"</p>}
      </div>

      {loading && <div className="text-center text-gray-400 font-bold uppercase text-sm py-8">Loading orders...</div>}

      {/* Sections */}
      <div className="flex flex-col gap-12">
        {/* Section 1 */}
        <section>
          <h2 className="text-xl font-black text-blue-800 uppercase tracking-widest border-b-4 border-blue-800 pb-3 mb-6">1. Waiting For Price</h2>
          {s1.length > 0 ? s1.map(order => (
            <div key={order.id} className="bg-white rounded-2xl shadow-md border-l-8 border-blue-500 p-6 flex flex-col md:flex-row gap-6 mb-4">
              {infoCard(order)}
              <div className="md:w-72 flex flex-col gap-3 justify-center items-center bg-blue-50 rounded-xl p-4">
                <div className="text-blue-800 font-black text-center text-sm uppercase">Waiting for owner to provide price</div>
                {editBtn(order)}
                <button onClick={() => window.confirm('Cancel this order?') && handleStatusChange(order, OrderStatus.CANCELLED)} className="mt-2 w-full text-red-600 bg-white border border-red-200 hover:bg-red-50 font-bold py-3 rounded-xl text-xs uppercase">Cancel Order</button>
              </div>
            </div>
          )) : <div className="text-gray-400 font-bold uppercase text-sm bg-white p-6 rounded-2xl border border-dashed text-center">No requests waiting for price.</div>}
        </section>

        {/* Section 2 */}
        <section>
          <h2 className="text-xl font-black text-blue-600 uppercase tracking-widest border-b-4 border-blue-600 pb-3 mb-6">2. Ready To Send Quote</h2>
          {s2.length > 0 ? s2.map(order => {
            const total = (order.price ?? 0) + (order.delivery_fee ?? 0);
            const depositReq = order.payment_requirement === 'Full Payment Required' ? total : Math.round(total * 0.5);
            return (
              <div key={order.id} className="bg-white rounded-2xl shadow-md border-l-8 border-blue-400 p-6 flex flex-col md:flex-row gap-6 mb-4">
                {infoCard(order)}
                <div className="md:w-80 flex flex-col justify-center gap-3">
                  <div className="text-xl font-black">Price: R {order.price ?? 0}{order.delivery_fee ? ` + R ${order.delivery_fee} delivery` : ''}</div>
                  {editBtn(order)}
                  <button onClick={() => {
                    const msg = `Hi ${order.customer_name},\n\nYour quote is ready.\n\nRef: ${order.ref}\nPart: ${order.part_description}\nPrice: R ${order.price}${order.delivery_fee ? `\nDelivery: R ${order.delivery_fee}\nTotal: R ${total}` : ''}\nDeposit required: R ${depositReq}\n\nPlease confirm to proceed.\n\nThank you`;
                    sendWhatsApp(order, 'QUOTE', msg);
                  }} disabled={!!order.message_timestamps?.['QUOTE']} className={waBtnClass(!!order.message_timestamps?.['QUOTE'])}>
                    {order.message_timestamps?.['QUOTE'] ? 'Sent ✔' : 'Send Quote via WhatsApp'}
                  </button>
                  {order.message_timestamps?.['QUOTE'] && (
                    <button onClick={() => {
                      const msg = `Hi ${order.customer_name},\n\nYour quote is ready.\n\nRef: ${order.ref}\nPart: ${order.part_description}\nPrice: R ${order.price}${order.delivery_fee ? `\nDelivery: R ${order.delivery_fee}\nTotal: R ${total}` : ''}\nDeposit required: R ${depositReq}\n\nPlease confirm to proceed.\n\nThank you`;
                      const ts = { ...(order.message_timestamps ?? {}), ['QUOTE']: Date.now() };
                      updateOrderRecord(order.id, { message_timestamps: ts }, 'assistant').then(loadOrders);
                      let p = order.phone.replace(/\D/g, '');
                      if (p.startsWith('0')) p = '27' + p.substring(1);
                      window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
                    }} className="text-xs text-green-700 font-bold underline text-center">Resend</button>
                  )}
                  <button onClick={() => handleStatusChange(order, order.payment_requirement === 'Full Payment Required' ? OrderStatus.WAITING_FOR_FULL_PAYMENT : OrderStatus.WAITING_FOR_DEPOSIT)}
                    className="w-full border-2 border-orange-500 text-orange-600 hover:bg-orange-50 font-black py-3 rounded-xl text-xs uppercase">
                    {order.payment_requirement === 'Full Payment Required' ? 'Mark Accepted (Wait Full Payment)' : 'Mark Accepted (Wait Deposit)'}
                  </button>
                </div>
              </div>
            );
          }) : <div className="text-gray-400 font-bold uppercase text-sm bg-white p-6 rounded-2xl border border-dashed text-center">No quotes ready.</div>}
        </section>

        {/* Section 3 */}
        <section>
          <h2 className="text-xl font-black text-orange-600 uppercase tracking-widest border-b-4 border-orange-600 pb-3 mb-6">3. Waiting For Payment</h2>
          {s3.length > 0 ? s3.map(order => {
            const total = (order.price ?? 0) + (order.delivery_fee ?? 0);
            const isCapturing = capturingDepositFor === order.id;
            return (
              <div key={order.id} className="bg-white rounded-2xl shadow-md border-l-8 border-orange-500 p-6 flex flex-col md:flex-row gap-6 mb-4">
                {infoCard(order)}
                <div className="md:w-80 flex flex-col justify-center gap-3">
                  <div className="text-xl font-black">Total: R {total}</div>
                  <div className="text-orange-600 font-bold uppercase text-sm">{order.status === OrderStatus.WAITING_FOR_FULL_PAYMENT ? 'Waiting for Full Payment' : 'Waiting for Deposit'}</div>
                  {editBtn(order)}
                  <button onClick={() => {
                    const msg = `Hi ${order.customer_name},\n\nRef: ${order.ref}\nTotal: R ${total}\n\nPlease make payment and send proof.\n\nThank you`;
                    sendWhatsApp(order, 'PAYMENT_DETAILS', msg);
                  }} disabled={!!order.message_timestamps?.['PAYMENT_DETAILS']} className={waBtnClass(!!order.message_timestamps?.['PAYMENT_DETAILS'])}>
                    {order.message_timestamps?.['PAYMENT_DETAILS'] ? 'Sent ✔' : 'Send Payment Details (WhatsApp)'}
                  </button>
                  {isCapturing ? (
                    <div className="bg-orange-50 p-4 rounded-xl flex flex-col gap-3">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Amount Paid</label>
                        <input type="number" className="w-full p-2 border border-gray-300 rounded font-mono text-lg bg-white" value={depositInput} onChange={e => setDepositInput(e.target.value)} placeholder={`e.g. ${total}`} />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Payment Method</label>
                        <select value={depositPaymentMethod} onChange={e => setDepositPaymentMethod(e.target.value)} className="w-full p-2 border border-gray-300 rounded bg-white text-sm">
                          <option>Cash</option><option>Card</option><option>EFT</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          const d = parseFloat(depositInput);
                          if (isNaN(d) || d <= 0) return alert('Valid amount needed');
                          if (d > total) return alert('Amount cannot exceed total');
                          const newStatus = order.status === OrderStatus.WAITING_FOR_FULL_PAYMENT ? OrderStatus.COMPLETED : OrderStatus.CONFIRMED;
                          await updateOrderRecord(order.id, { deposit_paid: d, payment_type: depositPaymentMethod, status: newStatus }, 'assistant');
                          setCapturingDepositFor(null); setDepositInput(''); loadOrders();
                        }} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-lg text-xs uppercase">Save</button>
                        <button onClick={() => setCapturingDepositFor(null)} className="flex-1 bg-white border border-gray-300 font-bold py-3 rounded-lg text-xs uppercase text-gray-700">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setCapturingDepositFor(order.id); setDepositInput(''); }} className="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-4 rounded-xl shadow-md text-sm uppercase">
                      {order.status === OrderStatus.WAITING_FOR_FULL_PAYMENT ? 'Capture Full Payment' : 'Capture Deposit'}
                    </button>
                  )}
                  <button onClick={() => window.confirm('Cancel this order?') && handleStatusChange(order, OrderStatus.CANCELLED)} className="w-full text-red-600 border border-red-200 bg-white hover:bg-red-50 font-bold py-3 rounded-xl text-xs uppercase">Cancel Order</button>
                </div>
              </div>
            );
          }) : <div className="text-gray-400 font-bold uppercase text-sm bg-white p-6 rounded-2xl border border-dashed text-center">No orders waiting for payment.</div>}
        </section>

        {/* Section 4 */}
        <section>
          <h2 className="text-xl font-black text-purple-600 uppercase tracking-widest border-b-4 border-purple-600 pb-3 mb-6">4. Ordered (Waiting For Part)</h2>
          {s4.length > 0 ? s4.map(order => {
            const total = (order.price ?? 0) + (order.delivery_fee ?? 0);
            const balance = total - (order.deposit_paid ?? 0);
            return (
              <div key={order.id} className="bg-white rounded-2xl shadow-md border-l-8 border-purple-500 p-6 flex flex-col gap-4 mb-4">
                <div className="flex flex-col md:flex-row justify-between md:items-center">
                  <div>
                    {order.ref && <div className="text-xs text-indigo-600 font-bold uppercase mb-1">Ref: {order.ref}</div>}
                    <div className="text-2xl font-black text-gray-900">{order.customer_name}</div>
                    <div className="text-sm mt-1"><span className="font-bold">Part:</span> {order.part_description}</div>
                    <div className="text-purple-800 font-bold uppercase text-xs mt-3 bg-purple-50 inline-block px-3 py-1 rounded-md">Ordered — Waiting for part</div>
                  </div>
                  <div className="text-right mt-4 md:mt-0 flex flex-col gap-1 bg-gray-50 p-4 rounded-xl md:w-64">
                    <span className="text-sm font-bold text-gray-600 uppercase">Total: R {total}</span>
                    <span className="text-sm font-bold text-green-700 uppercase">Deposit: R {order.deposit_paid ?? 0}</span>
                    <span className="text-lg font-black text-gray-900 uppercase pt-2 border-t border-gray-200">Balance: R {balance}</span>
                  </div>
                </div>
              </div>
            );
          }) : <div className="text-gray-400 font-bold uppercase text-sm bg-white p-6 rounded-2xl border border-dashed text-center">No parts currently ordered.</div>}
        </section>

        {/* Section 5 */}
        <section>
          <h2 className="text-xl font-black text-green-600 uppercase tracking-widest border-b-4 border-green-600 pb-3 mb-6">5. Ready For Collection</h2>
          {s5.length > 0 ? s5.map(order => {
            const total = (order.price ?? 0) + (order.delivery_fee ?? 0);
            const balance = total - (order.deposit_paid ?? 0);
            const isCapturing = capturingBalanceFor === order.id;
            return (
              <div key={order.id} className="bg-white rounded-2xl shadow-md border-l-8 border-green-500 p-6 flex flex-col md:flex-row gap-6 mb-4">
                {infoCard(order)}
                <div className="md:w-80 flex flex-col justify-center gap-3">
                  <div className="text-sm font-bold text-gray-600">Total: R {total} | Deposit: R {order.deposit_paid ?? 0}</div>
                  <div className="bg-green-50 p-4 rounded-xl"><div className="text-xl font-black text-green-700 uppercase">Balance: R {balance}</div></div>
                  <button onClick={() => {
                    const msg = `Hi ${order.customer_name},\n\nYour part is ready.\n\nRef: ${order.ref}\nOutstanding: R ${balance}\n\nPlease collect.\n\nThank you`;
                    sendWhatsApp(order, 'NOTIFY_READY', msg);
                  }} disabled={!!order.message_timestamps?.['NOTIFY_READY']} className={`w-full font-black py-3 rounded-xl text-xs uppercase tracking-wider border-2 ${order.message_timestamps?.['NOTIFY_READY'] ? 'bg-gray-200 border-gray-300 text-gray-500 cursor-not-allowed' : 'bg-white border-green-600 text-green-700 hover:bg-green-50'}`}>
                    {order.message_timestamps?.['NOTIFY_READY'] ? 'Sent ✔' : 'Notify Customer (WhatsApp)'}
                  </button>
                  {balance > 0 ? (
                    isCapturing ? (
                      <div className="bg-blue-50 p-4 rounded-xl flex flex-col gap-3">
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Final Payment</label>
                          <input type="number" className="w-full p-2 border border-gray-300 rounded font-mono text-lg bg-white" value={balanceInput} onChange={e => setBalanceInput(e.target.value)} placeholder={`e.g. ${balance}`} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Payment Method</label>
                          <select value={balancePaymentMethod} onChange={e => setBalancePaymentMethod(e.target.value)} className="w-full p-2 border border-gray-300 rounded bg-white text-sm">
                            <option>Cash</option><option>Card</option><option>EFT</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async () => {
                            const d = parseFloat(balanceInput);
                            if (isNaN(d) || d < 0) return alert('Valid amount needed');
                            if (d > balance) return alert('Cannot exceed balance');
                            const newDeposit = (order.deposit_paid ?? 0) + d;
                            await updateOrderRecord(order.id, { deposit_paid: newDeposit, payment_type: balancePaymentMethod }, 'assistant');
                            setCapturingBalanceFor(null); setBalanceInput(''); loadOrders();
                          }} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg text-xs uppercase">Save</button>
                          <button onClick={() => setCapturingBalanceFor(null)} className="flex-1 bg-white border border-gray-300 font-bold py-3 rounded-lg text-xs uppercase text-gray-700">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setCapturingBalanceFor(order.id); setBalanceInput(String(balance)); }} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl shadow-md text-sm uppercase">Capture Final Payment</button>
                    )
                  ) : (
                    <button onClick={() => handleStatusChange(order, OrderStatus.COMPLETED)} className="w-full bg-gray-900 hover:bg-black text-white font-black py-4 rounded-xl shadow-md text-sm uppercase">Mark as Completed</button>
                  )}
                </div>
              </div>
            );
          }) : <div className="text-gray-400 font-bold uppercase text-sm bg-white p-6 rounded-2xl border border-dashed text-center">No parts ready for collection.</div>}
        </section>

        {/* Section 6 — Completed */}
        <section>
          <h2 className="text-xl font-black text-gray-800 uppercase tracking-widest border-b-4 border-gray-800 pb-3 mb-6">6. Completed</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Date','Customer','Part','Amount','Actions'].map(h => <th key={h} className="px-4 py-3 font-bold text-gray-600 uppercase">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {s6.map(order => (
                  <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">{new Date(order.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">{order.customer_name}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{order.part_description}</td>
                    <td className="px-4 py-3 font-black text-green-700">R {(order.price ?? 0) + (order.delivery_fee ?? 0)}</td>
                    <td className="px-4 py-3 flex flex-wrap gap-3">
                      <button onClick={() => setRefundingOrder(order)} className="text-red-600 text-xs font-bold uppercase hover:underline">Issue Refund</button>
                      <button onClick={() => { generateReceiptPDF(order); const ts = { ...(order.message_timestamps ?? {}), RECEIPT_PDF: Date.now() }; updateOrderRecord(order.id, { message_timestamps: ts }, 'assistant').then(loadOrders); }} className="text-indigo-600 text-xs font-bold uppercase hover:underline">PDF Receipt</button>
                      <button onClick={() => {
                        const total = (order.price ?? 0) + (order.delivery_fee ?? 0);
                        sendWhatsApp(order, 'RECEIPT', `Hi ${order.customer_name},\n\nThank you for your purchase.\n\nRef: ${order.ref}\nTotal Paid: R ${total}\n\nWe appreciate your support.`);
                      }} disabled={!!order.message_timestamps?.['RECEIPT']} className={`${order.message_timestamps?.['RECEIPT'] ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600 hover:underline'} text-xs font-bold uppercase`}>
                        {order.message_timestamps?.['RECEIPT'] ? 'Receipt Sent ✔' : 'Send WhatsApp'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s6.length === 0 && <div className="p-8 text-center text-gray-400 font-bold uppercase text-xs">No completed orders yet</div>}
          </div>
        </section>

        {/* Section 7 — Refunded */}
        <section>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-widest border-b-4 border-red-600 pb-3 mb-6">7. Refunded</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-red-50 border-b border-red-200">
                <tr>{['Date','Customer','Reason','Refunded'].map(h => <th key={h} className="px-4 py-3 font-bold text-red-800 uppercase">{h}</th>)}</tr>
              </thead>
              <tbody>
                {s7.map(order => (
                  <tr key={order.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-gray-500">{new Date(order.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">{order.customer_name}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[200px]">{order.refund_reason}</td>
                    <td className="px-4 py-3 font-black text-red-600">R {order.refund_amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s7.length === 0 && <div className="p-8 text-center text-gray-400 font-bold uppercase text-xs">No refunded orders</div>}
          </div>
        </section>
      </div>

      {/* Modals */}
      {showNewForm && renderForm(false)}
      {editingOrder && renderForm(true)}

      {refundingOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h3 className="text-lg font-black uppercase mb-4">Issue Refund</h3>
            <p className="text-sm text-gray-500 mb-4">Order total: <strong>R {(refundingOrder.price ?? 0) + (refundingOrder.delivery_fee ?? 0)}</strong></p>
            <form onSubmit={handleRefundSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Refund Amount (R)</label>
                <input type="number" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} defaultValue={String(refundingOrder.deposit_paid ?? 0)} className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Reason *</label>
                <input type="text" value={refundReason} onChange={e => setRefundReason(e.target.value)} required placeholder="e.g. Part unavailable" className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div className="flex gap-3">
                <button type="submit" className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-3 rounded-xl uppercase text-sm">Confirm Refund</button>
                <button type="button" onClick={() => setRefundingOrder(null)} className="flex-1 bg-white border border-gray-300 font-bold py-3 rounded-xl uppercase text-sm text-gray-700">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingScreenshot && <ScreenshotModal screenshotPath={viewingScreenshot} onClose={() => setViewingScreenshot(null)} />}
    </div>
  );
}

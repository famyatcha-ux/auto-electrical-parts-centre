import React, { useState, useEffect, useRef } from 'react';
import { Order, OrderStatus } from '../types';
import { appendOrder, getOrders, updateOrderRecord, isThisWeek, isThisMonth, isToday, isInMonth } from '../db';
import { generateReceiptPDF, getBusinessSettings, saveBusinessSettings } from '../utils/generateReceipt';
import ImageUpload from './ImageUpload';
import ScreenshotModal from './ScreenshotModal';
import { supabase } from '../lib/supabase';
import { migrateLocalStorageToSupabase, hasLocalStorageData, clearLocalStorageData } from '../utils/migrateToSupabase';

type DateFilter = 'today' | 'this-week' | 'this-month';
type ViewFilter = 'all' | 'requests' | 'accepted' | 'ordered' | 'collection' | 'completed' | 'refunded' | 'assistant' | 'owner';

const getLast12Months = () => {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
      year: d.getFullYear(),
      month: d.getMonth(),
    });
  }
  return months;
};

export default function OwnerView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<ViewFilter>('requests');
  const [dateFilter, setDateFilter] = useState<DateFilter>('this-week');
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [deliveryInput, setDeliveryInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentScreen, setCurrentScreen] = useState<'list' | 'quick-sale'>('list');
  const [viewingScreenshot, setViewingScreenshot] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{ migrated: number; skipped: number; failed: number } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [hasLocalData, setHasLocalData] = useState(false);
  const hasAutoSwitched = useRef(false);
  const monthList = getLast12Months();
  const selectedMonth = monthList[selectedMonthIdx];

  // Business settings form
  const bs = getBusinessSettings();
  const [bizName, setBizName] = useState(bs.businessName);
  const [bizAddress, setBizAddress] = useState(bs.address);
  const [bizPhone, setBizPhone] = useState(bs.phone);
  const [bizEmail, setBizEmail] = useState(bs.email);

  // Quick sale form
  const [quickCustomer, setQuickCustomer] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickPart, setQuickPart] = useState('');
  const [quickType, setQuickType] = useState('Collection');
  const [quickPaymentReq, setQuickPaymentReq] = useState('Deposit Required');
  const [quickPrice, setQuickPrice] = useState('');
  const [quickDelivery, setQuickDelivery] = useState('');
  const [quickDeposit, setQuickDeposit] = useState('');
  const [quickPaymentType, setQuickPaymentType] = useState('Cash');
  const [screenshotPath, setScreenshotPath] = useState<string | undefined>(undefined);

  // Refund modal
  const [refundingOrder, setRefundingOrder] = useState<Order | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 3000); };

  const loadOrders = async () => {
    const data = await getOrders();
    setOrders(data);
    setLoading(false);
    if (!hasAutoSwitched.current) {
      if (data.some(o => o.status === OrderStatus.REQUESTED)) setViewFilter('requests');
      hasAutoSwitched.current = true;
    }
  };

  useEffect(() => {
    loadOrders();
    setHasLocalData(hasLocalStorageData());
    const channel = supabase
      .channel('owner-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Stats date filter — only for completed/refunded calculations
  const inStatsFilter = (dateStr: string) => {
    if (!dateStr) return false;
    if (dateFilter === 'today') return isToday(dateStr);
    if (dateFilter === 'this-week') return isThisWeek(dateStr);
    if (dateFilter === 'this-month') return isInMonth(dateStr, selectedMonth.year, selectedMonth.month);
    return true;
  };

  const completedFiltered = orders.filter(o => (o.status === OrderStatus.COMPLETED || o.status === OrderStatus.REFUNDED) && inStatsFilter(o.created_at));
  const refundsFiltered = orders.filter(o => o.status === OrderStatus.REFUNDED && o.refunded_at && inStatsFilter(o.refunded_at));

  const periodGross = completedFiltered.reduce((a, o) => a + (o.price ?? 0) + (o.delivery_fee ?? 0), 0);
  const periodRefunds = refundsFiltered.reduce((a, o) => a + (o.refund_amount ?? 0), 0);
  const periodSales = periodGross - periodRefunds;

  const assistantGross = completedFiltered.filter(o => o.captured_by === 'assistant').reduce((a, o) => a + (o.price ?? 0) + (o.delivery_fee ?? 0), 0);
  const assistantRefunds = refundsFiltered.filter(o => o.captured_by === 'assistant').reduce((a, o) => a + (o.refund_amount ?? 0), 0);
  const assistantSales = assistantGross - assistantRefunds;

  const ownerGross = completedFiltered.filter(o => o.captured_by === 'owner').reduce((a, o) => a + (o.price ?? 0) + (o.delivery_fee ?? 0), 0);
  const ownerRefunds = refundsFiltered.filter(o => o.captured_by === 'owner').reduce((a, o) => a + (o.refund_amount ?? 0), 0);
  const ownerSales = ownerGross - ownerRefunds;

  // Outstanding — always unfiltered
  const outstanding = orders
    .filter(o => [OrderStatus.PRICED, OrderStatus.CONFIRMED, OrderStatus.WAITING_FOR_DEPOSIT, OrderStatus.WAITING_FOR_FULL_PAYMENT, OrderStatus.ORDERED, OrderStatus.READY_FOR_COLLECTION].includes(o.status))
    .reduce((a, o) => a + ((o.price ?? 0) + (o.delivery_fee ?? 0) - (o.deposit_paid ?? 0)), 0);

  // Action counts — always unfiltered
  const requestsCount = orders.filter(o => o.status === OrderStatus.REQUESTED).length;
  const readyToOrderCount = orders.filter(o => o.status === OrderStatus.CONFIRMED).length;
  const collectionCount = orders.filter(o => o.status === OrderStatus.READY_FOR_COLLECTION).length;

  const matchesSearch = (o: Order) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (o.customer_name?.toLowerCase().includes(q) || o.phone?.toLowerCase().includes(q) || o.vehicle?.toLowerCase().includes(q) || o.part_description?.toLowerCase().includes(q) || o.ref?.toLowerCase().includes(q));
  };

  // Workflow list filters — NOT date filtered for active statuses
  const filteredOrders = orders.filter(o => {
    if (!matchesSearch(o)) return false;
    if (viewFilter === 'requests') return o.status === OrderStatus.REQUESTED;
    if (viewFilter === 'accepted') return [OrderStatus.PRICED, OrderStatus.CONFIRMED, OrderStatus.WAITING_FOR_DEPOSIT, OrderStatus.WAITING_FOR_FULL_PAYMENT].includes(o.status);
    if (viewFilter === 'ordered') return o.status === OrderStatus.ORDERED;
    if (viewFilter === 'collection') return o.status === OrderStatus.READY_FOR_COLLECTION;
    // For completed/refunded/sales views, apply date filter
    if (viewFilter === 'completed') return o.status === OrderStatus.COMPLETED && inStatsFilter(o.created_at);
    if (viewFilter === 'refunded') return o.status === OrderStatus.REFUNDED && inStatsFilter(o.created_at);
    if (viewFilter === 'assistant') return o.captured_by === 'assistant' && (o.status === OrderStatus.COMPLETED || o.status === OrderStatus.REFUNDED) && inStatsFilter(o.created_at);
    if (viewFilter === 'owner') return o.captured_by === 'owner' && (o.status === OrderStatus.COMPLETED || o.status === OrderStatus.REFUNDED) && inStatsFilter(o.created_at);
    if (viewFilter === 'all') return true;
    return true;
  });

  const selectedOrder = selectedOrderId ? orders.find(o => o.id === selectedOrderId) : null;

  useEffect(() => {
    if (selectedOrder) {
      setPriceInput(selectedOrder.price > 0 ? String(selectedOrder.price) : '');
      setDeliveryInput(selectedOrder.delivery_fee > 0 ? String(selectedOrder.delivery_fee) : '');
    }
  }, [selectedOrderId]);

  const handleSetPrice = async (order: Order) => {
    const price = parseFloat(priceInput);
    const delivery = parseFloat(deliveryInput) || 0;
    if (isNaN(price) || price < 0) { alert('Enter a valid price.'); return; }
    const newStatus = order.status === OrderStatus.REQUESTED ? OrderStatus.PRICED : order.status;
    await updateOrderRecord(order.id, { price, delivery_fee: delivery, status: newStatus }, 'owner');
    setPriceInput(''); setDeliveryInput(''); loadOrders(); showToast('Price saved');
  };

  const handleStatusChange = async (order: Order, status: OrderStatus) => {
    await updateOrderRecord(order.id, { status }, 'owner');
    loadOrders();
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundingOrder) return;
    const amt = parseFloat(refundAmount);
    const total = (refundingOrder.price ?? 0) + (refundingOrder.delivery_fee ?? 0);
    if (isNaN(amt) || amt <= 0) { alert('Enter a valid amount.'); return; }
    if (amt > total) { alert('Cannot exceed total.'); return; }
    if (!refundReason.trim()) { alert('Enter a reason.'); return; }
    await updateOrderRecord(refundingOrder.id, { status: OrderStatus.REFUNDED, refund_amount: amt, refund_reason: refundReason, refunded_at: new Date().toISOString() }, 'owner');
    setRefundingOrder(null); setRefundAmount(''); setRefundReason(''); loadOrders(); showToast('Refund recorded');
  };

  const handleQuickSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCustomer || !quickPart || !quickPrice) { alert('Fill required fields.'); return; }
    const priceNum = parseFloat(quickPrice);
    const deliveryNum = parseFloat(quickDelivery) || 0;
    const total = priceNum + deliveryNum;
    const depositNum = Math.min(parseFloat(quickDeposit) || 0, total);
    const status = depositNum >= total ? OrderStatus.COMPLETED : (quickPaymentReq === 'Full Payment Required' ? OrderStatus.WAITING_FOR_FULL_PAYMENT : OrderStatus.ORDERED);
    await appendOrder({
      customer_name: quickCustomer, phone: quickPhone, vehicle: '', part_description: quickPart,
      price: priceNum, delivery_fee: quickType === 'Delivery' ? deliveryNum : 0, deposit_paid: depositNum,
      payment_type: quickPaymentType, payment_requirement: quickPaymentReq, order_type: quickType,
      status, captured_by: 'owner', message_timestamps: {},
      refund_amount: null, refund_reason: null, refunded_at: null,
      screenshot_url: screenshotPath ?? null,
    });
    setQuickCustomer(''); setQuickPhone(''); setQuickPart(''); setQuickType('Collection');
    setQuickPaymentReq('Deposit Required'); setQuickPrice(''); setQuickDelivery(''); setQuickDeposit(''); setScreenshotPath(undefined);
    setCurrentScreen('list'); loadOrders(); showToast('Sale recorded');
  };

  const statusBadge = (status: OrderStatus) => {
    const base = 'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide inline-block';
    const map: Record<string, string> = {
      [OrderStatus.REQUESTED]: 'bg-yellow-100 text-yellow-900', [OrderStatus.PRICED]: 'bg-blue-100 text-blue-900',
      [OrderStatus.CONFIRMED]: 'bg-purple-100 text-purple-900', [OrderStatus.WAITING_FOR_DEPOSIT]: 'bg-indigo-100 text-indigo-900',
      [OrderStatus.WAITING_FOR_FULL_PAYMENT]: 'bg-pink-100 text-pink-900', [OrderStatus.ORDERED]: 'bg-orange-100 text-orange-900',
      [OrderStatus.READY_FOR_COLLECTION]: 'bg-teal-100 text-teal-900', [OrderStatus.COMPLETED]: 'bg-green-100 text-green-900',
      [OrderStatus.CANCELLED]: 'bg-red-100 text-red-900', [OrderStatus.REFUNDED]: 'bg-red-600 text-white',
    };
    const statusLabel: Record<string, string> = { [OrderStatus.REQUESTED]: 'WAITING', [OrderStatus.CONFIRMED]: 'DEPOSIT PAID', [OrderStatus.WAITING_FOR_DEPOSIT]: 'AWAITING DEPOSIT' };
    return <span className={`${base} ${map[status] || base}`}>{statusLabel[status] || status.replace(/_/g, ' ')}</span>;
  };

  const statCardLabel = () => {
    if (dateFilter === 'today') return "Today's";
    if (dateFilter === 'this-week') return "This Week's";
    return selectedMonth.label;
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 h-full">
      {toastMsg && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full text-sm font-bold z-50 shadow-lg">{toastMsg}</div>}

      {/* Date Filter */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 bg-gray-100 p-1.5 rounded-xl">
          {(['today','this-week','this-month'] as DateFilter[]).map(f => (
            <button key={f} onClick={() => setDateFilter(f)} className={`flex-1 md:flex-none px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-lg transition-all ${dateFilter === f ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:bg-gray-200'}`}>
              {f === 'today' ? 'TODAY' : f === 'this-week' ? 'THIS WEEK' : 'THIS MONTH'}
            </button>
          ))}
        </div>
        {dateFilter === 'this-month' && (
          <select value={selectedMonthIdx} onChange={e => setSelectedMonthIdx(Number(e.target.value))} className="w-full md:w-64 p-3 border border-gray-200 rounded-lg bg-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
            {monthList.map((m, i) => <option key={i} value={i}>{m.label}</option>)}
          </select>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: `${statCardLabel()} Total Sales (Net)`, val: periodSales, sub: [{ l: 'Gross', v: periodGross, cls: 'text-gray-900' }, { l: 'Refunds', v: periodRefunds, cls: 'text-red-600' }], valCls: 'text-green-600' },
          { label: 'Assistant Sales (Net)', val: assistantSales, sub: [{ l: 'Gross', v: assistantGross, cls: 'text-gray-900' }, { l: 'Refunds', v: assistantRefunds, cls: 'text-red-600' }], valCls: 'text-gray-900' },
          { label: 'My Sales (Net)', val: ownerSales, sub: [{ l: 'Gross', v: ownerGross, cls: 'text-gray-900' }, { l: 'Refunds', v: ownerRefunds, cls: 'text-red-600' }], valCls: 'text-gray-900' },
          { label: 'Outstanding', val: outstanding, sub: [], valCls: 'text-orange-600' },
        ].map(c => (
          <div key={c.label} className="bg-white p-4 xl:p-5 rounded-lg shadow-sm border border-gray-200 flex flex-col">
            <div className="text-[10px] xl:text-[11px] text-gray-500 font-bold uppercase tracking-wider mb-1">{c.label}</div>
            <div className={`text-xl md:text-2xl lg:text-3xl font-black mb-2 truncate ${c.valCls}`}>R {c.val.toFixed(2)}</div>
            {c.sub.length > 0 && (
              <div className="flex flex-col gap-1 text-[10px] xl:text-xs pt-2 border-t border-gray-100 mt-auto">
                {c.sub.map(s => (
                  <div key={s.l} className="flex items-center text-gray-500">
                    <span className="w-12 xl:w-16 shrink-0">{s.l}:</span>
                    <span className={`font-bold truncate ${s.cls}`}>R {s.v.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => setCurrentScreen('quick-sale')} className="w-full h-16 bg-[#22c55e] text-white font-bold text-lg rounded-xl shadow-sm hover:bg-[#16a34a] uppercase tracking-widest">
        New Sale (Cash / Card / EFT)
      </button>

      {/* Search */}
      <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
        placeholder="Search by customer, phone, vehicle, part, or ref..."
        className="w-full p-4 border border-gray-200 rounded-xl bg-white shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />

      {/* Action Alerts — always unfiltered */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
        <h3 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2 text-slate-600">
          What Needs My Action
          {(requestsCount > 0 || readyToOrderCount > 0 || collectionCount > 0) && <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />}
        </h3>
        <div className="flex flex-col lg:flex-row gap-6">
          {[
            { label: 'Requests waiting for price', count: requestsCount, filter: 'requests' as ViewFilter, color: 'blue' },
            { label: 'Orders ready to order', count: readyToOrderCount, filter: 'accepted' as ViewFilter, color: 'purple' },
            { label: 'Ready for collection', count: collectionCount, filter: 'collection' as ViewFilter, color: 'green' },
          ].map(a => (
            <button key={a.label} onClick={() => { setCurrentScreen('list'); setViewFilter(a.filter); }} className={`border rounded-2xl text-left p-5 md:p-6 flex items-center justify-between flex-1 transition-all ${a.count > 0 ? `bg-${a.color}-50/50 border-${a.color}-500 border-l-[6px] border-l-${a.color}-600 shadow-md` : `bg-white border-slate-200 border-l-[6px] border-l-${a.color}-600 opacity-60`}`}>
              <span className={`block text-xl xl:text-2xl font-black leading-tight text-${a.color}-${a.count > 0 ? '700' : '600'}`}>{a.label}</span>
              <span className={`shrink-0 rounded-full text-xl font-black flex items-center justify-center min-w-[48px] h-[48px] px-3 bg-${a.color}-600 text-white shadow-sm`}>{a.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Nav Buttons */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          {[
            { f: 'requests', label: 'PRICE REQUESTS', color: 'bg-blue-600 ring-blue-400' },
            { f: 'accepted', label: 'ACCEPTED (WAITING DEPOSIT)', color: 'bg-orange-500 ring-orange-400' },
            { f: 'ordered', label: 'ORDERED (WITH SUPPLIER)', color: 'bg-purple-600 ring-purple-400' },
            { f: 'collection', label: 'READY FOR COLLECTION', color: 'bg-green-600 ring-green-400' },
            { f: 'completed', label: 'COMPLETED', color: 'bg-gray-700 ring-gray-400' },
          ].map(b => (
            <button key={b.f} onClick={() => { setCurrentScreen('list'); setViewFilter(b.f as ViewFilter); }}
              className={`flex-1 py-4 md:py-5 text-xs md:text-sm lg:text-base font-black uppercase tracking-wider rounded-xl transition-all text-white ${b.color.split(' ')[0]} ${currentScreen === 'list' && viewFilter === b.f ? `opacity-100 shadow-md ring-2 ring-offset-2 ${b.color.split(' ')[1]}` : 'opacity-80 hover:opacity-100'}`}>
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {[
            { f: 'all', label: 'ALL ORDERS', activeClass: 'bg-gray-900 text-white border-gray-900', inactiveClass: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' },
            { f: 'refunded', label: 'REFUNDED', activeClass: 'bg-red-600 text-white border-red-600', inactiveClass: 'bg-white text-red-700 border-red-200 hover:bg-red-50' },
            { f: 'assistant', label: 'ASSISTANT SALES', activeClass: 'bg-indigo-600 text-white border-indigo-600', inactiveClass: 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50' },
            { f: 'owner', label: 'MY SALES', activeClass: 'bg-gray-900 text-white border-gray-900', inactiveClass: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' },
          ].map(b => (
            <button key={b.f} onClick={() => { setCurrentScreen('list'); setViewFilter(b.f as ViewFilter); }}
              className={`flex-1 py-3 rounded-lg text-xs font-bold transition-colors border ${currentScreen === 'list' && viewFilter === b.f ? b.activeClass : b.inactiveClass}`}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Sale */}
      {currentScreen === 'quick-sale' ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 w-full max-w-2xl mx-auto">
          <div className="text-sm font-bold uppercase tracking-wider text-gray-800 mb-6 border-b border-gray-100 pb-4 flex justify-between items-center">
            New Sale
            <button onClick={() => setCurrentScreen('list')} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <form onSubmit={handleQuickSale} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Customer Name *</label><input type="text" value={quickCustomer} onChange={e => setQuickCustomer(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-gray-900" /></div>
              <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Phone</label><input type="text" value={quickPhone} onChange={e => setQuickPhone(e.target.value)} className="w-full p-3 border border-gray-300 rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-gray-900" /></div>
            </div>
            <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Part Description *</label><textarea value={quickPart} onChange={e => setQuickPart(e.target.value)} required rows={2} className="w-full p-3 border border-gray-300 rounded-md text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-gray-900" /></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Price (R) *</label><input type="number" value={quickPrice} onChange={e => setQuickPrice(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" /></div>
              <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Order Type</label><select value={quickType} onChange={e => setQuickType(e.target.value)} className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900"><option>Collection</option><option>Delivery</option></select></div>
              {quickType === 'Delivery' && <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Delivery Fee</label><input type="number" value={quickDelivery} onChange={e => setQuickDelivery(e.target.value)} className="w-full p-3 border border-gray-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" /></div>}
              <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Deposit Paid</label><input type="number" value={quickDeposit} onChange={e => setQuickDeposit(e.target.value)} className="w-full p-3 border border-gray-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" /></div>
              <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Payment Method</label><select value={quickPaymentType} onChange={e => setQuickPaymentType(e.target.value)} className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900"><option>Cash</option><option>Card</option><option>EFT</option></select></div>
              <div><label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Payment Req.</label><select value={quickPaymentReq} onChange={e => setQuickPaymentReq(e.target.value)} className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900"><option>Deposit Required</option><option>Full Payment Required</option></select></div>
            </div>
            <ImageUpload onImageSelected={setScreenshotPath} />
            <button type="submit" className="w-full bg-green-600 text-white font-bold py-3.5 rounded-md uppercase tracking-wider hover:bg-green-700">Complete Quick Sale</button>
          </form>
        </div>
      ) : (
        /* Split layout */
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg flex flex-1 overflow-hidden min-h-[500px]">
          {/* Left list */}
          <div className="w-1/2 border-r border-gray-200 flex flex-col bg-gray-50">
            <div className="p-4 border-b border-gray-200 bg-white flex justify-between items-center">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-800">{viewFilter.replace(/_/g,' ')} ({filteredOrders.length})</h2>
              {['all','completed','assistant','owner'].includes(viewFilter) && (
                <span className="font-mono font-bold text-gray-900">R {filteredOrders.reduce((s, o) => s + (o.price ?? 0) + (o.delivery_fee ?? 0), 0).toFixed(2)}</span>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">No orders found.</div>
              ) : filteredOrders.map(order => (
                <div key={order.id} onClick={() => setSelectedOrderId(order.id)}
                  className={`p-4 border-b border-gray-200 cursor-pointer transition-colors ${selectedOrderId === order.id ? 'bg-blue-50/50 border-l-4 border-l-blue-600' : 'bg-white hover:bg-gray-50 border-l-4 border-l-transparent'}`}>
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-bold text-gray-900 text-lg">
                      {order.ref && <span className="text-xs font-mono bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded mr-2 align-middle">{order.ref}</span>}
                      {order.customer_name}
                    </div>
                    {statusBadge(order.status)}
                  </div>
                  <div className="text-xs font-semibold text-gray-400 mb-1 uppercase">By {order.captured_by}</div>
                  <div className="flex justify-between items-end">
                    <div className="text-gray-600 text-sm"><span className="font-semibold text-gray-800">{order.vehicle}</span><br />{order.part_description}</div>
                    <div className="flex flex-col items-end">
                      <div className="text-[10px] text-gray-500 font-bold">{new Date(order.created_at).toLocaleDateString()}</div>
                      {order.price > 0 && <div className="font-mono font-bold text-gray-900">R {(order.price ?? 0) + (order.delivery_fee ?? 0)}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right detail */}
          <div className="w-1/2 flex flex-col bg-white">
            {!selectedOrder ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8 text-center">Select an order to view details and take action.</div>
            ) : (
              <div className="p-8 flex flex-col h-full overflow-y-auto">
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Order Details</h2>
                    <div className="text-[11px] text-gray-500 mt-1 uppercase font-bold">By {selectedOrder.captured_by}</div>
                  </div>
                  {statusBadge(selectedOrder.status)}
                </div>

                <div className="bg-gray-50 rounded-lg border border-gray-200 p-5 mb-6 space-y-4">
                  <div className="flex justify-between">
                    <div>
                      <div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Customer</div>
                      <div className="text-lg font-bold text-gray-900">{selectedOrder.customer_name}</div>
                      {selectedOrder.phone && <div className="text-gray-600 text-sm">{selectedOrder.phone}</div>}
                    </div>
                    {selectedOrder.ref && (
                      <div className="text-right">
                        <div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Ref</div>
                        <div className="text-lg font-mono font-black text-indigo-700 bg-indigo-50 px-3 py-1 rounded-md border border-indigo-100">{selectedOrder.ref}</div>
                      </div>
                    )}
                  </div>
                  <div className="pt-4 border-t border-gray-200 grid grid-cols-2 gap-4">
                    <div><div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Vehicle</div><div className="text-base text-gray-900 font-medium">{selectedOrder.vehicle || 'N/A'}</div></div>
                    <div><div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Order Type</div><div className="text-base text-gray-900 font-medium">{selectedOrder.order_type}</div></div>
                  </div>
                  <div className="pt-4 border-t border-gray-200">
                    <div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Part</div>
                    <div className="text-base text-gray-900 bg-white p-3 border border-gray-200 rounded text-sm whitespace-pre-wrap">{selectedOrder.part_description}</div>
                  </div>
                  {selectedOrder.price > 0 && (
                    <div className="pt-4 border-t border-gray-200 grid grid-cols-3 gap-4">
                      <div><div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Price</div><div className="text-lg font-mono font-bold text-gray-900">R {selectedOrder.price}</div></div>
                      {selectedOrder.delivery_fee > 0 && <div><div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Delivery</div><div className="text-lg font-mono font-bold text-gray-600">R {selectedOrder.delivery_fee}</div></div>}
                      <div><div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Total</div><div className="text-lg font-mono font-bold">R {(selectedOrder.price ?? 0) + (selectedOrder.delivery_fee ?? 0)}</div></div>
                      <div><div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Deposit</div><div className="text-lg font-mono font-bold text-green-700">R {selectedOrder.deposit_paid}</div></div>
                      <div><div className="text-[11px] text-gray-500 font-bold uppercase mb-1">Balance</div><div className="text-lg font-mono font-bold text-orange-600">R {(selectedOrder.price ?? 0) + (selectedOrder.delivery_fee ?? 0) - (selectedOrder.deposit_paid ?? 0)}</div></div>
                    </div>
                  )}
                  {selectedOrder.screenshot_url && (
                    <div className="pt-4 border-t border-gray-200">
                      <button onClick={() => setViewingScreenshot(selectedOrder.screenshot_url)} className="text-sm font-bold text-indigo-600 flex items-center gap-1.5 bg-indigo-50 px-3 py-2 rounded-lg hover:bg-indigo-100 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        View Screenshot
                      </button>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  {selectedOrder.status === OrderStatus.REQUESTED && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-5">
                      <label className="block text-sm font-bold text-gray-800 mb-3">Set Price & Delivery (R)</label>
                      <div className="flex gap-3 mb-3">
                        <div className="flex-1"><label className="block text-xs font-semibold text-gray-600 mb-1">Price</label><input type="number" value={priceInput} onChange={e => setPriceInput(e.target.value)} placeholder="0.00" className="w-full p-3 border border-gray-300 rounded-md text-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" /></div>
                        {selectedOrder.order_type === 'Delivery' && <div className="flex-1"><label className="block text-xs font-semibold text-gray-600 mb-1">Delivery</label><input type="number" value={deliveryInput} onChange={e => setDeliveryInput(e.target.value)} placeholder="0.00" className="w-full p-3 border border-gray-300 rounded-md text-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" /></div>}
                      </div>
                      <button onClick={() => handleSetPrice(selectedOrder)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-md text-sm uppercase tracking-wider">Save Price</button>
                    </div>
                  )}
                  {selectedOrder.status === OrderStatus.CONFIRMED && (
                    <button onClick={() => { if (selectedOrder.deposit_paid > 0) handleStatusChange(selectedOrder, OrderStatus.ORDERED); else alert('Deposit required before ordering.'); }}
                      className={`w-full font-bold py-4 rounded-md text-sm uppercase tracking-wide ${selectedOrder.deposit_paid > 0 ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}>
                      MARK AS ORDERED
                    </button>
                  )}
                  {selectedOrder.status === OrderStatus.ORDERED && (
                    <button onClick={() => handleStatusChange(selectedOrder, OrderStatus.READY_FOR_COLLECTION)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-md text-sm uppercase tracking-wide">MARK AS ARRIVED</button>
                  )}
                  {selectedOrder.status === OrderStatus.COMPLETED && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex flex-col gap-3">
                      <div className="text-green-800 font-bold text-center">Order completed.</div>
                      <button onClick={() => { generateReceiptPDF(selectedOrder); const ts = { ...(selectedOrder.message_timestamps ?? {}), RECEIPT_PDF: Date.now() }; updateOrderRecord(selectedOrder.id, { message_timestamps: ts }, 'owner').then(loadOrders); }}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-md text-xs uppercase tracking-wide">Generate PDF Receipt</button>
                    </div>
                  )}
                  {selectedOrder.status === OrderStatus.REFUNDED && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
                      <div className="text-red-800 font-bold">Refunded</div>
                      <div className="text-sm font-mono bg-white p-2 border border-red-100 rounded">Amount: R {selectedOrder.refund_amount}</div>
                      <div className="text-sm bg-white p-2 border border-red-100 rounded">Reason: {selectedOrder.refund_reason}</div>
                    </div>
                  )}
                  {selectedOrder.status === OrderStatus.CANCELLED && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center text-red-800 font-bold">Order cancelled.</div>
                  )}
                  {![OrderStatus.REFUNDED, OrderStatus.CANCELLED, OrderStatus.REQUESTED].includes(selectedOrder.status) && (
                    <button onClick={() => { setRefundingOrder(selectedOrder); setRefundAmount(String(selectedOrder.deposit_paid ?? 0)); setRefundReason(''); }}
                      className="w-full mt-2 bg-white border-2 border-red-600 text-red-600 hover:bg-red-50 font-bold py-3 rounded-md text-xs uppercase">Issue Refund</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {refundingOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h3 className="text-lg font-black uppercase mb-2">Issue Refund</h3>
            <p className="text-sm text-gray-500 mb-4">Order total: <strong>R {(refundingOrder.price ?? 0) + (refundingOrder.delivery_fee ?? 0)}</strong></p>
            <form onSubmit={handleRefundSubmit} className="flex flex-col gap-4">
              <div><label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Refund Amount (R)</label><input type="number" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500" /></div>
              <div><label className="block text-sm font-bold text-gray-700 mb-1 uppercase">Reason *</label><input type="text" value={refundReason} onChange={e => setRefundReason(e.target.value)} required placeholder="e.g. Part unavailable" className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500" /></div>
              <div className="flex gap-3">
                <button type="submit" className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-3 rounded-xl uppercase text-sm">Confirm Refund</button>
                <button type="button" onClick={() => setRefundingOrder(null)} className="flex-1 bg-white border border-gray-300 font-bold py-3 rounded-xl uppercase text-sm text-gray-700">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Business Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h3 className="text-lg font-black uppercase mb-4">Business Settings</h3>
            <div className="flex flex-col gap-4">
              {[{ l: 'Business Name', v: bizName, s: setBizName }, { l: 'Address', v: bizAddress, s: setBizAddress }, { l: 'Phone', v: bizPhone, s: setBizPhone }, { l: 'Email', v: bizEmail, s: setBizEmail }].map(f => (
                <div key={f.l}><label className="block text-sm font-bold text-gray-700 mb-1 uppercase">{f.l}</label><input type="text" value={f.v} onChange={e => f.s(e.target.value)} className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
              ))}
              <div className="flex gap-3">
                <button onClick={() => { saveBusinessSettings({ businessName: bizName, address: bizAddress, phone: bizPhone, email: bizEmail }); setShowSettings(false); showToast('Settings saved'); }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl uppercase text-sm">Save</button>
                <button onClick={() => setShowSettings(false)} className="flex-1 bg-white border border-gray-300 font-bold py-3 rounded-xl uppercase text-sm text-gray-700">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingScreenshot && <ScreenshotModal screenshotPath={viewingScreenshot} onClose={() => setViewingScreenshot(null)} />}

      {/* Footer */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-200 text-xs text-gray-400">
        <button onClick={() => setShowSettings(true)} className="hover:text-indigo-600 font-semibold uppercase tracking-wider">⚙ Business Settings</button>
        {hasLocalData && (
          <button onClick={() => setShowMigrate(true)} className="hover:text-orange-600 font-semibold uppercase tracking-wider">📦 Migrate Local Data</button>
        )}
      </div>

      {/* Migration Modal */}
      {showMigrate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h3 className="text-lg font-black uppercase mb-4">Migrate Local Data to Supabase</h3>
            {!migrateResult ? (
              <>
                <p className="text-sm text-gray-600 mb-6">This will copy all orders stored locally in this browser to Supabase. Orders already in Supabase will be skipped.</p>
                <div className="flex gap-3">
                  <button disabled={migrating} onClick={async () => { setMigrating(true); const r = await migrateLocalStorageToSupabase(); setMigrateResult(r); setMigrating(false); loadOrders(); }}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-black py-3 rounded-xl uppercase text-sm disabled:opacity-50">
                    {migrating ? 'Migrating...' : 'Start Migration'}
                  </button>
                  <button onClick={() => setShowMigrate(false)} className="flex-1 bg-white border border-gray-300 font-bold py-3 rounded-xl uppercase text-sm text-gray-700">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="font-bold text-green-700">Migrated:</span><span className="font-mono">{migrateResult.migrated}</span></div>
                  <div className="flex justify-between"><span className="font-bold text-gray-500">Skipped:</span><span className="font-mono">{migrateResult.skipped}</span></div>
                  <div className="flex justify-between"><span className="font-bold text-red-600">Failed:</span><span className="font-mono">{migrateResult.failed}</span></div>
                </div>
                {migrateResult.migrated > 0 && (
                  <button onClick={() => { clearLocalStorageData(); setHasLocalData(false); setShowMigrate(false); showToast('Local data cleared'); }}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-3 rounded-xl uppercase text-sm mb-3">Clear Local Data</button>
                )}
                <button onClick={() => { setShowMigrate(false); setMigrateResult(null); }} className="w-full bg-white border border-gray-300 font-bold py-3 rounded-xl uppercase text-sm text-gray-700">Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

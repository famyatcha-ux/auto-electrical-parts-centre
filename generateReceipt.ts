import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Order, OrderStatus } from '../types';

interface BusinessSettings {
  businessName: string;
  address: string;
  phone: string;
  email: string;
}

export const getBusinessSettings = (): BusinessSettings => {
  try {
    const stored = localStorage.getItem('business_settings');
    if (stored) return JSON.parse(stored);
  } catch (_) {}
  return {
    businessName: 'Auto Electrical Parts Centre',
    address: '',
    phone: '',
    email: '',
  };
};

export const saveBusinessSettings = (settings: BusinessSettings) => {
  localStorage.setItem('business_settings', JSON.stringify(settings));
};

export const generateReceiptPDF = (order: Order) => {
  const settings = getBusinessSettings();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const orderRef = order.ref || `AE-${Math.floor(1000 + Math.random() * 9000)}`;
  const price = order.price ?? 0;
  const delivery = order.delivery_fee ?? 0;
  const total = price + delivery;
  const depositPaid = order.deposit_paid ?? 0;
  const isCompleted = order.status === OrderStatus.COMPLETED;
  const finalPayment = isCompleted ? total - depositPaid : 0;
  const balanceDue = total - depositPaid - finalPayment;
  const documentType = isCompleted ? 'RECEIPT' : 'INVOICE';

  // Header bar
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, pageWidth, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.businessName.toUpperCase(), pageWidth / 2, 10, { align: 'center' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  if (settings.address) doc.text(settings.address, pageWidth / 2, 22, { align: 'center' });
  const contactLine = [
    settings.phone ? `Phone: ${settings.phone}` : '',
    settings.email ? `Email: ${settings.email}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
  if (contactLine) doc.text(contactLine, pageWidth / 2, 27, { align: 'center' });

  doc.setDrawColor(200, 200, 200);
  doc.line(15, 30, pageWidth - 15, 30);

  // Document title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(isCompleted ? 22 : 234, isCompleted ? 163 : 88, isCompleted ? 74 : 12);
  doc.text(documentType, pageWidth - 15, 40, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Ref:', 15, 40);
  doc.setFont('helvetica', 'bold');
  doc.text(orderRef, 35, 40);
  doc.setFont('helvetica', 'normal');
  doc.text('Date:', 15, 46);
  doc.setFont('helvetica', 'bold');
  doc.text(new Date(order.created_at).toLocaleDateString(), 35, 46);

  // Customer box
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(249, 250, 251);
  doc.roundedRect(15, 52, pageWidth - 30, 25, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Customer Details', 20, 58);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Name:', 20, 65);
  doc.setFont('helvetica', 'bold');
  doc.text(order.customer_name, 40, 65);
  doc.setFont('helvetica', 'normal');
  doc.text('Phone:', 20, 71);
  doc.text(order.phone || 'N/A', 40, 71);
  doc.text('Vehicle:', pageWidth / 2 + 5, 65);
  doc.text(order.vehicle || 'N/A', pageWidth / 2 + 25, 65);

  // Items table
  (doc as any).autoTable({
    startY: 82,
    margin: { left: 15, right: 15 },
    headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
    head: [['Description', 'Amount']],
    body: [
      [order.part_description, `R ${price.toFixed(2)}`],
      ...(delivery > 0 ? [['Delivery Fee', `R ${delivery.toFixed(2)}`]] : []),
    ],
    foot: [['Total', `R ${total.toFixed(2)}`]],
    footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: 'bold' },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 5;

  // Payment breakdown
  (doc as any).autoTable({
    startY: finalY,
    margin: { left: pageWidth / 2, right: 15, bottom: 20 },
    theme: 'plain',
    body: [
      ['Total Amount:', `R ${total.toFixed(2)}`],
      ['Deposit Paid:', `- R ${depositPaid.toFixed(2)}`],
      ...(isCompleted ? [['Final Payment:', `- R ${finalPayment.toFixed(2)}`]] : []),
    ],
    foot: [
      [
        isCompleted ? 'Total Paid:' : 'Balance Due:',
        `R ${isCompleted ? total.toFixed(2) : balanceDue.toFixed(2)}`,
      ],
    ],
    footStyles: {
      fontStyle: 'bold',
      textColor: isCompleted ? [22, 163, 74] : [220, 38, 38],
    },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'right' },
      1: { fontStyle: 'normal', halign: 'right' },
    },
  });

  // Payment method
  const paymentMethod = order.payment_type || 'N/A';
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Details', 15, finalY + 10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Method: ${paymentMethod}`, 15, finalY + 16);
  doc.text(`Status: ${isCompleted ? 'Paid in full' : 'Pending balance'}`, 15, finalY + 22);

  // Footer
  doc.setDrawColor(200, 200, 200);
  doc.line(15, pageHeight - 20, pageWidth - 15, pageHeight - 20);
  doc.setFont('helvetica', 'italic');
  doc.text('Thank you for your business', pageWidth / 2, pageHeight - 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `All parts remain property of ${settings.businessName} until paid in full.`,
    pageWidth / 2,
    pageHeight - 9,
    { align: 'center' }
  );

  doc.save(`${documentType}_${orderRef}.pdf`);
};

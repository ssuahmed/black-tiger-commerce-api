/**
 * Minimal multi-page text PDF builder for storefront sales quotes.
 * Avoids native PDF dependencies while producing a valid `application/pdf`
 * (Courier layout with line items, shipping, and totals).
 */

export type QuotePdfLine = {
  productName?: string | null;
  packagingLabel?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  formattedUnitPrice?: string | null;
  formattedTotalPrice?: string | null;
};

export type QuotePdfInput = {
  quoteId: string;
  createdAt: string;
  purchaseOrderNumber?: string | null;
  notes?: string | null;
  lines: QuotePdfLine[];
  totals: {
    currency?: string;
    subtotal?: number;
    discount?: number;
    vat?: number;
    shipping?: number;
    grandTotal?: number;
    formattedSubtotal?: string;
    formattedDiscount?: string;
    formattedVat?: string;
    formattedShipping?: string;
    formattedGrandTotal?: string;
  } | null;
  shippingLabel?: string | null;
  address?: Record<string, unknown> | null;
};

function esc(text: string): string {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function money(
  amount: number | undefined,
  formatted: string | undefined,
  currency = 'SAR',
): string {
  if (formatted) return formatted;
  if (amount == null || Number.isNaN(Number(amount))) return `— ${currency}`;
  return `${Number(amount).toLocaleString('en-SA')} ${currency}`;
}

function addressLines(address: Record<string, unknown> | null | undefined): string[] {
  if (!address || typeof address !== 'object') return [];
  const formatted = address['formatted'];
  if (typeof formatted === 'string' && formatted.trim()) {
    return formatted.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  }
  const parts = [
    address['recipientName'] ?? address['name'],
    address['companyName'],
    address['addressLine1'] ?? address['street'],
    address['addressLine2'],
    [address['city'], address['postalCode'] ?? address['zip']].filter(Boolean).join(' '),
    address['countryCode'] ?? address['country'],
    address['phone'],
  ]
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
  return parts;
}

function buildContent(input: QuotePdfInput): string[] {
  const currency = input.totals?.currency || 'SAR';
  const rows: string[] = [];
  rows.push('BLACK TIGER LUBRICANTS');
  rows.push('Sales Quote');
  rows.push('');
  rows.push(`Quote ID: ${input.quoteId}`);
  rows.push(`Date: ${new Date(input.createdAt).toLocaleString('en-SA')}`);
  if (input.purchaseOrderNumber) {
    rows.push(`PO Number: ${input.purchaseOrderNumber}`);
  }
  rows.push('');

  const shipTo = addressLines(input.address);
  if (shipTo.length) {
    rows.push('Ship to:');
    for (const line of shipTo) rows.push(`  ${line}`);
    rows.push('');
  }

  if (input.shippingLabel) {
    rows.push(`Shipping method: ${input.shippingLabel}`);
    rows.push('');
  }

  rows.push('Items');
  rows.push('-'.repeat(72));
  rows.push(
    pad('Product', 28) +
      pad('Packaging', 14) +
      pad('Qty', 6, true) +
      pad('Unit', 12, true) +
      pad('Total', 12, true),
  );
  rows.push('-'.repeat(72));

  for (const line of input.lines) {
    const name = String(line.productName || 'Product').slice(0, 28);
    const pkg = String(line.packagingLabel || '—').slice(0, 14);
    const qty = String(line.quantity ?? 0);
    const unit = money(line.unitPrice ?? undefined, line.formattedUnitPrice ?? undefined, currency);
    const total = money(line.totalPrice ?? undefined, line.formattedTotalPrice ?? undefined, currency);
    rows.push(
      pad(name, 28) +
        pad(pkg, 14) +
        pad(qty, 6, true) +
        pad(unit.slice(0, 12), 12, true) +
        pad(total.slice(0, 12), 12, true),
    );
  }

  rows.push('-'.repeat(72));
  rows.push('');
  const t = input.totals ?? {};
  rows.push(pad('Subtotal', 48) + money(t.subtotal, t.formattedSubtotal, currency));
  if ((t.discount ?? 0) > 0) {
    rows.push(pad('Discount', 48) + money(t.discount, t.formattedDiscount, currency));
  }
  rows.push(pad('Shipping', 48) + money(t.shipping, t.formattedShipping, currency));
  rows.push(pad('VAT', 48) + money(t.vat, t.formattedVat, currency));
  rows.push(pad('Grand total', 48) + money(t.grandTotal, t.formattedGrandTotal, currency));

  if (input.notes) {
    rows.push('');
    rows.push('Notes:');
    for (const part of String(input.notes).split(/\r?\n/)) {
      rows.push(`  ${part}`);
    }
  }

  rows.push('');
  rows.push('This quote reflects cart items and selected shipping at the time of request.');
  rows.push('Prices are subject to confirmation by Black Tiger Lubricants.');
  return rows;
}

function pad(text: string, width: number, right = false): string {
  const s = String(text ?? '');
  if (s.length >= width) return s.slice(0, width);
  const spaces = ' '.repeat(width - s.length);
  return right ? spaces + s : s + spaces;
}

function pageContentStream(lines: string[], startY: number): string {
  const ops: string[] = ['BT', '/F1 10 Tf', '14 TL', `50 ${startY} Td`];
  lines.forEach((line, i) => {
    if (i === 0) {
      ops.push(`/F1 16 Tf`, `(${esc(line)}) Tj`, `/F1 10 Tf`, 'T*');
    } else if (i === 1) {
      ops.push(`/F1 12 Tf`, `(${esc(line)}) Tj`, `/F1 10 Tf`, 'T*');
    } else {
      ops.push(`(${esc(line)}) Tj`, 'T*');
    }
  });
  ops.push('ET');
  return ops.join('\n');
}

/** Build a PDF buffer for the quote. */
export function buildQuotePdf(input: QuotePdfInput): Buffer {
  const allLines = buildContent(input);
  const linesPerPage = 48;
  const pages: string[] = [];
  for (let i = 0; i < allLines.length; i += linesPerPage) {
    pages.push(pageContentStream(allLines.slice(i, i + linesPerPage), 780));
  }
  if (!pages.length) {
    pages.push(pageContentStream(['(empty quote)'], 780));
  }

  const objects: string[] = [];
  // 1: catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  // 2: pages
  const kids = pages.map((_, idx) => `${3 + idx * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  // page + content pairs starting at object 3
  const contentObjectNumbers: number[] = [];
  pages.forEach((content, idx) => {
    const pageObjNum = 3 + idx * 2;
    const contentObjNum = pageObjNum + 1;
    contentObjectNumbers.push(contentObjNum);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`);
  });
  // font object
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

/** Safe download filename for a quote PDF attachment. */
export function quotePdfFileName(quoteId: string): string {
  const safe = String(quoteId || 'quote').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return `black-tiger-quote-${safe || 'quote'}.pdf`;
}

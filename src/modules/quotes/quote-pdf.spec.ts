import { buildQuotePdf, quotePdfFileName } from './quote-pdf';

describe('quote-pdf', () => {
  it('builds a PDF buffer with header and shipping total', () => {
    const buf = buildQuotePdf({
      quoteId: 'q-test-1',
      createdAt: '2026-08-09T00:00:00.000Z',
      purchaseOrderNumber: 'PO-9',
      notes: 'Rush delivery',
      shippingLabel: 'Medium 6-wheeler',
      address: {
        recipientName: 'Ops Desk',
        addressLine1: '1 King Rd',
        city: 'Riyadh',
        postalCode: '11564',
        countryCode: 'SA',
      },
      lines: [
        {
          productName: 'Tiger 10W30',
          packagingLabel: '1L x12',
          quantity: 2,
          unitPrice: 100,
          totalPrice: 200,
          formattedUnitPrice: '100 SAR',
          formattedTotalPrice: '200 SAR',
        },
      ],
      totals: {
        currency: 'SAR',
        subtotal: 200,
        discount: 0,
        vat: 30,
        shipping: 1000,
        grandTotal: 1230,
        formattedSubtotal: '200 SAR',
        formattedDiscount: '0 SAR',
        formattedVat: '30 SAR',
        formattedShipping: '1,000 SAR',
        formattedGrandTotal: '1,230 SAR',
      },
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    const text = buf.toString('utf8');
    expect(text).toContain('BLACK TIGER');
    expect(text).toContain('Tiger 10W30');
    expect(text).toContain('1,000 SAR');
    expect(text).toContain('Medium 6-wheeler');
    expect(quotePdfFileName('q-test-1')).toBe('black-tiger-quote-q-test-1.pdf');
  });
});

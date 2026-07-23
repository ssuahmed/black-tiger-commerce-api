import { createHmac } from 'node:crypto';
import {
  verifyPayTabsReturnSignature,
  verifyPayTabsSignature,
} from './paytabs.signature';

describe('paytabs.signature', () => {
  const serverKey = 'test-server-key';

  it('accepts valid callback HMAC', () => {
    const body = JSON.stringify({
      tran_ref: 'TST123',
      payment_result: { response_status: 'A' },
    });
    const signature = createHmac('sha256', serverKey).update(body).digest('hex');
    expect(verifyPayTabsSignature(body, signature, serverKey)).toBe(true);
  });

  it('rejects invalid callback HMAC', () => {
    const body = '{"tran_ref":"TST123"}';
    expect(verifyPayTabsSignature(body, 'deadbeef', serverKey)).toBe(false);
  });

  it('rejects missing signature', () => {
    expect(verifyPayTabsSignature('{}', undefined, serverKey)).toBe(false);
  });

  it('verifies return-form signature over sorted fields', () => {
    const fields: Record<string, string> = {
      cartId: 'cart-1',
      respStatus: 'A',
      tranRef: 'TST99',
    };
    const sortedKeys = Object.keys(fields).sort();
    const query = sortedKeys
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`)
      .join('&')
      .replace(/%20/g, '+');
    const signature = createHmac('sha256', serverKey).update(query).digest('hex');
    expect(
      verifyPayTabsReturnSignature({ ...fields, signature }, serverKey),
    ).toBe(true);
  });
});

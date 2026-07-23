import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify PayTabs callback Signature header (HMAC-SHA256 of raw body with Server Key). */
export function verifyPayTabsSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  serverKey: string,
): boolean {
  if (!signatureHeader || !serverKey) return false;
  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', serverKey).update(payload).digest('hex');
  const received = signatureHeader.trim().toLowerCase();
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(received, 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

/** Verify PayTabs return-URL form signature (sorted fields, excluding signature). */
export function verifyPayTabsReturnSignature(
  fields: Record<string, string>,
  serverKey: string,
): boolean {
  const requestSignature = fields.signature;
  if (!requestSignature || !serverKey) return false;
  const copy: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'signature' || v === '' || v == null) continue;
    copy[k] = String(v);
  }
  const sortedKeys = Object.keys(copy).sort();
  const query = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(copy[k])}`)
    .join('&')
    .replace(/%20/g, '+');
  const expected = createHmac('sha256', serverKey).update(query).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(requestSignature.trim().toLowerCase(), 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

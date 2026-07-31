/** Durable JWT / account identity helpers for Odoo-backed storefront partners. */

export function partnerAccountId(partnerId: number): string {
  return `partner:${partnerId}`;
}

export function parsePartnerAccountId(userId: string): number | null {
  const match = /^partner:(\d+)$/.exec(userId);
  if (!match) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Normalize legacy UUID or partner-based ids for cart/list/address map keys. */
export function resolveAccountLookupId(userId: string): string {
  return userId;
}

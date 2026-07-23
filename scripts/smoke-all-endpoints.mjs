/**
 * Smoke-test all Commerce API endpoints (local).
 * Usage: node scripts/smoke-all-endpoints.mjs
 */
const BASE = process.env.API_URL || 'http://localhost:3001';
const DEMO_EMAIL = 'demo@blacktiger.com.sa';
const DEMO_PASSWORD = 'Password1!';

const results = [];
const state = {};

async function req(method, path, { body, token, headers = {}, expect = [200, 201] } = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const opts = { method, headers: h };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let status, json, text;
  try {
    const res = await fetch(url, opts);
    status = res.status;
    text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  } catch (err) {
    results.push({ method, path, status: 'ERR', ok: false, note: String(err.message) });
    return null;
  }

  const ok = expect.includes(status);
  const note =
    !ok && json?.error?.message
      ? json.error.message
      : !ok
        ? text?.slice(0, 120)
        : '';
  results.push({ method, path, status, ok, note });
  return ok ? json : null;
}

function printReport() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log('\n=== Commerce API smoke test ===');
  console.log(`Base: ${BASE}\n`);
  for (const r of results) {
    const icon = r.ok ? 'PASS' : 'FAIL';
    const extra = r.note ? ` — ${r.note}` : '';
    console.log(`${icon} ${r.status}\t${r.method} ${r.path}${extra}`);
  }
  console.log(`\nTotal: ${results.length} | Pass: ${pass} | Fail: ${fail}`);
  if (fail) process.exitCode = 1;
}

async function main() {
  // Health (no /v1 prefix)
  await req('GET', '/health');
  await req('GET', '/ready');

  // Auth — public
  await req('GET', '/v1/auth/password/policy');
  const idRes = await req('POST', '/v1/auth/identifier', {
    body: { identifier: DEMO_EMAIL, intent: 'login' },
  });
  state.challengeId = idRes?.data?.challengeId;

  await req('POST', '/v1/auth/register', {
    body: {
      email: `smoke-${Date.now()}@example.com`,
      password: 'Password1!',
      confirmPassword: 'Password1!',
      acceptTerms: true,
    },
    expect: [200, 201, 409],
  });

  const loginRes = await req('POST', '/v1/auth/login', {
    body: { identifier: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  state.token = loginRes?.data?.accessToken;
  state.refreshToken = loginRes?.data?.refreshToken;

  if (state.challengeId) {
    await req('POST', '/v1/auth/otp/send', {
      body: { challengeId: state.challengeId, purpose: 'login' },
      expect: [200, 201, 400],
    });
    await req('POST', '/v1/auth/otp/resend', {
      body: { challengeId: state.challengeId },
      expect: [200, 201, 400, 429],
    });
    await req('POST', '/v1/auth/otp/verify', {
      body: { challengeId: state.challengeId, code: '000000', purpose: 'login' },
      expect: [200, 201, 400, 401],
    });
  }

  await req('POST', '/v1/auth/password/forgot', {
    body: { identifier: DEMO_EMAIL, preferredMethod: 'otp' },
    expect: [200, 201],
  });
  await req('GET', '/v1/auth/password/reset/validate?token=invalid', {
    expect: [200, 400, 404],
  });
  await req('POST', '/v1/auth/password/reset', {
    body: { password: 'Password1!', confirmPassword: 'Password1!' },
    expect: [400, 401],
  });

  if (state.refreshToken) {
    const refreshRes = await req('POST', '/v1/auth/refresh', {
      body: { refreshToken: state.refreshToken },
    });
    if (refreshRes?.data?.accessToken) state.token = refreshRes.data.accessToken;
  }

  const token = state.token;
  if (!token) {
    console.error('Login failed — cannot test protected routes');
    printReport();
    return;
  }

  // Content
  await req('GET', '/v1/content/pages');
  for (const slug of ['home', 'contact', 'shop', 'about']) {
    await req('GET', `/v1/content/pages/${slug}`);
  }

  // Catalog
  const cats = await req('GET', '/v1/catalog/categories');
  const products = await req('GET', '/v1/catalog/products');
  await req('GET', '/v1/catalog/featured');
  await req('GET', '/v1/catalog/search?q=tiger');

  const productSlug =
    products?.data?.items?.[0]?.slug || 'tiger-x-5w30-sn';
  state.productSlug = productSlug;

  const pdp = await req('GET', `/v1/catalog/products/${productSlug}`);
  const pkgId =
    pdp?.data?.packagingOptions?.[0]?.id || 'pkg-5w30-1l-x12';
  state.packagingOptionId = pkgId;

  await req('POST', `/v1/catalog/products/${productSlug}/price-quote`, {
    body: { packagingOptionId: pkgId, quantity: 2, palletType: 'unit' },
  });

  const navSlug =
    cats?.data?.categories?.[0]?.children?.[0]?.slug || 'passenger-cars';
  await req('GET', `/v1/catalog/categories/${navSlug}`, {
    expect: [200, 404],
  });
  await req('GET', `/v1/catalog/products?category=${navSlug}`);

  // Cart
  const cartRes = await req('POST', '/v1/cart', { body: {}, token });
  const cartId = cartRes?.data?.cart?.id ?? cartRes?.data?.id;
  state.cartId = cartId;

  if (cartId) {
    await req('GET', `/v1/cart/${cartId}`, { token });
    const addRes = await req('POST', `/v1/cart/${cartId}/items`, {
      token,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        productSlug,
        packagingOptionId: pkgId,
        quantity: 1,
        palletType: 'unit',
      },
    });
    const lineId =
      addRes?.data?.cart?.lines?.[0]?.id ??
      addRes?.data?.lines?.[0]?.id;
    state.lineId = lineId;

    if (lineId) {
      await req('PATCH', `/v1/cart/${cartId}/items/${lineId}`, {
        token,
        body: { quantity: 2 },
      });
      await req('DELETE', `/v1/cart/${cartId}/items/${lineId}`, { token });
    }

    // Re-add for checkout
    const add2 = await req('POST', `/v1/cart/${cartId}/items`, {
      token,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        productSlug,
        packagingOptionId: pkgId,
        quantity: 1,
        palletType: 'unit',
      },
    });
    if (!state.lineId) {
      state.lineId =
        add2?.data?.cart?.lines?.[0]?.id ?? add2?.data?.lines?.[0]?.id;
    }

    // Checkout
    await req('GET', `/v1/checkout/${cartId}/summary`, { token });
    await req('PUT', `/v1/checkout/${cartId}/address`, {
      token,
      body: {
        billingSameAsShipping: true,
        shippingAddress: {
          usageTypes: ['shipping', 'billing'],
          countryCode: 'SA',
          addressLine1: 'King Fahd Road',
          city: 'Riyadh',
          postalCode: '12345',
          phone: '+966500000000',
        },
      },
    });
    const shipOpts = await req('GET', `/v1/checkout/${cartId}/shipping-options`, {
      token,
    });
    const shipId =
      shipOpts?.data?.options?.[0]?.id ?? 'standard';
    await req('PUT', `/v1/checkout/${cartId}/shipping`, {
      token,
      body: { shippingOptionId: shipId },
    });
    await req('POST', `/v1/checkout/${cartId}/payment-intent`, { token, body: {} });
    await req('POST', `/v1/checkout/${cartId}/submit`, {
      token,
      body: { confirm: true },
    });

    await req('DELETE', `/v1/cart/${cartId}`, { token, expect: [200, 204, 404] });
  }

  // Lists
  const listRes = await req('POST', '/v1/lists', {
    token,
    body: { name: 'Smoke test list', listType: 'wishlist' },
  });
  const listId = listRes?.data?.list?.id ?? listRes?.data?.id;
  if (listId) {
    await req('GET', '/v1/lists', { token });
    await req('GET', `/v1/lists/${listId}`, { token });
    await req('PATCH', `/v1/lists/${listId}`, {
      token,
      body: { name: 'Smoke test list updated' },
    });
    await req('GET', `/v1/lists/${listId}/items`, { token });
    const itemRes = await req('POST', `/v1/lists/${listId}/items`, {
      token,
      body: {
        productSlug,
        packagingOptionId: pkgId,
        quantity: 1,
        palletType: 'unit',
      },
    });
    const itemId = itemRes?.data?.item?.id ?? itemRes?.data?.id;
    if (itemId) {
      await req('PATCH', `/v1/lists/${listId}/items/${itemId}`, {
        token,
        body: { quantity: 2 },
      });
      await req('DELETE', `/v1/lists/${listId}/items/${itemId}`, { token });
    }
    await req('POST', `/v1/lists/${listId}/items/bulk`, {
      token,
      body: {
        items: [
          {
            productSlug,
            packagingOptionId: pkgId,
            quantity: 1,
            palletType: 'unit',
          },
        ],
      },
    });
    await req('DELETE', `/v1/lists/${listId}/items`, { token });
    await req('POST', `/v1/lists/${listId}/add-to-cart`, { token, body: {} });
    await req('DELETE', `/v1/lists/${listId}`, { token, expect: [200, 204] });
  }

  // Quotes
  const quoteRes = await req('POST', '/v1/quotes', {
    token,
    body: { notes: 'Smoke test quote' },
    expect: [200, 201, 400],
  });
  const quoteId = quoteRes?.data?.quote?.id ?? quoteRes?.data?.id;
  if (quoteId) {
    await req('GET', `/v1/quotes/${quoteId}`, { token });
  }

  // Account
  await req('GET', '/v1/account/summary', { token });
  await req('GET', '/v1/account/profile', { token });
  await req('PATCH', '/v1/account/profile', {
    token,
    body: { firstName: 'Demo', lastName: 'Customer' },
  });
  await req('GET', '/v1/account/credits', { token });
  await req('POST', '/v1/account/credits/withdraw', {
    token,
    body: { amount: 100, currency: 'SAR' },
    expect: [200, 201, 400],
  });
  await req('GET', '/v1/account/addresses', { token });
  const addrRes = await req('POST', '/v1/account/addresses', {
    token,
    body: {
      label: 'Office',
      usageTypes: ['shipping'],
      countryCode: 'SA',
      addressLine1: 'King Fahd Road',
      city: 'Riyadh',
      postalCode: '12345',
    },
  });
  const addressId = addrRes?.data?.address?.id ?? addrRes?.data?.id;
  if (addressId) {
    await req('PATCH', `/v1/account/addresses/${addressId}`, {
      token,
      body: { label: 'Office updated' },
    });
    await req('POST', `/v1/account/addresses/${addressId}/set-default`, {
      token,
      body: { usageType: 'shipping' },
    });
    await req('DELETE', `/v1/account/addresses/${addressId}`, { token });
  }
  await req('GET', '/v1/account/contacts', { token });
  const contactRes = await req('POST', '/v1/account/contacts', {
    token,
    body: {
      label: 'Primary',
      usageTypes: ['delivery'],
      firstName: 'Demo',
      lastName: 'User',
      email: DEMO_EMAIL,
      phone: '+966500000000',
    },
  });
  const contactId = contactRes?.data?.contact?.id ?? contactRes?.data?.id;
  if (contactId) {
    await req('GET', `/v1/account/contacts/${contactId}`, { token });
    await req('PATCH', `/v1/account/contacts/${contactId}`, {
      token,
      body: { jobTitle: 'Buyer' },
    });
    await req('POST', `/v1/account/contacts/${contactId}/set-default`, {
      token,
      body: { usageType: 'delivery' },
    });
    await req('DELETE', `/v1/account/contacts/${contactId}`, { token });
  }
  await req('GET', '/v1/account/payment-methods', { token });
  await req('GET', '/v1/account/notifications', { token });
  await req('PATCH', '/v1/account/notifications', {
    token,
    body: { orderUpdates: true, promotions: false },
  });
  await req('GET', '/v1/account/security', { token });
  await req('GET', '/v1/account/orders?page=1', { token });
  await req('GET', '/v1/account/returns', { token });
  await req('GET', '/v1/account/business', { token });
  await req('GET', '/v1/account/business/status', { token });
  const appRes = await req('POST', '/v1/account/business/credit-application', {
    token,
    body: {
      billing: {
        countryCode: 'SA',
        companyName: 'Acme Trading LLC',
        addressLine1: 'King Fahd Road',
        city: 'Riyadh',
        stateCode: '01',
        postalCode: '12345',
      },
      preferences: {
        accountsPayablePhone: '+966500000000',
        accountsPayableEmail: 'ap@acme.example',
        currency: 'SAR',
        creditLimitDesired: 50000,
      },
      invoiceDelivery: { email: 'invoices@acme.example' },
      submitter: {
        name: 'Demo Customer',
        title: 'Purchasing Manager',
        phone: '+966500000000',
        email: DEMO_EMAIL,
      },
    },
    expect: [200, 201],
  });
  const appId = appRes?.data?.applicationId;
  if (appId) {
    await req(
      'POST',
      `/v1/account/business/credit-application/${appId}/documents`,
      { token, expect: [200, 201, 400] },
    );
  }

  await req('POST', '/v1/auth/logout', {
    token,
    body: { refreshToken: state.refreshToken },
    expect: [200, 201, 204],
  });

  printReport();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

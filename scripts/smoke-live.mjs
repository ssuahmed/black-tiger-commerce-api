#!/usr/bin/env node
/**
 * Live smoke test — Commerce API + Odoo (ODOO_MODE=live).
 * Usage: node scripts/smoke-live.mjs
 * Env: API_BASE, SMOKE_EMAIL, SMOKE_PASSWORD, ODOO_WEBHOOK_SECRET
 */

import { createHmac } from 'node:crypto';

const API_BASE = (process.env.API_BASE || 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = process.env.SMOKE_EMAIL || 'new.user@example.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Password1!';

const PRODUCT_SLUGS = [
  'tiger-x-5w30-sn',
  'tiger-10w30-sl-fully-synthetic',
  'tiger-20w50-sl',
];

const results = [];

function record(name, pass, detail, extra = {}) {
  results.push({ name, pass, detail, ...extra });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function request(method, path, { body, token, expectStatus } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  const ok = expectStatus ? res.status === expectStatus : res.ok;
  return { ok, status: res.status, json, res };
}

function data(json) {
  return json?.data ?? json;
}

async function ensureLogin() {
  let login = await request('POST', '/v1/auth/login', {
    body: { identifier: EMAIL, password: PASSWORD },
  });
  if (login.status === 201 || login.status === 200) {
    const tokens = data(login.json);
    if (tokens?.accessToken) return tokens.accessToken;
  }
  const reg = await request('POST', '/v1/auth/register', {
    body: {
      email: EMAIL,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptTerms: true,
    },
    expectStatus: 201,
  });
  if (!reg.ok) {
    throw new Error(`Login and register failed: login=${login.status} register=${reg.status}`);
  }
  return data(reg.json).accessToken;
}

async function main() {
  console.log(`\nBlack Tiger Commerce API — live smoke test`);
  console.log(`  API: ${API_BASE}`);
  console.log(`  User: ${EMAIL}`);
  console.log(`  Time: ${new Date().toISOString()}\n`);

  // 1. Health
  const health = await request('GET', '/health');
  record(
    'Health',
    health.ok && data(health.json)?.status === 'ok',
    `HTTP ${health.status}`,
    { status: health.status, body: health.json },
  );

  const ready = await request('GET', '/ready');
  const readyData = data(ready.json);
  const integration = readyData?.integration ?? readyData;
  record(
    'Ready probe',
    ready.ok &&
      readyData?.status === 'ready' &&
      integration?.sources?.catalog !== 'mock',
    integration?.issues?.length
      ? integration.issues.join('; ')
      : `catalog=${integration?.sources?.catalog}`,
    { status: ready.status, integration },
  );
  if (integration?.odooMode === 'live' && integration?.checks?.mockCatalogMarkers) {
    record('Live data guard', false, 'catalog contains mock markers');
    return finish(1);
  }

  // 2. Catalog (Odoo live)
  const categories = await request('GET', '/v1/catalog/categories');
  const catPayload = data(categories.json);
  const catTree = catPayload?.categories ?? catPayload?.items ?? catPayload;
  const catCount = Array.isArray(catTree) ? catTree.length : 0;
  const childCount = Array.isArray(catTree?.[0]?.children)
    ? catTree[0].children.length
    : 0;
  record(
    'Catalog categories',
    categories.ok && (catCount > 0 || childCount > 0),
    catCount ? `${catCount} root, ${childCount} children` : 'empty',
    { status: categories.status, root: catCount, children: childCount },
  );

  let productSlug = null;
  let packagingOptionId = null;
  for (const slug of PRODUCT_SLUGS) {
    const p = await request('GET', `/v1/catalog/products/${slug}`);
    if (p.ok) {
      productSlug = slug;
      const prod = data(p.json);
      const pkg =
        prod?.packagingOptions?.find((o) => o.default) ??
        prod?.packagingOptions?.[0];
      packagingOptionId = pkg?.id ?? null;
      const isMockPkg = packagingOptionId?.startsWith('pkg-box-');
      const isOdooPkg = /^pkg-\d+$/.test(packagingOptionId || '');
      record(
        `Product ${slug}`,
        p.ok && prod?.dataSource === 'odoo' && !isMockPkg,
        `${prod?.name || prod?.title || 'found'}${packagingOptionId ? ` (pkg ${packagingOptionId})` : ''}`,
        { inStock: prod?.inStock, status: p.status, packagingOptionId, dataSource: prod?.dataSource, isOdooPkg },
      );
      break;
    }
  }
  if (!productSlug) {
    const products = await request('GET', '/v1/catalog/products');
    const list = data(products.json);
    const items = Array.isArray(list) ? list : list?.items ?? [];
    productSlug = items[0]?.slug;
    record(
      'Catalog products list',
      products.ok && items.length > 0,
      items.length ? `${items.length} products, first=${productSlug}` : 'empty',
      { status: products.status, count: items.length },
    );
  } else {
    record('Catalog products list', true, `using ${productSlug}`);
  }

  if (productSlug && packagingOptionId) {
    const quote = await request('POST', `/v1/catalog/products/${productSlug}/price-quote`, {
      body: {
        packagingOptionId,
        quantity: 1,
        palletType: 'unit',
      },
    });
    const quoteData = data(quote.json);
    const unitPrice = quoteData?.lineSummary?.unitPrice ?? quoteData?.pricing?.unitPrice;
    record(
      'Price quote (Odoo tiers)',
      quote.ok && typeof unitPrice === 'number' && unitPrice > 0,
      quote.ok ? `unit ${unitPrice}` : `HTTP ${quote.status}`,
      { unitPrice, status: quote.status },
    );
  }

  const webhookSecret = process.env.ODOO_WEBHOOK_SECRET;
  if (webhookSecret) {
    const webhookBody = JSON.stringify({
      model: 'product.template',
      action: 'write',
      ids: [1],
    });
    const signature = createHmac('sha256', webhookSecret).update(webhookBody).digest('hex');
    const webhookRes = await fetch(`${API_BASE}/internal/webhooks/odoo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Odoo-Signature': signature,
      },
      body: webhookBody,
    });
    let webhookJson = null;
    const webhookText = await webhookRes.text();
    try {
      webhookJson = webhookText ? JSON.parse(webhookText) : null;
    } catch {
      webhookJson = { raw: webhookText };
    }
    const invalidated = webhookJson?.data?.invalidated ?? webhookJson?.invalidated;
    record(
      'Webhook HMAC invalidation',
      webhookRes.ok && Array.isArray(invalidated),
      webhookRes.ok ? invalidated.join(', ') || 'ok' : `HTTP ${webhookRes.status}`,
      { status: webhookRes.status, invalidated },
    );
  } else {
    record('Webhook HMAC invalidation', true, 'skipped (ODOO_WEBHOOK_SECRET unset)');
  }

  // 3. CMS content (Odoo live)
  const pages = await request('GET', '/v1/content/pages');
  const pageList = data(pages.json);
  const pageItems = Array.isArray(pageList) ? pageList : pageList?.items ?? [];
  record(
    'CMS pages',
    pages.ok && pageItems.length > 0,
    `${pageItems.length} pages`,
    { slugs: pageItems.map((p) => p.slug).slice(0, 6) },
  );

  const home = await request('GET', '/v1/content/pages/home');
  const homeData = data(home.json);
  record(
    'CMS home page',
    home.ok && (homeData?.slug === 'home' || homeData?.sections?.length > 0),
    homeData?.sections ? `${homeData.sections.length} sections` : homeData?.slug || `HTTP ${home.status}`,
    { status: home.status },
  );

  // 4. Auth
  let token;
  try {
    token = await ensureLogin();
    record('Auth login/register', true, 'access token received');
  } catch (err) {
    record('Auth login/register', false, err.message);
    return finish(1);
  }

  const profile = await request('GET', '/v1/account/profile', { token });
  record(
    'Account profile',
    profile.ok,
    data(profile.json)?.email || `HTTP ${profile.status}`,
    { status: profile.status },
  );

  const accountSummary = await request('GET', '/v1/account/summary', { token });
  const summaryData = data(accountSummary.json);
  record(
    'Account summary (Odoo customer)',
    accountSummary.ok && summaryData?.email === EMAIL,
    summaryData?.segment ? `segment=${summaryData.segment}` : `HTTP ${accountSummary.status}`,
    { segment: summaryData?.segment, approvalStatus: summaryData?.approvalStatus },
  );

  if (!productSlug) {
    record('Checkout flow', false, 'No product slug available for cart');
    return finish(1);
  }

  // 5. Cart + checkout → Odoo order
  const cartRes = await request('POST', '/v1/cart', { body: {}, expectStatus: 201 });
  const cartId = data(cartRes.json)?.id;
  record('Create cart', cartRes.ok && !!cartId, cartId || `HTTP ${cartRes.status}`);

  if (!packagingOptionId) {
    const prodRes = await request('GET', `/v1/catalog/products/${productSlug}`);
    const prod = data(prodRes.json);
    const pkg =
      prod?.packagingOptions?.find((o) => o.default) ??
      prod?.packagingOptions?.[0];
    packagingOptionId = pkg?.id;
  }
  if (!packagingOptionId) {
    record('Add cart item', false, 'No packaging option on product');
    return finish(1);
  }

  const addItem = await request('POST', `/v1/cart/${cartId}/items`, {
    body: {
      productSlug,
      packagingOptionId,
      quantity: 1,
      palletType: 'unit',
    },
    expectStatus: 201,
  });
  record(
    'Add cart item',
    addItem.ok,
    addItem.ok ? `${productSlug} / ${packagingOptionId}` : `HTTP ${addItem.status}`,
  );
  if (!addItem.ok) return finish(1);

  const addr = await request('PUT', `/v1/checkout/${cartId}/address`, {
    token,
    body: {
      shippingAddress: {
        countryCode: 'SA',
        addressLine1: '3462 Old Al-Kharj Road',
        city: 'Riyadh',
        postalCode: '11564',
        usageTypes: ['shipping'],
        label: 'Smoke test',
      },
      billingSameAsShipping: true,
      deliveryContact: {
        usageTypes: ['delivery', 'order_notifications'],
        firstName: 'Smoke',
        lastName: 'Test',
        email: EMAIL,
        phone: '+966500000001',
      },
    },
  });
  record('Checkout address', addr.ok, `HTTP ${addr.status}`);

  const shipOpts = await request('GET', `/v1/checkout/${cartId}/shipping-options`, { token });
  const opts = data(shipOpts.json);
  const optList = Array.isArray(opts)
    ? opts
    : Array.isArray(opts?.options)
      ? opts.options
      : opts?.items ?? [];
  const recScore = opts?.recommendation?.efficiency?.score;
  record(
    'Shipping options (Odoo)',
    shipOpts.ok && optList.length > 0,
    `${optList.length} options` +
      (recScore != null ? `, efficiency=${recScore}` : ''),
    { ids: optList.map((o) => o.id) },
  );

  if (!optList.length) return finish(1);

  const ship = await request('PUT', `/v1/checkout/${cartId}/shipping`, {
    token,
    body: { shippingOptionId: optList[0].id },
  });
  record('Select shipping', ship.ok, optList[0].id);

  const payIntent = await request('POST', `/v1/checkout/${cartId}/payment-intent`, {
    token,
    body: { method: 'cod' },
    expectStatus: 201,
  });
  const intent = data(payIntent.json);
  record(
    'Payment intent (sandbox)',
    payIntent.ok && intent?.gateway === 'sandbox',
    intent?.paymentIntentId || `HTTP ${payIntent.status}`,
  );

  const submit = await request('POST', `/v1/checkout/${cartId}/submit`, {
    token,
    body: { confirm: true, paymentMethod: 'cod' },
    expectStatus: 201,
  });
  const order = data(submit.json);
  record(
    'Checkout submit → Odoo',
    submit.ok && order?.orderId && !String(order?.orderNumber || '').startsWith('BT-M1-'),
    order?.orderNumber || order?.orderId || `HTTP ${submit.status}`,
    { orderNumber: order?.orderNumber, orderId: order?.orderId, status: submit.status },
  );

  const orders = await request('GET', '/v1/account/orders', { token });
  const orderPage = data(orders.json);
  const orderItems = orderPage?.items ?? [];
  record(
    'Account orders list',
    orders.ok && orderItems.length > 0,
    `${orderItems.length} order(s)`,
    { latest: orderItems[0]?.orderNumber },
  );

  const listCreate = await request('POST', '/v1/lists', {
    token,
    body: { name: `Smoke list ${Date.now()}`, listType: 'wishlist' },
    expectStatus: 201,
  });
  const list = data(listCreate.json);
  record('Lists create', listCreate.ok && !!list?.id, list?.name || `HTTP ${listCreate.status}`);

  if (list?.id && packagingOptionId) {
    const addListItem = await request('POST', `/v1/lists/${list.id}/items`, {
      token,
      body: { productSlug, packagingOptionId, quantity: 1, palletType: 'unit' },
      expectStatus: 201,
    });
    record('Lists add item', addListItem.ok, productSlug);
    await request('DELETE', `/v1/lists/${list.id}`, { token, expectStatus: 204 });
  }

  const contact = await request('POST', '/v1/contact/inquiries', {
    body: {
      title: 'mr',
      name: 'Smoke Test',
      company: 'Black Tiger QA',
      email: `smoke-${Date.now()}@example.com`,
      phone: '+966500000001',
      address: '3462 Old Al-Kharj Road',
      city: 'Riyadh',
      country: 'SA',
      message: 'Live smoke contact inquiry',
    },
    expectStatus: 201,
  });
  const inquiry = data(contact.json);
  record('Contact inquiry', contact.ok && !!inquiry?.inquiryId, inquiry?.inquiryId);

  const chat = await request('POST', '/v1/chat/messages', {
    body: { message: '10W-30 for passenger cars' },
    expectStatus: 201,
  });
  const chatBody = data(chat.json);
  record(
    'Chat recommendations (rules)',
    chat.ok && Array.isArray(chatBody?.products) && chatBody.products.length > 0,
    `${chatBody?.products?.length ?? 0} product(s), provider=${chatBody?.provider || '?'}`,
  );

  return finish(results.every((r) => r.pass) ? 0 : 1);
}

function finish(code) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---\n`);
  process.exitCode = code;
  if (typeof globalThis.__writeReport === 'function') {
    globalThis.__writeReport({ results, passed, failed, API_BASE, EMAIL });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { results };

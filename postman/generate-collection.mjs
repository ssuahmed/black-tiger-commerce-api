import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const bearer = {
  type: 'bearer',
  bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
};

function req(name, method, path, opts = {}) {
  const raw = `{{baseUrl}}${path}`;
  const item = {
    name,
    request: {
      method,
      header: opts.headers ?? [],
      url: raw,
      auth: opts.auth === false ? { type: 'noauth' } : bearer,
    },
  };
  if (opts.body) {
    item.request.header.push({ key: 'Content-Type', value: 'application/json' });
    item.request.body = { mode: 'raw', raw: JSON.stringify(opts.body, null, 2) };
  }
  if (opts.query) {
    item.request.url = {
      raw: raw + (opts.query.length ? '?' + opts.query.map((q) => `${q.key}=${q.value}`).join('&') : ''),
      host: ['{{baseUrl}}'],
      path: path.replace(/^\//, '').split('/'),
      query: opts.query,
    };
  }
  if (opts.formdata) {
    item.request.body = { mode: 'formdata', formdata: opts.formdata };
    item.request.auth = bearer;
  }
  if (opts.test) item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: opts.test } }];
  if (opts.description) item.request.description = opts.description;
  return item;
}

function folder(name, items, description) {
  return { name, item: items, ...(description ? { description } : {}) };
}

const saveTokens = [
  'const j = pm.response.json();',
  'if (j.data?.accessToken) pm.environment.set("accessToken", j.data.accessToken);',
  'if (j.data?.refreshToken) pm.environment.set("refreshToken", j.data.refreshToken);',
];

const saveCart = [
  'const j = pm.response.json();',
  'const cart = j.data?.cart ?? j.data;',
  'if (cart?.id) pm.environment.set("cartId", cart.id);',
  'if (cart?.lines?.[0]?.id) pm.environment.set("lineId", cart.lines[0].id);',
];

const saveList = [
  'const j = pm.response.json();',
  'if (j.data?.id) pm.environment.set("listId", j.data.id);',
  'if (j.data?.items?.[0]?.id) pm.environment.set("itemId", j.data.items[0].id);',
];

const collection = {
  info: {
    name: 'Black Tiger Commerce API',
    description:
      'All Commerce API endpoints (M1 mock + M2 content).\n\n**Local stack:**\n- Commerce API: http://localhost:3001\n- Swagger: http://localhost:3001/docs\n- Odoo: http://localhost:8069\n\n**Demo user:** demo@blacktiger.com.sa / Password1!\n\nImport `Black-Tiger-Local.postman_environment.json` and run **Auth → Login (demo user)** first for protected routes.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: bearer,
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3001' },
    { key: 'productSlug', value: 'tiger-x-5w30-sn' },
    { key: 'packagingOptionId', value: 'pkg-5w30-1l-x12' },
  ],
  item: [
    folder('Health', [
      req('GET /health', 'GET', '/health', { auth: false }),
      req('GET /ready', 'GET', '/ready', { auth: false }),
    ], 'No /v1 prefix'),
    folder('Auth', [
      req('GET password policy', 'GET', '/v1/auth/password/policy', { auth: false }),
      req('POST identifier (login)', 'POST', '/v1/auth/identifier', {
        auth: false,
        body: { identifier: '{{demoEmail}}', intent: 'login' },
      }),
      req('POST register', 'POST', '/v1/auth/register', {
        auth: false,
        body: {
          email: 'new.user@example.com',
          password: 'Password1!',
          confirmPassword: 'Password1!',
          acceptTerms: true,
        },
      }),
      req('POST login (demo user)', 'POST', '/v1/auth/login', {
        auth: false,
        body: { identifier: '{{demoEmail}}', password: '{{demoPassword}}' },
        test: saveTokens,
        description: 'Seeded demo user. Saves accessToken + refreshToken to environment.',
      }),
      req('POST otp/send', 'POST', '/v1/auth/otp/send', {
        auth: false,
        body: { challengeId: 'CHALLENGE_ID', purpose: 'login' },
      }),
      req('POST otp/resend', 'POST', '/v1/auth/otp/resend', {
        auth: false,
        body: { challengeId: 'CHALLENGE_ID' },
      }),
      req('POST otp/verify', 'POST', '/v1/auth/otp/verify', {
        auth: false,
        body: { challengeId: 'CHALLENGE_ID', code: '123456', purpose: 'login' },
      }),
      req('POST password/forgot', 'POST', '/v1/auth/password/forgot', {
        auth: false,
        body: { identifier: '{{demoEmail}}', preferredMethod: 'auto' },
      }),
      req('GET password/reset/validate', 'GET', '/v1/auth/password/reset/validate', {
        auth: false,
        query: [{ key: 'token', value: 'RESET_TOKEN' }],
      }),
      req('POST password/reset', 'POST', '/v1/auth/password/reset', {
        auth: false,
        body: {
          resetToken: 'RESET_TOKEN',
          password: 'Password1!',
          confirmPassword: 'Password1!',
        },
      }),
      req('POST refresh', 'POST', '/v1/auth/refresh', {
        auth: false,
        body: { refreshToken: '{{refreshToken}}' },
        test: saveTokens,
      }),
      req('POST logout', 'POST', '/v1/auth/logout'),
    ]),
    folder('Content (CMS)', [
      req('GET pages', 'GET', '/v1/content/pages', { auth: false }),
      req('GET page by slug (home)', 'GET', '/v1/content/pages/home', { auth: false }),
      req('GET page by slug (contact)', 'GET', '/v1/content/pages/contact', { auth: false }),
      req('GET page by slug (shop)', 'GET', '/v1/content/pages/shop', { auth: false }),
      req('GET page by slug (about)', 'GET', '/v1/content/pages/about', { auth: false }),
    ], 'Mock fixtures unless ODOO_MODE=live'),
    folder('Catalog', [
      req('GET categories', 'GET', '/v1/catalog/categories', { auth: false }),
      req('GET category by slug', 'GET', '/v1/catalog/categories/passenger-cars', { auth: false }),
      req('GET products', 'GET', '/v1/catalog/products', {
        auth: false,
        query: [
          { key: 'page', value: '1' },
          { key: 'pageSize', value: '24' },
        ],
      }),
      req('GET product by slug', 'GET', '/v1/catalog/products/{{productSlug}}', { auth: false }),
      req('POST price quote', 'POST', '/v1/catalog/products/{{productSlug}}/price-quote', {
        body: {
          packagingOptionId: '{{packagingOptionId}}',
          quantity: 2,
          palletType: 'unit',
        },
      }),
      req('GET featured', 'GET', '/v1/catalog/featured', { auth: false }),
      req('GET search', 'GET', '/v1/catalog/search', {
        auth: false,
        query: [{ key: 'q', value: 'tiger' }],
      }),
    ]),
    folder('Cart', [
      req('POST create cart', 'POST', '/v1/cart', { body: {}, test: saveCart }),
      req('GET cart', 'GET', '/v1/cart/{{cartId}}'),
      req('POST add item', 'POST', '/v1/cart/{{cartId}}/items', {
        headers: [{ key: 'Idempotency-Key', value: '{{$guid}}' }],
        body: {
          productSlug: '{{productSlug}}',
          packagingOptionId: '{{packagingOptionId}}',
          quantity: 1,
          palletType: 'unit',
        },
        test: saveCart,
      }),
      req('PATCH cart line', 'PATCH', '/v1/cart/{{cartId}}/items/{{lineId}}', {
        body: { quantity: 2 },
        test: saveCart,
      }),
      req('DELETE cart line', 'DELETE', '/v1/cart/{{cartId}}/items/{{lineId}}', { test: saveCart }),
      req('DELETE cart', 'DELETE', '/v1/cart/{{cartId}}'),
    ], 'Optional JWT — guest carts work without token'),
    folder('Checkout', [
      req('GET summary', 'GET', '/v1/checkout/{{cartId}}/summary'),
      req('PUT address', 'PUT', '/v1/checkout/{{cartId}}/address', {
        body: {
          billingSameAsShipping: true,
          shippingAddress: {
            usageTypes: ['shipping', 'billing'],
            countryCode: 'SA',
            addressLine1: 'King Fahd Road',
            city: 'Riyadh',
            postalCode: '12345',
            recipientName: 'Demo Customer',
            phone: '+966500000000',
          },
          deliveryContact: {
            usageTypes: ['delivery', 'order_notifications'],
            firstName: 'Demo',
            lastName: 'Customer',
            email: '{{demoEmail}}',
            phone: '+966500000000',
          },
        },
      }),
      req('GET shipping options', 'GET', '/v1/checkout/{{cartId}}/shipping-options'),
      req('PUT shipping', 'PUT', '/v1/checkout/{{cartId}}/shipping', {
        body: { shippingOptionId: 'standard' },
      }),
      req('POST payment intent', 'POST', '/v1/checkout/{{cartId}}/payment-intent'),
      req('POST submit order', 'POST', '/v1/checkout/{{cartId}}/submit', {
        headers: [{ key: 'Idempotency-Key', value: '{{$guid}}' }],
        body: { confirm: true },
      }),
    ], 'Requires JWT. Create cart + add items first.'),
    folder('Account', [
      req('GET summary', 'GET', '/v1/account/summary'),
      req('GET profile', 'GET', '/v1/account/profile'),
      req('PATCH profile', 'PATCH', '/v1/account/profile', {
        body: { firstName: 'Demo', lastName: 'Customer', phone: '+966500000000' },
      }),
      req('GET credits', 'GET', '/v1/account/credits', {
        query: [
          { key: 'tab', value: 'credits' },
          { key: 'page', value: '1' },
        ],
      }),
      req('POST credits withdraw', 'POST', '/v1/account/credits/withdraw', {
        body: { amount: { currency: 'SAR', amount: 100 } },
      }),
      req('GET addresses', 'GET', '/v1/account/addresses'),
      req('POST address', 'POST', '/v1/account/addresses', {
        body: {
          label: 'Office',
          usageTypes: ['shipping'],
          countryCode: 'SA',
          addressLine1: 'Olaya St',
          city: 'Riyadh',
          isDefaultShipping: true,
        },
        test: [
          'const j = pm.response.json();',
          'if (j.data?.id) pm.environment.set("addressId", j.data.id);',
        ],
      }),
      req('PATCH address', 'PATCH', '/v1/account/addresses/{{addressId}}', {
        body: { city: 'Jeddah' },
      }),
      req('POST set default address', 'POST', '/v1/account/addresses/{{addressId}}/set-default', {
        query: [{ key: 'type', value: 'shipping' }],
      }),
      req('DELETE address', 'DELETE', '/v1/account/addresses/{{addressId}}'),
      req('GET contacts', 'GET', '/v1/account/contacts'),
      req('POST contact', 'POST', '/v1/account/contacts', {
        body: {
          label: 'Primary',
          usageTypes: ['delivery'],
          firstName: 'Demo',
          lastName: 'Customer',
          email: '{{demoEmail}}',
          phone: '+966500000000',
        },
        test: [
          'const j = pm.response.json();',
          'if (j.data?.id) pm.environment.set("contactId", j.data.id);',
        ],
      }),
      req('GET contact', 'GET', '/v1/account/contacts/{{contactId}}'),
      req('PATCH contact', 'PATCH', '/v1/account/contacts/{{contactId}}', {
        body: { phone: '+966511111111' },
      }),
      req('POST set default contact', 'POST', '/v1/account/contacts/{{contactId}}/set-default', {
        query: [{ key: 'type', value: 'delivery' }],
      }),
      req('DELETE contact', 'DELETE', '/v1/account/contacts/{{contactId}}'),
      req('GET payment methods', 'GET', '/v1/account/payment-methods'),
      req('GET notifications', 'GET', '/v1/account/notifications'),
      req('PATCH notifications', 'PATCH', '/v1/account/notifications', {
        body: { orderUpdates: true, promotions: false },
      }),
      req('GET security', 'GET', '/v1/account/security'),
      req('GET orders', 'GET', '/v1/account/orders', {
        query: [{ key: 'page', value: '1' }],
      }),
      req('GET returns', 'GET', '/v1/account/returns'),
      req('GET business', 'GET', '/v1/account/business'),
      req('GET business status', 'GET', '/v1/account/business/status'),
      req('POST credit application', 'POST', '/v1/account/business/credit-application', {
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
            email: '{{demoEmail}}',
          },
        },
        test: [
          'const j = pm.response.json();',
          'if (j.data?.applicationId) pm.environment.set("applicationId", j.data.applicationId);',
        ],
      }),
      req('POST credit application document', 'POST', '/v1/account/business/credit-application/{{applicationId}}/documents', {
        formdata: [
          { key: 'file', type: 'file', src: [] },
          { key: 'documentType', value: 'trade_license', type: 'text' },
        ],
      }),
    ]),
    folder('Saved lists', [
      req('GET lists', 'GET', '/v1/lists', { query: [{ key: 'page', value: '1' }] }),
      req('POST create list', 'POST', '/v1/lists', {
        body: { name: 'Reorder list', listType: 'reorder' },
        test: saveList,
      }),
      req('GET list', 'GET', '/v1/lists/{{listId}}'),
      req('PATCH list', 'PATCH', '/v1/lists/{{listId}}', { body: { description: 'Updated' } }),
      req('GET list items', 'GET', '/v1/lists/{{listId}}/items'),
      req('POST add list item', 'POST', '/v1/lists/{{listId}}/items', {
        body: {
          productSlug: '{{productSlug}}',
          packagingOptionId: '{{packagingOptionId}}',
          quantity: 1,
          palletType: 'unit',
        },
        test: saveList,
      }),
      req('POST bulk add items', 'POST', '/v1/lists/{{listId}}/items/bulk', {
        body: {
          items: [
            {
              productSlug: 'tiger-10w30-sl-fully-synthetic',
              packagingOptionId: 'pkg-10w30-1l-x12',
              quantity: 2,
              palletType: 'unit',
            },
          ],
        },
      }),
      req('PATCH list item', 'PATCH', '/v1/lists/{{listId}}/items/{{itemId}}', {
        body: { quantity: 3 },
      }),
      req('DELETE list item', 'DELETE', '/v1/lists/{{listId}}/items/{{itemId}}'),
      req('DELETE all list items', 'DELETE', '/v1/lists/{{listId}}/items'),
      req('POST add list to cart', 'POST', '/v1/lists/{{listId}}/add-to-cart', {
        headers: [{ key: 'Idempotency-Key', value: '{{$guid}}' }],
        body: { mergeMode: 'merge' },
        test: saveCart,
      }),
      req('DELETE list', 'DELETE', '/v1/lists/{{listId}}'),
    ]),
    folder('Quotes', [
      req('POST create quote', 'POST', '/v1/quotes', {
        body: { notes: 'Bulk order inquiry' },
        test: [
          'const j = pm.response.json();',
          'if (j.data?.id) pm.environment.set("quoteId", j.data.id);',
        ],
      }),
      req('GET quote', 'GET', '/v1/quotes/{{quoteId}}'),
    ]),
  ],
};

writeFileSync(
  join(__dirname, 'Black-Tiger-Commerce-API.postman_collection.json'),
  JSON.stringify(collection, null, 2),
);
console.log('Wrote Black-Tiger-Commerce-API.postman_collection.json');

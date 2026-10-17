/**
 * One-off probe: WhatsApp Cloud OTP template + hello_world connectivity.
 * Reads local .env; does not print the access token.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(resolve(root, '.env'), 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const ver = env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
const phoneId = env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
const token = env.WHATSAPP_CLOUD_ACCESS_TOKEN;
const tpl = env.WHATSAPP_CLOUD_OTP_TEMPLATE_NAME;
const lang = env.WHATSAPP_CLOUD_OTP_TEMPLATE_LANGUAGE || 'en';
const url = `https://graph.facebook.com/${ver}/${phoneId}/messages`;

async function post(label, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`${label}_STATUS=${res.status}`);
  console.log(`${label}_BODY=${text.slice(0, 800)}`);
}

console.log(
  JSON.stringify({
    enabled: env.WHATSAPP_CLOUD_ENABLED,
    mock: env.USE_MOCK_OTP,
    template: tpl,
    language: lang,
    phoneIdConfigured: Boolean(phoneId),
    tokenLen: token?.length || 0,
  }),
);

await post('AUTH_TEMPLATE', {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: '15550145010',
  type: 'template',
  template: {
    name: tpl,
    language: { code: lang },
    components: [
      { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '123456' }],
      },
    ],
  },
});

await post('HELLO_WORLD', {
  messaging_product: 'whatsapp',
  to: '15550145010',
  type: 'template',
  template: {
    name: 'hello_world',
    language: { code: 'en_US' },
  },
});

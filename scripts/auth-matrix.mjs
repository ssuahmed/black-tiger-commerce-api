#!/usr/bin/env node
/**
 * Auth matrix smoke — B2C / B2B-ish credit app, OTP, forgot/reset.
 * Usage: node scripts/auth-matrix.mjs
 */
const API_RAW = (process.env.API_BASE || 'http://localhost:3001').replace(/\/$/, '');
const API = API_RAW.endsWith('/v1') ? API_RAW : `${API_RAW}/v1`;
const DEMO = process.env.SMOKE_EMAIL || 'demo@blacktiger.com.sa';
const PASS = process.env.SMOKE_PASSWORD || 'Password1!';

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json, data: json?.data ?? json };
}

async function main() {
  console.log(`\nAuth matrix @ ${API}\n`);

  // Policy
  {
    const r = await req('GET', '/auth/password/policy');
    record('Password policy', r.ok, r.ok ? `${r.data?.rules?.length} rules` : `HTTP ${r.status}`);
  }

  // B2C identifier → password login → refresh → logout
  let b2cAccess = '';
  let b2cRefresh = '';
  {
    const id = await req('POST', '/auth/identifier', {
      body: { identifier: DEMO, intent: 'login' },
    });
    if (!id.ok) {
      record('B2C identifier', false, `HTTP ${id.status}`);
    } else {
      record('B2C identifier', true, id.data.challengeId);
      const login = await req('POST', '/auth/login', {
        body: {
          identifier: DEMO,
          password: PASS,
          challengeId: id.data.challengeId,
        },
      });
      if (login.ok && login.data?.accessToken) {
        b2cAccess = login.data.accessToken;
        b2cRefresh = login.data.refreshToken;
        const partnerOk =
          typeof login.data.user?.id === 'string' &&
          (login.data.user.id.startsWith('partner:') ||
            process.env.ODOO_MODE !== 'live');
        record(
          'B2C password login',
          partnerOk,
          `${login.data.user?.email} id=${login.data.user?.id} segment=${login.data.user?.segment}`,
        );
        if (process.env.ODOO_MODE === 'live') {
          record(
            'B2C JWT sub is partner id',
            String(login.data.user?.id || '').startsWith('partner:'),
            String(login.data.user?.id || ''),
          );
        }
      } else {
        record('B2C password login', false, `HTTP ${login.status} ${JSON.stringify(login.data)}`);
      }
    }
  }

  // OTP login (mock code 123456 when USE_MOCK_OTP=true)
  {
    const id = await req('POST', '/auth/identifier', {
      body: { identifier: DEMO, intent: 'login' },
    });
    const cid = id.data?.challengeId;
    const send = await req('POST', '/auth/otp/send', {
      body: { challengeId: cid, purpose: 'login' },
    });
    record('OTP send (login)', send.ok, send.ok ? send.data?.maskedDestination : `HTTP ${send.status}`);
    const resend = await req('POST', '/auth/otp/resend', { body: { challengeId: cid } });
    record(
      'OTP resend',
      resend.ok || resend.status === 429,
      resend.ok ? 'ok' : resend.status === 429 ? 'cooldown 429' : `HTTP ${resend.status}`,
    );
    const verify = await req('POST', '/auth/otp/verify', {
      body: { challengeId: cid, code: '123456', purpose: 'login' },
    });
    record(
      'OTP verify (mock 123456)',
      Boolean(verify.ok && verify.data?.accessToken),
      verify.ok ? verify.data?.user?.email : `HTTP ${verify.status}`,
    );
  }

  // Forgot / reset — email_link
  {
    const forgot = await req('POST', '/auth/password/forgot', {
      body: { identifier: DEMO, preferredMethod: 'email_link' },
    });
    const token =
      forgot.data?.resetToken ||
      forgot.data?.token ||
      forgot.data?.resetSessionToken;
    record(
      'Forgot password (email_link)',
      forgot.ok,
      forgot.ok
        ? `method=${forgot.data?.deliveryMethod} token=${Boolean(token)}`
        : `HTTP ${forgot.status}`,
    );
    if (token) {
      const reset = await req('POST', '/auth/password/reset', {
        body: {
          resetToken: token,
          password: PASS,
          confirmPassword: PASS,
        },
      });
      // DTO may use password not newPassword
      const reset2 = reset.ok
        ? reset
        : await req('POST', '/auth/password/reset', {
            body: {
              resetToken: token,
              resetSessionToken: token,
              password: PASS,
              confirmPassword: PASS,
            },
          });
      record('Reset password (token)', reset2.ok, reset2.ok ? 'ok' : `HTTP ${reset2.status}`);
    }
  }

  // Forgot / reset — OTP
  {
    const forgot = await req('POST', '/auth/password/forgot', {
      body: { identifier: DEMO, preferredMethod: 'otp' },
    });
    const cid = forgot.data?.challengeId;
    record('Forgot password (otp)', forgot.ok && Boolean(cid), cid || `HTTP ${forgot.status}`);
    if (cid) {
      await req('POST', '/auth/otp/send', {
        body: { challengeId: cid, purpose: 'reset_password' },
      });
      const reset = await req('POST', '/auth/password/reset', {
        body: {
          challengeId: cid,
          code: '123456',
          password: PASS,
          confirmPassword: PASS,
        },
      });
      record('Reset password (OTP)', reset.ok, reset.ok ? 'ok' : `HTTP ${reset.status}`);
    }
  }

  // Refresh + logout
  if (b2cRefresh) {
    const ref = await req('POST', '/auth/refresh', {
      body: { refreshToken: b2cRefresh },
    });
    record('Refresh token', Boolean(ref.ok && ref.data?.accessToken));
    const logout = await req('POST', '/auth/logout', {
      body: { refreshToken: b2cRefresh },
      token: ref.data?.accessToken || b2cAccess,
    });
    record('Logout', logout.ok || logout.status === 200 || logout.status === 201, `HTTP ${logout.status}`);
  }

  // Register B2C
  const b2cEmail = `smoke.b2c.${Date.now()}@example.com`;
  {
    const reg = await req('POST', '/auth/register', {
      body: {
        email: b2cEmail,
        password: PASS,
        confirmPassword: PASS,
        acceptTerms: true,
      },
    });
    record(
      'B2C register',
      Boolean(reg.ok && reg.data?.accessToken),
      reg.ok ? `${b2cEmail} segment=${reg.data?.user?.segment}` : `HTTP ${reg.status}`,
    );
  }

  // B2B-style: register + credit application
  const b2bEmail = `smoke.b2b.${Date.now()}@example.com`;
  {
    const reg = await req('POST', '/auth/register', {
      body: {
        email: b2bEmail,
        password: PASS,
        confirmPassword: PASS,
        acceptTerms: true,
      },
    });
    const token = reg.data?.accessToken;
    record('B2B candidate register', Boolean(token), b2bEmail);
    if (token) {
      const app = await req('POST', '/account/business/credit-application', {
        token,
        body: {
          billing: {
            countryCode: 'SA',
            companyName: 'Smoke Trading LLC',
            addressLine1: 'King Fahd Rd',
            city: 'Riyadh',
            stateCode: '01',
            postalCode: '12345',
          },
          preferences: {
            accountsPayablePhone: '+966500000000',
            accountsPayableEmail: 'ap@smoke.example',
            currency: 'SAR',
            creditLimitDesired: 50000,
          },
          invoiceDelivery: { email: 'invoices@smoke.example' },
          submitter: {
            name: 'Smoke B2B',
            title: 'Buyer',
            phone: '+966500000000',
            email: b2bEmail,
          },
        },
      });
      record(
        'B2B credit application',
        app.ok,
        app.ok
          ? `id=${app.data?.applicationId || app.data?.id} status=${app.data?.status}`
          : `HTTP ${app.status}`,
      );
      const status = await req('GET', '/account/business/status', { token });
      record(
        'B2B business status',
        status.ok,
        status.ok ? JSON.stringify(status.data).slice(0, 120) : `HTTP ${status.status}`,
      );
      const sum = await req('GET', '/account/summary', { token });
      record(
        'Account summary after credit app',
        sum.ok,
        sum.ok
          ? `segment=${sum.data?.segment} approval=${sum.data?.approvalStatus}`
          : `HTTP ${sum.status}`,
      );
    }
  }

  // Re-login demo after resets
  {
    const id = await req('POST', '/auth/identifier', {
      body: { identifier: DEMO, intent: 'login' },
    });
    const login = await req('POST', '/auth/login', {
      body: {
        identifier: DEMO,
        password: PASS,
        challengeId: id.data?.challengeId,
      },
    });
    record('Demo re-login after resets', Boolean(login.ok && login.data?.accessToken));
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n--- Auth matrix: ${results.length - failed} passed, ${failed} failed ---\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

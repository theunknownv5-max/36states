// Paystack (Nigerian card, bank transfer and USSD payments). Needs PAYSTACK_SECRET_KEY.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = (process.env.PAYSTACK_BASE || 'https://api.paystack.co').replace(/\/+$/, '');
const KEY = () => (process.env.PAYSTACK_SECRET_KEY || '').trim();

export const paystackReady = () => !!KEY();
export const paystackMode = () => (KEY().startsWith('sk_live') ? 'live' : KEY() ? 'test' : 'off');

async function call(method, path, body) {
  if (!KEY()) throw new Error('Payments are not switched on yet (PAYSTACK_SECRET_KEY missing).');
  const r = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${KEY()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw new Error(j.message || `Paystack error ${r.status}`);
  return j.data;
}

// Start a payment; the advertiser is sent to authorization_url and comes back to callbackUrl.
export const initialize = ({ email, amountKobo, reference, callbackUrl, metadata }) =>
  call('POST', '/transaction/initialize', { email, amount: amountKobo, reference, callback_url: callbackUrl, metadata, currency: 'NGN' });

export const verify = (reference) => call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

export const refund = (reference, amountKobo) => call('POST', '/refund', { transaction: reference, ...(amountKobo ? { amount: amountKobo } : {}) });

// Webhooks are signed with HMAC-SHA512 of the raw body using the secret key.
export function validSignature(raw, signature) {
  if (!KEY() || typeof signature !== 'string') return false;
  const want = Buffer.from(createHmac('sha512', KEY()).update(raw).digest('hex'));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

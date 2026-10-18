// Stripe Checkout (cards, Apple Pay and Google Pay outside Africa). Needs STRIPE_SECRET_KEY in the
// server environment, and STRIPE_WEBHOOK_SECRET for the webhook (/api/stripe/webhook).
// Talks to the Stripe REST API directly (form-encoded), so no extra package is needed.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = (process.env.STRIPE_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const KEY = () => (process.env.STRIPE_SECRET_KEY || '').trim();
const HOOK = () => (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

export const stripeReady = () => !!KEY();
export const stripeMode = () => (KEY().startsWith('sk_live') ? 'live' : KEY() ? 'test' : 'off');

// { a: { b: 1 }, c: [ { d: 2 } ] } -> a[b]=1&c[0][d]=2
export function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(method, path, body) {
  if (!KEY()) throw new Error('Card payments are not switched on yet (STRIPE_SECRET_KEY missing).');
  const r = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${KEY()}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: body ? form(body).toString() : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Stripe error ${r.status}`);
  return j;
}

// Start a payment; the advertiser goes to url and comes back to successUrl.
export const checkout = ({ email, amountCents, currency = 'usd', reference, name, successUrl, cancelUrl, metadata = {} }) =>
  call('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    customer_email: email,
    client_reference_id: reference,
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [{ quantity: 1, price_data: { currency, unit_amount: amountCents, product_data: { name } } }],
    metadata: { reference, ...metadata },
    payment_intent_data: { metadata: { reference, ...metadata } }
  });

export const session = (id) => call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);

export const refund = (paymentIntent) => call('POST', '/v1/refunds', { payment_intent: paymentIntent });

// Stripe-Signature: t=<time>,v1=<hmac sha256 of "t.body" with the webhook secret>. 5 minute window.
export function validSignature(raw, header, now = Date.now()) {
  if (!HOOK() || typeof header !== 'string') return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const want = Buffer.from(createHmac('sha256', HOOK()).update(`${t}.`).update(raw).digest('hex'));
  return header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const got = Buffer.from(p.slice(3));
      return got.length === want.length && timingSafeEqual(got, want);
    });
}

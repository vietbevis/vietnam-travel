const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const intentLifetime = 24 * 60 * 60 * 1000;
const guestLifetime = 30 * 24 * 60 * 60 * 1000;
const objectId = /^[a-f0-9]{24}$/i;
const signedGuest = /^([A-Za-z0-9_-]{43})\.([0-9]{13})\.([a-f0-9]{64})$/;
const signedIntent = /^([a-f0-9]{32})\.([0-9]{13})\.([a-f0-9]{64})$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const intentExpired = (issuedAt, now = Date.now()) => now - issuedAt >= intentLifetime;

function sign(purpose, ...parts) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Checkout signing key is not configured.');
  return createHmac('sha256', secret).update(JSON.stringify([purpose, ...parts])).digest('hex');
}

function matches(expected, actual) {
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

const usesSecureCookie = req => Boolean(req.secure) || process.env.NODE_ENV === 'production';
const cookieName = req => usesSecureCookie(req) ? '__Host-travelCheckout' : 'travelCheckout';
const customerId = req => {
  const id = String(req.customer?._id || '');
  return objectId.test(id) ? id.toLowerCase() : null;
};

function guestScope(req) {
  const value = req.cookies?.[cookieName(req)];
  const parts = typeof value === 'string' && signedGuest.exec(value);
  if (!parts) return null;
  const issuedAt = Number(parts[2]);
  const age = Date.now() - issuedAt;
  if (age < -60000 || age >= guestLifetime || !matches(sign('tour-guest-v1', parts[1], issuedAt), parts[3])) return null;
  return 'guest:' + hash(parts[1]);
}

function checkoutScope(req) {
  if (req.customer) {
    const owner = customerId(req);
    return owner ? 'customer:' + owner : null;
  }
  return guestScope(req);
}

function openCheckout(req, res) {
  const existing = checkoutScope(req);
  if (existing || req.customer) return existing;
  const nonce = randomBytes(32).toString('base64url');
  const issuedAt = Date.now();
  res.cookie(cookieName(req), [nonce, issuedAt, sign('tour-guest-v1', nonce, issuedAt)].join('.'), {
    httpOnly: true, sameSite: 'lax', secure: usesSecureCookie(req), path: '/', maxAge: guestLifetime
  });
  return 'guest:' + hash(nonce);
}

function issueIntent(scope, now = Date.now()) {
  const key = randomBytes(16).toString('hex');
  return [key, now, sign('tour-intent-v2', scope, key, now)].join('.');
}

function verifyIntent(scope, input, now = Date.now()) {
  const parts = typeof input === 'string' && signedIntent.exec(input);
  if (!scope || !parts) return null;
  const issuedAt = Number(parts[2]);
  if (issuedAt > now + 60000) return null;
  const fenced = matches(sign('tour-intent-v2', scope, parts[1], issuedAt), parts[3]);
  if (!fenced && !matches(sign('tour-intent-v1', scope, parts[1], issuedAt), parts[3])) return null;
  return { key: parts[1], issuedAt, expired: intentExpired(issuedAt, now), fenced };
}

function orderAccessFilter(req) {
  if (req.customer) {
    const owner = customerId(req);
    return owner ? { customerId: owner } : null;
  }
  const scope = guestScope(req);
  return scope ? { 'checkout.scope': scope, customerId: { $exists: false } } : null;
}

module.exports = { checkoutScope, openCheckout, issueIntent, verifyIntent, intentExpired, orderAccessFilter, hash };

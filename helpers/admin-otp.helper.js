const crypto = require('node:crypto');
const Forgot = require('../models/forgot-password.model');
const { version } = require('./admin-token.helper');

const purpose = 'admin-reset';
const windowMs = 15 * 60 * 1000;
const lifetime = 5 * 60 * 1000;
const digest = (...parts) => crypto.createHmac('sha256', process.env.JWT_SECRET)
  .update(JSON.stringify([purpose, ...parts])).digest('hex');

async function quota(kind, email, ip, now) {
  const window = Math.floor(+now / windowMs);
  const limits = { login: [100, 15], send: [30, 5], verify: [100, 20] };
  const [ipLimit, emailLimit] = limits[kind];
  for (const [scope, value, limit] of [['ip', ip, ipLimit], ['email', email, emailLimit]]) {
    const key = digest('limit', kind, scope, value, window);
    try {
      await Forgot.updateOne(
        { key, count: { $lt: limit } },
        { $inc: { count: 1 }, $setOnInsert: { key, purpose: kind === 'login' ? 'admin-login-limit' : 'admin-reset-limit', expireAt: new Date((window + 1) * windowMs) } },
        { upsert: true, setDefaultsOnInsert: false }
      );
    } catch (error) {
      if (error.code === 11000) return false;
      throw error;
    }
  }
  return true;
}

async function createCode(email, account, now) {
  const key = digest('code-key', email);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  const customerId = account ? account.id : '';
  const otpHash = digest('code', email, customerId, account ? version(account) : 0, salt, code);
  try {
    await Forgot.updateOne(
      { key, $or: [{ nextSendAt: { $lte: now } }, { nextSendAt: { $exists: false } }] },
      { $set: {
        key, purpose, email, customerId, salt, otpHash, attempts: 0,
        expireAt: new Date(+now + lifetime), nextSendAt: new Date(+now + 60000)
      }, $unset: { otp: 1, consumedAt: 1 } },
      { upsert: true }
    );
    return code;
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

async function consumeCode(email, code, account, now) {
  const key = digest('code-key', email);
  const latest = await Forgot.exists({ key });
  // Valid, unexpired codes sent before deployment remain usable within the
  // same attempt limit. New requests always store a keyed hash.
  const identity = latest ? { key } : {
    key: { $exists: false }, email: account.email,
    $or: [{ purpose }, { purpose: { $exists: false } }]
  };
  const row = await Forgot.findOneAndUpdate({
    ...identity, expireAt: { $gt: now },
    $and: [{ $or: [{ attempts: { $lt: 5 } }, { attempts: { $exists: false } }] }]
  }, { $inc: { attempts: 1 } }, { new: true, sort: { createdAt: -1 } }).lean();
  if (!row) return false;
  const same = (left, right) => typeof right === 'string' && left.length === right.length &&
    crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
  const valid = latest
    ? row.customerId === account.id && same(digest('code', email, account.id, version(account), row.salt, code), row.otpHash)
    : version(account) === 0 && same(code, row.otp);
  if (!valid) return false;
  const proof = latest ? { otpHash: row.otpHash } : { otp: row.otp };
  const won = await Forgot.updateOne({ _id: row._id, ...proof, expireAt: { $gt: new Date() } }, {
    $set: { consumedAt: new Date(), attempts: 5 },
    $unset: { otp: 1, otpHash: 1, salt: 1 }
  });
  return won.modifiedCount === 1;
}

module.exports = { quota, createCode, consumeCode };

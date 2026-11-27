'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHmac } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const qs = require('qs');

const root = path.resolve(__dirname, '..');
const website = 'http://127.0.0.1:3302';
const mock = 'http://localhost:3303';
const mongoAddress = '127.0.0.1:27022';
const replica = 'vtG16Manual';
const password = 'G16Fixture-2026!';
const domain = '@g1.example.com';

async function connectFixture() {
  const run = process.env.G16_RUN_ID;
  const expected = 'mongodb://' + mongoAddress + '/vietnam-travel-g16-acceptance-' + run + '?directConnection=true&replicaSet=' + replica;
  const expectedDir = path.join(root, '.superpowers', 'g16-manual', run || '');
  if (!/^[0-9a-f]{16}$/.test(run || '') || process.env.DATABASE !== expected || process.cwd() !== expectedDir ||
      fs.existsSync(path.join(expectedDir, '.env')) || process.env.PORT !== '3302' ||
      process.env.CARD_AGENT_URL !== 'http://127.0.0.1:32033' || process.env.DOMAIN_WEBSITE !== website ||
      process.env.ZALOPAY_DOMAIN !== mock + '/zalo' || process.env.VNPAY_URL !== mock + '/vnpay' ||
      process.env.CARD_SERVER_KEY_PATH !== path.join(root, 'smartcard', 'test-vectors', 'server-test-key.pem')) {
    throw new Error('Hay khoi dong website fixture qua scripts/acceptance-g1.cjs.');
  }
  await mongoose.connect(expected, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 3000 });
  const admin = mongoose.connection.db.admin();
  const hello = await admin.command({ hello: 1 });
  const options = await admin.command({ getCmdLineOpts: 1 });
  if (!hello.isWritablePrimary || hello.setName !== replica || hello.me !== mongoAddress ||
      path.resolve(options.parsed?.storage?.dbPath || '') !== path.join(expectedDir, 'db')) {
    throw new Error('MongoDB khong phai fixture cua lan khoi dong nay.');
  }
  if ((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length !== 0) {
    throw new Error('Fixture chi duoc seed tren database moi.');
  }
  mongoose.set('autoIndex', true);
  mongoose.set('autoCreate', true);
  await mongoose.disconnect();
  await mongoose.connect(expected, { serverSelectionTimeoutMS: 3000 });
}

async function seedFixtures() {
  const model = name => require('../models/' + name + '.model');
  const Role = model('role'), Account = model('account-admin');
  const Category = model('category'), Tour = model('tour'), Order = model('order');
  const City = model('city'), Customer = model('customer');
  const all = require('../config/permission').permissionList.map(item => item.value);
  const [admin, categoryReader, cardReader] = await Role.create([
    { name: 'G1 Fixture - Full permissions', permissions: all },
    { name: 'G1 Fixture - Category view', permissions: ['category-view'] },
    { name: 'G1 Fixture - Card view', permissions: ['card-view'] }
  ]);
  const hash = await bcrypt.hash(password, 10);
  const [actor] = await Account.create([
    { fullName: 'G1 Fixture Admin', email: 'admin' + domain, role: admin.id, password: hash, status: 'active' },
    { fullName: 'G1 Fixture Backup', email: 'backup' + domain, role: admin.id, password: hash, status: 'active' },
    { fullName: 'G1 Category Reader', email: 'viewer' + domain, role: categoryReader.id, password: hash, status: 'active' },
    { fullName: 'G1 Card Reader', email: 'cardreader' + domain, role: cardReader.id, password: hash, status: 'active' }
  ]);
  const city = await City.create({ name: 'Hà Nội - G1 fixture' });
  const categories = await Category.create(Array.from({ length: 12 }, (_, i) => ({
    name: 'G1 Fixture ' + String(i + 1).padStart(2, '0'), status: 'active', position: 12 - i, createdBy: actor.id
  })));
  const departureDate = new Date(Date.now() + 86400000);
  const common = {
    category: categories[0].id, locations: [city.id], departureDate, avatar: '/assets/images/product-1.jpg',
    stockAdult: 12, stockChildren: 10, stockBaby: 10, priceAdult: 300000, priceChildren: 150000, priceBaby: 0,
    priceNewAdult: 300000, priceNewChildren: 150000, priceNewBaby: 0,
    time: '1 ngày', vehicle: 'Ô tô', information: '<p>Tour mẫu G1.6</p>',
    schedules: [{ title: 'Ngày 1', description: '<p>Hà Nội</p>' }], createdBy: actor.id
  };
  const [tour, , , linkedTrash] = await Tour.create([
    { ...common, name: 'G1 Tour Có Chỗ', slug: 'g1-tour-co-cho', status: 'active', position: 10 },
    { ...common, name: 'G1 Tour Hết Chỗ', slug: 'g1-tour-het-cho', status: 'active', stockAdult: 0, stockChildren: 0, stockBaby: 0 },
    { ...common, name: 'G1 Trash Trống', status: 'inactive', deleted: true, deletedAt: new Date() },
    { ...common, name: 'G1 Trash Có Đơn Cũ', status: 'inactive', deleted: true, deletedAt: new Date() },
    { ...common, name: 'G1 Trash Thiếu Danh Mục', category: new mongoose.Types.ObjectId().toHexString(), status: 'inactive', deleted: true, deletedAt: new Date() }
  ]);
  const customer = await Customer.create({
    fullName: 'Khách G1 Fixture', email: 'customer' + domain, phone: '0900000022',
    dob: new Date('1990-02-03'), status: 'active'
  });
  await model('setting-website-info').create({ websiteName: 'KMA Travel - G1 Fixture', logo: '/assets/images/logo.png' });
  const booking = {
    fullName: 'Khách G1 Fixture', phone: '0900000022', status: 'initial', paymentStatus: 'unpaid',
    paymentMethod: 'money', subTotal: 300000, discount: 0, total: 300000
  };
  function item(entry) {
    return { tourId: entry.id, name: entry.name, avatar: entry.avatar, locationFrom: city.id, departureDate,
      quantityAdult: 1, quantityChildren: 0, quantityBaby: 0, priceNewAdult: 300000, priceNewChildren: 150000, priceNewBaby: 0 };
  }
  await Order.create([
    { ...booking, orderCode: 'G1-LEGACY', items: [item(tour)] },
    { ...booking, orderCode: 'G1-TRASH-ORDER', deleted: true, items: [item(linkedTrash)] },
    { ...booking, orderCode: 'G1-WALLET', customerId: customer.id, paymentMethod: 'card', items: [item(tour)] }
  ]);
  return { tourId: tour.id, cityId: city.id };
}

function mockServices(fixture) {
  const mailbox = [];
  const images = new Map();
  const jobs = new Map();
  const app = express();
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['localhost:3303', '127.0.0.1:3303'].includes(req.get('host'))) return res.sendStatus(403);
    next();
  });

  const mail = require('../helpers/mail.helper');
  mail.sendMail = async (to, subject, content) => {
    if (typeof to !== 'string' || !to.endsWith(domain)) return { sent: false };
    mailbox.push({ to, subject, body: String(content).replace(/<[^>]*>/g, '') });
    if (mailbox.length > 100) mailbox.shift();
    return { sent: true };
  };
  app.get('/mailbox', (req, res) => res.type('text').send(
    mailbox.slice().reverse().map(item => [item.to, item.subject, item.body].join('\n')).join('\n\n') ||
    'Hop thu fixture chua co thu.'));
  app.get('/fixture-ids', (req, res) => res.json(fixture));

  const cloudinary = require('../helpers/cloudinary.helper');
  const storeMockImage = (bytes, folder) => {
    const id = randomUUID();
    if (images.size >= 20) images.delete(images.keys().next().value);
    images.set(id, Buffer.from(bytes));
    return { url: mock + '/images/' + id, publicId: folder + '/' + id };
  };
  cloudinary.uploadFormImage = async bytes => storeMockImage(bytes, 'travel-form-uploads');
  cloudinary.uploadTourImage = async bytes => storeMockImage(bytes, 'travel-tour-uploads');
  cloudinary.removeNewTourImage = async publicId => { images.delete(publicId.split('/').at(-1)); };
  cloudinary.removeNewFormImage = cloudinary.removeNewTourImage;
  cloudinary.uploadPhoto = async () => ({ secure_url: 'https://fixture.invalid/photo.jpg' });
  app.get('/images/:id', (req, res) => {
    const bytes = images.get(req.params.id);
    if (!bytes) return res.sendStatus(404);
    const kind = bytes[0] === 255 ? 'jpeg' : bytes[0] === 137 ? 'png' : bytes[0] === 71 ? 'gif' : 'webp';
    res.set('X-Content-Type-Options', 'nosniff').type('image/' + kind).send(bytes);
  });

  const validReturn = (url, paths) => {
    const parsed = new URL(url);
    if (parsed.origin !== website || !paths.includes(parsed.pathname)) throw new Error('Outside fixture');
    return parsed;
  };
  const confirmation = res => res.type('html').send(
    '<meta charset="UTF-8"><title>G1 mock</title><h1>Thanh toán mô phỏng G1</h1>' +
    '<form method="post"><button>Xác nhận thanh toán mô phỏng</button></form>');
  function addJob(info) {
    const id = randomUUID();
    jobs.set(id, info);
    if (jobs.size > 100) jobs.delete(jobs.keys().next().value);
    return mock + '/pay/' + id;
  }

  app.get('/vnpay', (req, res) => {
    try {
      if (!require('../helpers/vnpay.helper').verifyReturn(req.query).valid) return res.sendStatus(400);
      const url = validReturn(req.query.vnp_ReturnUrl, ['/order/payment-vnpay-result', '/card-api/topup-vnpay-result']);
      const params = {
        vnp_TmnCode: process.env.VNPAY_CODE, vnp_TxnRef: req.query.vnp_TxnRef,
        vnp_Amount: req.query.vnp_Amount, vnp_ResponseCode: '00', vnp_TransactionStatus: '00'
      };
      const serial = qs.stringify(require('../helpers/sort.helper').sortObject(params), { encode: false });
      const checksum = createHmac('sha512', process.env.VNPAY_SECRET).update(serial).digest('hex');
      url.search = serial + '&vnp_SecureHash=' + checksum;
      return res.redirect(addJob({ redirect: url.href }));
    } catch { return res.sendStatus(400); }
  });

  app.post('/zalo/v2/create', (req, res) => {
    try {
      const from = req.query;
      const fields = ['app_id', 'app_trans_id', 'app_user', 'amount', 'app_time', 'embed_data', 'item'];
      if (fields.some(field => typeof from[field] !== 'string')) return res.sendStatus(400);
      const mac = createHmac('sha256', process.env.ZALOPAY_KEY1).update(fields.map(field => from[field]).join('|')).digest('hex');
      if (from.mac !== mac) return res.sendStatus(400);
      const redirect = validReturn(JSON.parse(from.embed_data).redirecturl, ['/order/success', '/account/card', '/account/card/return']).href;
      const callback = validReturn(from.callback_url, ['/order/payment-zalopay-result', '/card-api/topup-zalopay-result']).href;
      const data = JSON.stringify({ app_id: from.app_id, app_trans_id: from.app_trans_id, app_user: from.app_user, amount: Number(from.amount) });
      const body = { data, mac: createHmac('sha256', process.env.ZALOPAY_KEY2).update(data).digest('hex'), type: 1 };
      return res.json({ return_code: 1, order_url: addJob({ redirect, callback, body }) });
    } catch { return res.sendStatus(400); }
  });

  app.get('/pay/:id', (req, res) => jobs.has(req.params.id) ? confirmation(res) : res.sendStatus(404));
  app.post('/pay/:id', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.sendStatus(404);
    try {
      if (job.callback) {
        const ack = await fetch(job.callback, {
          method: 'POST', body: JSON.stringify(job.body), signal: AbortSignal.timeout(3000),
          headers: { 'Content-Type': 'application/json' }, redirect: 'error'
        });
        if ((await ack.json()).return_code !== 1) return res.status(409).type('text').send('Website fixture refused callback.');
      }
      return res.redirect(job.redirect);
    } catch { return res.sendStatus(502); }
  });
  return app;
}

async function run() {
  await connectFixture();
  const fixture = await seedFixtures();
  const original = express.application.listen;
  express.application.listen = function loopback(port, callback) {
    if (port !== 3302) throw new Error('Cong website fixture phai la 3302.');
    return original.call(this, port, '127.0.0.1', callback);
  };
  const mockApp = mockServices(fixture);
  await new Promise((resolve, reject) => {
    const server = original.call(mockApp, 3303, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  require('../index.js');
}

run().catch(async error => {
  console.error('Fixture init failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});

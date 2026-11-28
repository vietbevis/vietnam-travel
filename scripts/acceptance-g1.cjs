'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { MongoClient } = require('mongodb');

const root = path.resolve(__dirname, '..');
const runs = path.join(root, '.superpowers', 'g16-manual');
const ports = { website: 3302, mock: 3303, mongo: 27022, agent: 32033 };
const web = 'http://127.0.0.1:' + ports.website;
const mock = 'http://localhost:' + ports.mock;
const agent = 'http://127.0.0.1:' + ports.agent;
const replica = 'vtG16Manual';
const mongoAddress = '127.0.0.1:' + ports.mongo;
const mongoBase = 'mongodb://' + mongoAddress;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const children = [];
let stopping = false;

function mongoExecutable() {
  const directory = path.join(process.env.ProgramFiles || 'C:/Program Files', 'MongoDB', 'Server');
  const automatic = fs.existsSync(directory) ? fs.readdirSync(directory).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .map(version => path.join(directory, version, 'bin', 'mongod.exe')).find(candidate => fs.existsSync(candidate)) : undefined;
  const candidate = process.env.G16_MONGOD || automatic;
  if (!candidate || !path.isAbsolute(candidate) || !fs.existsSync(candidate)) {
    throw new Error('Can tim mongod.exe. Dat G16_MONGOD bang duong dan tuyet doi.');
  }
  return candidate;
}

function agentClasspath() {
  const distribution = path.join(root, 'smartcard', 'agent', 'build', 'install', 'agent', 'lib');
  if (fs.existsSync(distribution) && fs.readdirSync(distribution).some(entry => entry.endsWith('.jar'))) {
    return path.join(distribution, '*');
  }
  const audit = path.join(root, '.superpowers', 'audit-phase0', 'java');
  const paths = ['classes', 'gson-2.11.0', 'jcardsim-3.0.5.11'].map(name => path.join(audit, name));
  if (paths.every(candidate => fs.existsSync(candidate)) &&
      fs.existsSync(path.join(paths[0], 'vn', 'travel', 'agent', 'AgentMain.class'))) return paths.join(path.delimiter);
  throw new Error('Chua co Card Agent build. Tu smartcard, chay .\\gradlew.bat :agent:installDist roi chay lai.');
}

async function assertPortFree(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error('Cong fixture ' + port + ' dang duoc su dung. Script se dung.')));
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => probe.close(resolve));
}

function startChild(directory, name, executable, args, options = {}) {
  const log = fs.openSync(path.join(directory, name + '.log'), 'a');
  try {
    const child = spawn(executable, args, {
      cwd: directory, env: runtimeEnvironment(), windowsHide: true, stdio: ['ignore', log, log], ...options
    });
    const stopped = new Promise(resolve => {
      child.once('error', () => resolve(name + ' khong khoi dong duoc. Xem ' + name + '.log.'));
      child.once('exit', code => resolve(name + ' da dung (ma ' + code + '). Xem ' + name + '.log.'));
    });
    children.push({ child, stopped });
    return child;
  } finally {
    fs.closeSync(log);
  }
}

async function waitFor(readiness, problem) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (stopping) throw new Error('Fixture da nhan lenh dung.');
    if (await readiness().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(problem);
}

async function initializeReplica(directory) {
  const connection = new MongoClient(mongoBase + '/admin?directConnection=true', { serverSelectionTimeoutMS: 750 });
  try {
    await waitFor(async () => { await connection.connect(); return true; }, 'Mongo fixture khong khoi dong.');
    const admin = connection.db('admin');
    const hello = await admin.command({ hello: 1 });
    const options = await admin.command({ getCmdLineOpts: 1 });
    if (!hello.isreplicaset || hello.setName ||
        path.resolve(options.parsed?.storage?.dbPath || '') !== path.join(directory, 'db')) {
      throw new Error('Chi khoi tao replica tren tien trinh Mongo fixture moi.');
    }
    await admin.command({ replSetInitiate: { _id: replica, members: [{ _id: 0, host: mongoAddress }] } });
    await waitFor(async () => {
      const ready = await admin.command({ hello: 1 });
      return ready.setName === replica && ready.isWritablePrimary && ready.me === mongoAddress &&
        Array.isArray(ready.hosts) && ready.hosts.length === 1 && ready.hosts[0] === mongoAddress;
    }, 'Mongo fixture khong tro thanh PRIMARY.');
  } finally {
    await connection.close();
  }
}

function runtimeEnvironment() {
  const inherited = {};
  for (const key of ['ComSpec', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  return inherited;
}

function isolatedEnvironment(runId, mode) {
  return {
    ...runtimeEnvironment(), NODE_ENV: 'development', G16_RUN_ID: runId,
    ...(mode === '--g2' ? { G2_ACCEPTANCE: '1' } : {}),
    ...(mode === '--g3' ? { G3_ACCEPTANCE: '1' } : {}),
    DATABASE: mongoBase + '/vietnam-travel-g16-acceptance-' + runId + '?directConnection=true&replicaSet=' + replica,
    PORT: String(ports.website), CARD_AGENT_URL: agent, DOMAIN_WEBSITE: web,
    CARD_SERVER_KEY_PATH: path.join(root, 'smartcard', 'test-vectors', 'server-test-key.pem'),
    JWT_SECRET: randomBytes(32).toString('hex'), SESSION_SECRET: randomBytes(32).toString('hex'),
    CARD_ESCROW_MASTER: randomBytes(32).toString('hex'),
    TINYMCE_API_KEY: process.env.G18_TINYMCE_API_KEY || '',
    VNPAY_CODE: 'G16TEST', VNPAY_SECRET: randomBytes(32).toString('hex'), VNPAY_URL: mock + '/vnpay',
    ZALOPAY_APPID: '2554', ZALOPAY_KEY1: randomBytes(32).toString('hex'),
    ZALOPAY_KEY2: randomBytes(32).toString('hex'), ZALOPAY_DOMAIN: mock + '/zalo'
  };
}

async function run(requestStop, mode) {
  const classpath = agentClasspath();
  const mongod = mongoExecutable();
  for (const port of Object.values(ports)) await assertPortFree(port);
  const runId = randomBytes(8).toString('hex');
  fs.mkdirSync(runs, { recursive: true });
  const directory = path.join(runs, runId);
  fs.mkdirSync(directory);
  fs.mkdirSync(path.join(directory, 'db'));
  fs.writeFileSync(path.join(directory, 'agent.properties'), 'port=' + ports.agent + '\nmode=sim\nallowedOrigins=' + web + '\n', 'ascii');
  const stopFile = path.join(directory, 'stop.request');
  const stopTimer = setInterval(() => {
    if (fs.existsSync(stopFile)) requestStop('SIGTERM');
  }, 250);
  stopTimer.unref();
  console.log('Fixture folder:', directory);
  console.log('Run ID:', runId);

  startChild(directory, 'mongo', mongod, [
    '--port', String(ports.mongo), '--bind_ip', '127.0.0.1', '--replSet', replica, '--dbpath', path.join(directory, 'db')
  ]);
  await initializeReplica(directory);
  const simulator = startChild(directory, 'agent', 'java', ['-cp', classpath, 'vn.travel.agent.AgentMain']);
  await waitFor(async () => {
    if (simulator.exitCode !== null) return false;
    const status = await fetch(agent + '/v1/status', { headers: { Origin: web }, signal: AbortSignal.timeout(1000) });
    return status.ok && (await status.json()).mode === 'sim';
  }, 'Card Agent fixture khong khoi dong hoac Origin khong khop.');
  startChild(directory, 'website', process.execPath, [path.join(__dirname, 'acceptance-g1-web.cjs')], { env: isolatedEnvironment(runId, mode) });
  await waitFor(async () => {
    const response = await fetch(web + '/admin/account/login', { signal: AbortSignal.timeout(1000) });
    return response.ok;
  }, 'Website fixture khong khoi dong. Xem website.log.');
  console.log('READY', web, mock + '/mailbox', agent);
  console.log('Dung bang Ctrl+C trong cua so nay.');
}

async function main() {
  const [command, runId] = process.argv.slice(2);
  const fixtureMode = ['--g2', '--g3'].includes(command) && process.argv.length === 3;
  if (command && !fixtureMode) {
    if (command !== '--stop' || !/^[a-f0-9]{16}$/.test(runId || '') || process.argv.length !== 4) {
      throw new Error('Cach dung: node scripts/acceptance-g1.cjs [--g2 | --g3 | --stop RunID]');
    }
    fs.writeFileSync(path.join(runs, runId, 'stop.request'), '', { flag: 'a' });
    console.log('Da gui yeu cau dung fixture', runId);
    return;
  }
  let requestStop;
  const stop = new Promise(resolve => {
    requestStop = signal => {
      stopping = true;
      resolve(signal);
    };
  });
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  try {
    await run(requestStop, command);
    const stopped = await Promise.race([stop, ...children.map(entry => entry.stopped)]);
    if (typeof stopped === 'string' && !['SIGINT', 'SIGTERM'].includes(stopped)) throw new Error(stopped);
  } catch (error) {
    if (!stopping) throw error;
  } finally {
    for (const { child } of children.slice().reverse()) {
      if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
    }
    await Promise.all(children.map(entry => entry.stopped));
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

const mongoose = require('mongoose');

const enabled = !!process.env.TEST_DATABASE;
const TEST_NAME = 'vietnam-travel-smartcard-test';
let connectedTarget;

function refuse() {
  throw new Error('TEST_DATABASE không an toàn: chỉ cho phép MongoDB loopback và database kiểm thử chuyên dụng; kiểm tra DATABASE/kết nối.');
}
function loopback(host) {
  return ['127.0.0.1','localhost','[::1]','::1'].includes(host.toLowerCase());
}
function target() {
  const raw=process.env.TEST_DATABASE;
  if (!raw || raw!==raw.trim()) refuse();
  let parsed;
  try { parsed=new URL(raw); } catch { refuse(); }
  if (parsed.protocol!=='mongodb:' || !loopback(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname!=='/'+TEST_NAME) refuse();
  // DATABASE chỉ được đọc để bảo vệ; không tải .env và không kết nối đến nó.
  if (process.env.DATABASE) {
    let database;
    try { database=new URL(process.env.DATABASE); } catch { refuse(); }
    const names=[decodeURIComponent(database.pathname.slice(1)),...database.searchParams.getAll('dbName')];
    if (names.includes(TEST_NAME)) refuse();
  }
  return {raw,port:Number(parsed.port || 27017),name:TEST_NAME};
}
function sameTarget(left,right) {
  return left && right && left.raw===right.raw && left.port===right.port && left.name===right.name;
}
function assertConnection(expected) {
  const connection=mongoose.connection;
  if (connection.readyState!==1 || connection.name!==expected.name || !connection.host || !loopback(connection.host) || Number(connection.port)!==expected.port) refuse();
  const options=connection.getClient().options;
  if (options.dbName!==expected.name || !options.hosts || options.hosts.length!==1 || !loopback(options.hosts[0].host) || Number(options.hosts[0].port)!==expected.port) refuse();
}
async function connect() {
  const expected=target();
  if (mongoose.connection.readyState!==0) {
    assertConnection(expected);
    if (!sameTarget(connectedTarget,expected)) refuse();
    return;
  }
  await mongoose.connect(expected.raw);
  // Xác minh lại cả môi trường lẫn kết nối sau khi I/O bất đồng bộ hoàn tất.
  if (!sameTarget(expected,target())) refuse();
  assertConnection(expected);
  connectedTarget=expected;
}
async function reset() {
  const expected=target();
  if (!sameTarget(connectedTarget,expected)) refuse();
  assertConnection(expected);
  const collections=await mongoose.connection.db.collections();
  for (const collection of collections) {
    // Mỗi lần xóa đều kiểm lại, không giữ quyền xóa sau khi cấu hình/kết nối đổi.
    if (!sameTarget(connectedTarget,target())) refuse();
    assertConnection(expected);
    await collection.deleteMany({});
  }
}
async function close() {
  connectedTarget=undefined;
  await mongoose.disconnect();
}
module.exports={connect,reset,close,enabled};

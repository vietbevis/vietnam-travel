'use strict';

const byId = id => document.getElementById(id);
const slotNames = ['Nhân viên', 'Khách hàng', 'Dự phòng', 'Dự phòng'];
const slots = byId('slots');
const dialog = byId('confirm');
const refreshButton = byId('refresh');
const result = byId('result');
let snapshot = null;
let switching = false;
let selection = null;
let generation = 0;

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function render() {
  const connected = Boolean(snapshot?.connected);
  const sim = snapshot?.mode === 'sim';
  const count = snapshot?.slotCount || 0;
  const current = snapshot?.slot;
  const connection = byId('connection');
  connection.dataset.connected = String(connected);
  text(connection, connected ? 'Đã kết nối' : 'Mất kết nối');
  text(byId('agent-port'), String(snapshot?.agentPort || '—'));
  text(byId('mode'), connected ? (sim ? 'Mô phỏng' : 'Đầu đọc thật') : '—');
  text(byId('reader'), connected ? snapshot.reader || 'Chưa chọn đầu đọc' : '—');
  text(byId('card-present'), connected ? (snapshot.cardPresent ? 'Có thẻ' : 'Chưa có thẻ') : '—');
  text(byId('active-slot'), connected && sim ? `Đang cắm khe ${current}` : 'Chưa có khe mô phỏng');

  if (slots.children.length !== count) {
    const items = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.slot = String(i);
      button.className = 'slot-card';
      for (const [className, value] of [
        ['slot-brand', 'KMA.TRAVEL'], ['slot-chip', ''],
        ['slot-number', 'SLOT ' + String(i).padStart(2, '0')],
        ['slot-name', slotNames[i]], ['slot-active', 'Đang cắm']
      ]) {
        const element = document.createElement('span');
        element.className = className;
        element.textContent = value;
        if (className === 'slot-chip') element.setAttribute('aria-hidden', 'true');
        button.append(element);
      }
      items.append(button);
    }
    slots.replaceChildren(items);
  }
  for (const button of slots.children) {
    const i = Number(button.dataset.slot);
    button.disabled = i === current || !snapshot.canSwitch || snapshot.busy || switching;
    button.setAttribute('aria-pressed', String(i === current));
    button.setAttribute('aria-label', 'SLOT ' + String(i).padStart(2, '0') + ' · ' + slotNames[i] +
      (i === current ? ' · đang cắm' : ' · chuyển khe'));
  }

  let availability = '';
  if (!connected) availability = 'Kiểm tra Card Agent đang chạy và bấm Làm mới trạng thái.';
  else if (!sim) availability = 'Chuyển khe chỉ khả dụng khi Card Agent chạy ở chế độ mô phỏng.';
  else if (!count) availability = 'Cần khởi động bản Card Agent hỗ trợ kiểm tra khe và khóa khi đang thực thi lệnh.';
  else if (!snapshot.cardPresent) availability = 'Đầu đọc mô phỏng chưa báo có thẻ.';
  else if (switching) availability = 'Đang chuyển khe…';
  else if (snapshot.busy) availability = 'Agent đang bận. Chờ thao tác hoàn tất rồi thử lại.';
  text(byId('availability'), availability);
}

async function request(url, body) {
  const response = await fetch(url, {
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

async function refresh() {
  const requested = ++generation;
  refreshButton.disabled = true;
  let current;
  try { current = await request('/api/status'); }
  catch { current = { connected: false }; }
  if (requested !== generation) return;
  snapshot = current;
  refreshButton.disabled = false;
  render();
}

slots.addEventListener('click', event => {
  const button = event.target.closest('[data-slot]');
  if (!button || button.disabled || dialog.open) return;
  selection = Number(button.dataset.slot);
  text(byId('confirm-title'), `Chuyển sang khe ${selection}`);
  dialog.showModal();
});
byId('cancel-switch').addEventListener('click', () => dialog.close());
byId('confirm-switch').addEventListener('click', async () => {
  if (!dialog.open || switching || !Number.isInteger(selection)) return;
  const slot = selection;
  dialog.close();
  switching = true;
  result.dataset.error = 'false';
  text(result, '');
  render();
  try {
    await request('/api/slot', { slot });
    text(result, `Agent đã chuyển sang khe ${slot}.`);
  } catch (error) {
    result.dataset.error = 'true';
    const messages = {
      busy: 'Agent đang bận. Chờ thao tác hoàn tất rồi thử lại.',
      offline: 'Không kết nối được Card Agent.',
      slot: 'Khe ngoài phạm vi của Card Agent.',
      'simulator-unavailable': 'Chế độ hoặc phiên bản Agent hiện tại chưa hỗ trợ chuyển khe an toàn.'
    };
    text(result, messages[error.message] || 'Chưa xác nhận được kết quả chuyển khe. Kiểm tra khe hiện tại trước khi thử lại.');
  } finally {
    switching = false;
    await refresh();
  }
});
refreshButton.addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden && !switching && !refreshButton.disabled) refresh(); }, 4000);
refresh();

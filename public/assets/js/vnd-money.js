(function exposeMoney(root) {
  const grouped = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
  const integer = /^\d+$/;
  const format = new Intl.NumberFormat('vi-VN');
  const tourMaximum = Math.floor(Number.MAX_SAFE_INTEGER / 100);

  function parse(raw, { min = 0, max = Number.MAX_SAFE_INTEGER, step = 1 } = {}) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw === 'string' && !integer.test(raw) && !grouped.test(raw)) return NaN;
    if (typeof raw !== 'string' && typeof raw !== 'number') return NaN;
    const amount = typeof raw === 'number' ? raw : Number(raw.replaceAll('.', ''));
    return Number.isSafeInteger(amount) && amount >= min && amount <= max && (amount - min) % step === 0 ? amount : NaN;
  }

  function value(input) {
    return parse(input.value, {
      min: Number(input.dataset.min || 0),
      max: Number(input.dataset.max || (input.dataset.vnd === 'tour' ? tourMaximum : Number.MAX_SAFE_INTEGER)),
      step: Number(input.dataset.step || 1)
    });
  }

  const label = amount => `${format.format(amount)} đ`;
  const api = { parse, value, label, tourMaximum };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.TravelMoney = api;

  function update(input) {
    const amount = value(input);
    const error = Number.isNaN(amount) || (input.required && amount === null);
    let output = input.parentNode.querySelector(`[id="${input.id}-error"]`);
    if (!output && input.id) {
      output = document.createElement('small');
      output.id = `${input.id}-error`;
      output.className = 'vnd-input-error';
      output.setAttribute('aria-live', 'polite');
      input.after(output);
      const describedBy = input.getAttribute('aria-describedby');
      input.setAttribute('aria-describedby', [describedBy, output.id].filter(Boolean).join(' '));
    }
    const bounds = [];
    if (input.dataset.min) bounds.push(`từ ${label(Number(input.dataset.min))}`);
    if (input.dataset.max) bounds.push(`tối đa ${label(Number(input.dataset.max))}`);
    if (Number(input.dataset.step) > 1) bounds.push(`theo bước ${label(Number(input.dataset.step))}`);
    const message = !error ? '' : amount === null ? 'Vui lòng nhập số tiền.' :
      `Hãy nhập số tiền VND nguyên (ví dụ 1.000.000)${bounds.length ? ', ' + bounds.join(', ') : ''}.`;
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(error));
    if (output) output.textContent = message;
    return amount;
  }

  function formatInput(input, digitsAtCaret) {
    const amount = parse(input.value);
    if (Number.isSafeInteger(amount)) {
      input.value = format.format(amount);
      let offset = 0;
      for (let digits = 0; digits < digitsAtCaret && offset < input.value.length; offset++) {
        if (input.value[offset] !== '.') digits++;
      }
      if (document.activeElement === input) input.setSelectionRange(offset, offset);
    }
    update(input);
  }

  document.querySelectorAll('input[data-vnd]').forEach(input => {
    const digitCount = (end = input.value.length) => input.value.slice(0, end).replaceAll('.', '').length;
    if (input.value) formatInput(input, digitCount());
    input.addEventListener('beforeinput', event => {
      if (event.isComposing || !event.cancelable || Number.isNaN(parse(input.value))) return;
      const insert = event.inputType === 'insertText' && /^\d+$/.test(event.data || '');
      const remove = ['deleteContentBackward', 'deleteContentForward'].includes(event.inputType);
      if (!insert && !remove) return;
      const digits = input.value.replaceAll('.', '');
      let from = digitCount(input.selectionStart);
      let until = digitCount(input.selectionEnd);
      if (remove && from === until) {
        if (event.inputType === 'deleteContentBackward' && from > 0) from--;
        else if (event.inputType === 'deleteContentForward') until++;
      }
      const incoming = insert ? event.data : '';
      const next = digits.slice(0, from) + incoming + digits.slice(until);
      if (Number.isNaN(parse(next))) return;
      event.preventDefault();
      input.value = next;
      formatInput(input, from + incoming.length);
    });
    input.addEventListener('input', event => {
      if (!event.isComposing) formatInput(input, digitCount(input.selectionStart));
    });
    input.addEventListener('blur', () => update(input));
  });
})(typeof window !== 'undefined' ? window : globalThis);

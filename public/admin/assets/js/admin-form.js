function validateAdminNewPassword(password) {
  if (password.length < 8 || new TextEncoder().encode(password).length > 72 || !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) || !/\d/.test(password) || !/[@$!%*?&]/.test(password)) {
    throw new Error('Mật khẩu cần ít nhất 8 ký tự và tối đa 72 byte, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt (@$!%*?&).');
  }
}

function submitAdminForm(form, getOptions, onSuccess) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  const status = form.querySelector('[data-form-status]');
  const feedback = (message, isError) => {
    if (status) {
      status.textContent = message;
      status.classList.toggle('form-status-error', isError);
    } else if (isError) {
      showTravelNotice(message, 'error');
    }
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    feedback('Đang gửi yêu cầu…', false);
    try {
      const { url, ...options } = await getOptions();
      const data = await travelRequest(url, { credentials: 'same-origin', cache: 'no-store', ...options });
      feedback(data.message || 'Đã thực hiện thành công.', false);
      onSuccess(data);
    } catch (error) {
      const connectionError = ['AbortError', 'TimeoutError'].includes(error.name) || error instanceof TypeError;
      feedback(connectionError ? 'Không nhận được phản hồi. Vui lòng kiểm tra kết quả trước khi gửi lại.' :
        error.message || 'Không thể thực hiện yêu cầu.', true);
    } finally {
      button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}

function initializeSavedImage(container, url, options = {}) {
  const figure = document.createElement('figure');
  figure.className = 'saved-image';
  const image = document.createElement('img');
  image.alt = options.alt || 'Ảnh đã lưu';
  const controls = document.createElement('figcaption');

  function action(text, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'saved-image-action';
    button.textContent = text;
    button.addEventListener('click', handler);
    controls.append(button);
    return button;
  }

  const status = document.createElement('small');
  status.setAttribute('role', 'status');
  const retry = action('Thử tải lại', () => {
    retry.hidden = true;
    image.hidden = false;
    status.textContent = 'Đang tải ảnh…';
    image.removeAttribute('src');
    requestAnimationFrame(() => { image.src = url; });
  });
  retry.hidden = true;
  image.addEventListener('load', () => { status.textContent = ''; });
  image.addEventListener('error', () => {
    image.hidden = true;
    status.textContent = 'Chưa xem được ảnh đã lưu.';
    retry.hidden = false;
  });
  image.src = url;

  if (options.index !== undefined) {
    figure.dataset.savedIndex = options.index;
    action('Lên', () => {
      const previous = figure.previousElementSibling;
      if (previous) previous.before(figure);
    });
    action('Xuống', () => {
      const next = figure.nextElementSibling;
      if (next) next.after(figure);
    });
  }
  if (options.removable || options.index !== undefined) {
    const remove = action('Bỏ ảnh này', () => {
      const removed = figure.dataset.removed === 'true';
      figure.dataset.removed = String(!removed);
      remove.textContent = removed ? 'Bỏ ảnh này' : 'Giữ lại ảnh';
      status.textContent = removed ? '' : 'Ảnh sẽ được bỏ khi lưu.';
    });
  }

  figure.append(image, controls, status);
  container.append(figure);
  return figure;
}

const acceptedUploadTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const adminImageFields = new WeakMap();
const canUseFilePond = window.FilePond && window.FilePondPluginImagePreview && window.FilePondPluginFileValidateType;
if (canUseFilePond) {
  FilePond.registerPlugin(FilePondPluginImagePreview, FilePondPluginFileValidateType);
}

document.querySelectorAll('[filepond-image], [filepond-image-multi]').forEach(input => {
  const fields = adminImageFields.get(input.form) || new Map();
  const field = { input };
  fields.set(input.name, field);
  adminImageFields.set(input.form, fields);
  input.accept = acceptedUploadTypes.join(',');
  const single = input.parentElement.getAttribute('image-default');
  const multiple = input.parentElement.getAttribute('list-image-default');
  input.parentElement.classList.add('form-image-field');
  if (!canUseFilePond) input.classList.add('native-image-input');
  if (single || multiple) {
    const previews = document.createElement('div');
    previews.className = 'saved-image-list';
    input.before(previews);
    if (single) {
      field.previous = single;
      field.saved = initializeSavedImage(previews, single, {
        removable: input.hasAttribute('data-clear-image') && !input.disabled
      });
    }
    if (multiple) {
      const images = JSON.parse(multiple);
      if (Array.isArray(images)) images.forEach((url, index) => initializeSavedImage(previews, url,
        { index, alt: `Ảnh tour đã lưu ${index + 1}` }));
    }
  }
  if (canUseFilePond) {
    const pond = FilePond.create(input, {
      labelIdle: '<span class="upload-plus" aria-hidden="true"></span><span class="upload-label">Chọn ảnh mới hoặc kéo ảnh vào đây</span>',
      acceptedFileTypes: acceptedUploadTypes,
      labelFileTypeNotAllowed: 'Định dạng ảnh không hợp lệ',
      fileValidateTypeLabelExpectedTypes: 'Dùng JPEG, PNG, GIF hoặc WebP',
      labelFileLoading: 'Đang tải ảnh',
      labelFileLoadError: 'Không thể đọc ảnh',
      allowReorder: input.multiple,
      maxFiles: input.multiple ? 10 : 1
    });
    field.pond = pond;
  }
});

function adminImageFiles(form, name) {
  const { input, pond } = adminImageFields.get(form)?.get(name) || {};
  if (!input || input.disabled) return [];
  const files = pond ? pond.getFiles().map(item => item.file) : Array.from(input.files);
  if (files.some(file => !(file instanceof File) || !acceptedUploadTypes.includes(file.type) || file.size > 5 * 1024 * 1024)) {
    throw new Error('Vui lòng chọn tệp JPEG, PNG, GIF hoặc WebP hợp lệ, tối đa 5 MB mỗi ảnh.');
  }
  return files;
}

function appendAdminImages(form, data, names) {
  const changes = {};
  for (const name of names) {
    const field = adminImageFields.get(form)?.get(name);
    if (!field || field.input.disabled) continue;
    const file = adminImageFiles(form, name)[0];
    const clear = field.saved?.dataset.removed === 'true';
    if (file && clear) throw new Error('Chọn xóa hoặc thay ảnh đã lưu.');
    if (file) data.append(name, file);
    if (field.input.hasAttribute('data-clear-image') && (file || clear)) {
      changes[name] = { before: field.previous || '', clear };
    }
  }
  if (Object.keys(changes).length) data.append('imageChanges', JSON.stringify(changes));
}

document.querySelectorAll('img[data-profile-avatar]').forEach(image => {
  const fallback = () => {
    image.hidden = true;
    image.nextElementSibling.hidden = false;
  };
  image.addEventListener('error', fallback, { once: true });
  if (image.complete && image.naturalWidth === 0) fallback();
});

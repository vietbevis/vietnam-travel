(() => {
  const src = document.querySelector('[data-tinymce-src]').dataset.tinymceSrc;
  const states = new WeakMap();
  let load;
  let nextId = 0;

  function loadTinyMce() {
    if (!load) {
      load = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.referrerPolicy = 'origin';
        script.crossOrigin = 'anonymous';
        const timer = setTimeout(() => {
          script.remove();
          reject(new Error('TinyMCE timeout'));
        }, 10000);
        script.onload = () => {
          clearTimeout(timer);
          window.tinymce ? resolve(window.tinymce) : reject(new Error('Missing TinyMCE'));
        };
        script.onerror = () => {
          clearTimeout(timer);
          reject(new Error('TinyMCE unavailable'));
        };
        document.head.append(script);
      });
    }
    return load;
  }

  function initialize(textarea) {
    if (states.has(textarea)) return;
    if (!textarea.id) textarea.id = 'tour-mce-' + ++nextId;
    const note = document.createElement('p');
    note.dataset.editorStatus = '';
    note.className = 'form-status';
    note.setAttribute('role', 'status');
    textarea.before(note);
    const state = { note, editor: null };
    states.set(textarea, state);
    const fallback = message => {
      state.fallback = true;
      state.editor?.remove();
      state.editor = null;
      textarea.hidden = false;
      textarea.style.removeProperty('display');
      note.textContent = message + ' Nội dung dùng ô HTML bên dưới.';
    };
    if (!src) {
      fallback('TinyMCE chưa có cấu hình Tiny Cloud.');
      return;
    }
    note.textContent = 'Đang tải TinyMCE…';
    state.ready = loadTinyMce().then(async tiny => {
      if (!textarea.isConnected) return;
      const initialization = tiny.init({
        target: textarea,
        plugins: 'charmap codesample code emoticons help image link lists advlist media preview searchreplace table wordcount',
        toolbar: 'undo redo | styles | bold italic | alignleft aligncenter alignright alignjustify | outdent indent | charmap | codesample | emoticons | image | link | numlist bullist | media | table | code | preview | searchreplace | help',
        images_upload_url: '/' + pathAdmin + '/upload/image',
        relative_urls: false
      }).then(editors => {
        if (state.fallback || !textarea.isConnected) editors.forEach(editor => editor.remove());
        return editors;
      });
      let timeout;
      const limit = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('TinyMCE initialization timeout')), 10000);
      });
      let editors;
      try {
        editors = await Promise.race([initialization, limit]);
      } finally {
        clearTimeout(timeout);
      }
      state.editor = editors[0];
      if (!textarea.isConnected) state.editor?.remove();
      else if (!state.editor || state.editor.mode.isReadOnly()) {
        fallback('TinyMCE không cho phép chỉnh sửa. Hãy kiểm tra API key và tên miền đã đăng ký.');
      } else {
        note.hidden = true;
      }
    }).catch(() => fallback('Không thể tải TinyMCE. Hãy kiểm tra kết nối và cấu hình Tiny Cloud.'));
  }

  window.AdminEditor = {
    initialize,
    remove(textarea) { states.get(textarea)?.editor?.remove(); },
    async value(textarea) {
      const state = states.get(textarea);
      await state?.ready;
      const editor = state?.editor;
      if (!editor) return textarea.value;
      const uploads = await editor.uploadImages();
      if (uploads.some(upload => upload.status === false)) throw new Error('Ảnh trong nội dung chưa tải lên được.');
      return editor.getContent();
    }
  };
  document.querySelectorAll('[textarea-mce]').forEach(initialize);
})();

/* In-page visual editor (prototype). Loaded only on /admin/edit/* for admins.
 *
 * - text fields  : click to edit inline (plain text)
 * - html fields  : click to edit inline with a floating format toolbar
 *                  (bold / italic / link / center / preset style / inline image)
 * - markdown     : click opens a raw-markdown modal (kept lossless)
 * - images       : hover shows "Replace image" -> media picker
 *
 * Saves go through the existing revisioned PUT /api/content/:key; "Publish"
 * triggers POST /api/build and polls it to completion.
 */
(function () {
  'use strict';

  var MW = window.__MW__ || {};
  var dirty = false;

  // ---------- tiny API helper ----------
  function api(method, url, body, isForm) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { 'x-csrf-token': MW.csrfToken },
    };
    if (body && !isForm) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body) {
      opts.body = body;
    }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.status); });
      return r.status === 204 ? null : r.json();
    });
  }

  function save(key, value, kind) {
    return api('PUT', '/api/content/' + encodeURIComponent(key), { value: value, kind: kind })
      .then(function () { setDirty(true); toast('Saved'); })
      .catch(function (e) { toast('Save failed: ' + e.message); });
  }

  // ---------- toolbar ----------
  function setDirty(v) {
    dirty = v;
    var pub = document.getElementById('mw-publish');
    if (pub) pub.disabled = false;
    var st = document.getElementById('mw-status');
    if (st) st.textContent = v ? 'Unpublished changes' : 'Published';
  }

  function buildBar() {
    var bar = document.createElement('div');
    bar.className = 'mw-bar';

    var pageSel = MW.pages.map(function (p) {
      return '<option value="' + p + '"' + (p === MW.slug ? ' selected' : '') + '>' + p + '</option>';
    }).join('');

    bar.innerHTML =
      '<strong>Editing</strong>' +
      '<select id="mw-page">' + pageSel + '</select>' +
      '<span class="mw-status" id="mw-status">Click any text or image to edit</span>' +
      '<span class="mw-spacer"></span>' +
      '<button class="mw-publish" id="mw-publish" disabled>Publish changes</button>' +
      '<a class="mw-exit" href="/admin">Exit</a>';
    document.body.appendChild(bar);
    document.body.classList.add('mw-editing');

    document.getElementById('mw-page').addEventListener('change', function (e) {
      location.href = '/admin/edit/' + e.target.value;
    });
    document.getElementById('mw-publish').addEventListener('click', publish);
  }

  function publish() {
    var btn = document.getElementById('mw-publish');
    btn.disabled = true;
    toast('Publishing…');
    api('POST', '/api/build', {})
      .then(function (r) { pollBuild(r.buildId); })
      .catch(function (e) { toast('Publish failed: ' + e.message); btn.disabled = false; });
  }

  function pollBuild(id) {
    api('GET', '/api/build/' + id)
      .then(function (b) {
        if (!b || b.status === 'running' || b.status === 'pending') {
          return setTimeout(function () { pollBuild(id); }, 1000);
        }
        if (b.status === 'ok') { setDirty(false); toast('Published — site rebuilt'); }
        else { toast('Build error: ' + (b.log || '').slice(0, 120)); }
        document.getElementById('mw-publish').disabled = false;
      })
      .catch(function () { setTimeout(function () { pollBuild(id); }, 1500); });
  }

  // ---------- toast ----------
  var toastEl;
  var toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mw-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  // ---------- inline text + html editing ----------
  function activate(el) {
    var kind = el.getAttribute('data-mw-kind');
    var key = el.getAttribute('data-mw-key');
    if (kind === 'markdown') return openMarkdown(el, key);

    el.setAttribute('contenteditable', 'true');
    el.focus();

    if (kind === 'html') showFmt(el, key);

    function finish() {
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      hideFmt();
      var value = kind === 'text' ? el.innerText.trim() : el.innerHTML.trim();
      if (value !== el.getAttribute('data-mw-orig')) save(key, value, kind);
    }
    function onBlur() {
      // Let format-toolbar clicks (which refocus) cancel the blur.
      setTimeout(function () { if (document.activeElement !== el && !fmtHasFocus) finish(); }, 120);
    }
    el.setAttribute('data-mw-orig', kind === 'text' ? el.innerText.trim() : el.innerHTML.trim());
    el.addEventListener('blur', onBlur);

    if (kind === 'text') {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
    }
  }

  // ---------- floating format toolbar (html fields) ----------
  var fmtEl, fmtTarget, fmtHasFocus = false;
  function exec(cmd, val) { document.execCommand(cmd, false, val || null); }

  function blockWrapper(el) {
    // Ensure a single inner block we can style for preset / center.
    var first = el.firstElementChild;
    if (first && first.getAttribute('data-mw-block') === '1') return first;
    var div = document.createElement('div');
    div.setAttribute('data-mw-block', '1');
    while (el.firstChild) div.appendChild(el.firstChild);
    el.appendChild(div);
    return div;
  }

  function showFmt(el, key) {
    hideFmt();
    fmtTarget = el;
    fmtEl = document.createElement('div');
    fmtEl.className = 'mw-fmt';

    var presetOpts = MW.presets.map(function (p) {
      return '<option value="' + p.class + '">' + p.label + '</option>';
    }).join('');

    fmtEl.innerHTML =
      '<button data-cmd="bold"><b>B</b></button>' +
      '<button data-cmd="italic"><i>I</i></button>' +
      '<button data-cmd="link">Link</button>' +
      '<button data-cmd="center">Center</button>' +
      '<span class="sep"></span>' +
      '<select data-cmd="preset" title="Style preset">' + presetOpts + '</select>' +
      '<button data-cmd="image">Image</button>' +
      '<span class="sep"></span>' +
      '<button data-cmd="done">Done</button>';
    document.body.appendChild(fmtEl);
    positionFmt(el);

    fmtEl.addEventListener('mousedown', function (e) {
      // Keep the editable focused/selection alive while clicking the toolbar.
      if (e.target.tagName !== 'SELECT') e.preventDefault();
      fmtHasFocus = true;
      setTimeout(function () { fmtHasFocus = false; }, 200);
    });

    fmtEl.querySelectorAll('[data-cmd]').forEach(function (btn) {
      var cmd = btn.getAttribute('data-cmd');
      var evt = btn.tagName === 'SELECT' ? 'change' : 'click';
      btn.addEventListener(evt, function () {
        if (cmd === 'bold' || cmd === 'italic') exec(cmd);
        else if (cmd === 'link') { var u = prompt('Link URL:', 'https://'); if (u) exec('createLink', u); }
        else if (cmd === 'center') {
          var w = blockWrapper(el);
          w.style.textAlign = w.style.textAlign === 'center' ? '' : 'center';
        }
        else if (cmd === 'preset') {
          var w2 = blockWrapper(el);
          MW.presets.forEach(function (p) { if (p.class) w2.classList.remove(p.class); });
          if (btn.value) w2.classList.add(btn.value);
        }
        else if (cmd === 'image') {
          openMedia(function (url) { exec('insertImage', url); });
        }
        else if (cmd === 'done') { el.blur(); }
      });
    });
  }

  function positionFmt(el) {
    var r = el.getBoundingClientRect();
    fmtEl.style.top = (window.scrollY + r.top - 48) + 'px';
    fmtEl.style.left = (window.scrollX + r.left) + 'px';
  }
  function hideFmt() { if (fmtEl) { fmtEl.remove(); fmtEl = null; fmtTarget = null; } }

  // ---------- markdown modal ----------
  function openMarkdown(el, key) {
    api('GET', '/api/content/' + encodeURIComponent(key)).then(function (row) {
      modal(
        'Edit markdown — ' + key,
        '<textarea id="mw-md">' + escapeHtml(row.value || '') + '</textarea>' +
        '<p class="muted" style="font-size:13px">Markdown: **bold**, *italic*, [text](url). Renders on publish.</p>',
        function (close) {
          var val = document.getElementById('mw-md').value;
          save(key, val, 'markdown').then(function () { close(); toast('Saved — publish to see it rendered'); });
        }
      );
    });
  }

  // ---------- media picker ----------
  function openMedia(onPick) {
    api('GET', '/api/media').then(function (items) {
      var grid = items.map(function (m) {
        var url = '/assets/img/uploads/' + m.filename;
        return '<figure data-url="' + url + '"><img src="' + url + '" alt="" loading="lazy"/>' +
          '<figcaption>' + escapeHtml(m.original || m.filename) + '</figcaption></figure>';
      }).join('') || '<p class="muted">No images yet — upload one below.</p>';

      var close = modal(
        'Choose an image',
        '<div class="mw-upload"><label>Upload new: <input type="file" id="mw-file" accept="image/*"></label></div>' +
        '<div class="mw-grid">' + grid + '</div>',
        null
      );

      document.querySelector('.mw-grid').addEventListener('click', function (e) {
        var fig = e.target.closest('figure');
        if (fig) { onPick(fig.getAttribute('data-url')); close(); }
      });
      document.getElementById('mw-file').addEventListener('change', function (e) {
        var f = e.target.files[0];
        if (!f) return;
        var fd = new FormData(); fd.append('file', f);
        toast('Uploading…');
        api('POST', '/api/media', fd, true).then(function (r) {
          onPick(r.url); close();
        }).catch(function (err) { toast('Upload failed: ' + err.message); });
      });
    });
  }

  // ---------- editable images ----------
  var imgBtn;
  function setupImages() {
    var byUrl = {};
    (MW.images || []).forEach(function (i) { byUrl[i.value] = i.key; });

    imgBtn = document.createElement('button');
    imgBtn.className = 'mw-img-btn';
    imgBtn.textContent = 'Replace image';
    imgBtn.style.cssText = 'position:absolute;z-index:100001;display:none';
    document.body.appendChild(imgBtn);

    var current = null;
    function place(img) {
      var r = img.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) { imgBtn.style.display = 'none'; return; }
      imgBtn.style.display = 'block';
      imgBtn.style.top = (window.scrollY + r.top + 8) + 'px';
      imgBtn.style.left = (window.scrollX + r.left + r.width - 130) + 'px';
      current = img;
    }

    Array.prototype.forEach.call(document.images, function (img) {
      var key = byUrl[img.getAttribute('src')];
      if (!key) return;
      img.setAttribute('data-mw-key', key);
      img.addEventListener('mouseenter', function () { place(img); });
    });

    imgBtn.addEventListener('mouseleave', function () { imgBtn.style.display = 'none'; });
    imgBtn.addEventListener('click', function () {
      if (!current) return;
      var key = current.getAttribute('data-mw-key');
      var img = current;
      openMedia(function (url) {
        img.setAttribute('src', url);
        save(key, url, 'image');
      });
    });
  }

  // ---------- modal helper ----------
  function modal(title, bodyHtml, onSave) {
    var bg = document.createElement('div');
    bg.className = 'mw-modal-bg';
    bg.innerHTML =
      '<div class="mw-modal"><button class="mw-close">&times;</button>' +
      '<h2>' + escapeHtml(title) + '</h2>' + bodyHtml +
      (onSave ? '<div class="mw-actions"><button class="cancel">Cancel</button><button class="save">Save</button></div>' : '') +
      '</div>';
    document.body.appendChild(bg);
    function close() { bg.remove(); }
    bg.querySelector('.mw-close').addEventListener('click', close);
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    if (onSave) {
      bg.querySelector('.cancel').addEventListener('click', close);
      bg.querySelector('.save').addEventListener('click', function () { onSave(close); });
    }
    return close;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- boot ----------
  function boot() {
    buildBar();
    setupImages();
    document.querySelectorAll('.mw-ed').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (el.getAttribute('contenteditable') === 'true') return;
        e.preventDefault();
        activate(el);
      });
    });
    // Intercept navigation clicks so editing the homepage doesn't whisk you away.
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (a && !a.classList.contains('mw-exit') && a.getAttribute('href') &&
          a.getAttribute('href').charAt(0) === '/' && !e.target.closest('.mw-ed') &&
          !e.target.closest('.mw-bar')) {
        e.preventDefault();
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

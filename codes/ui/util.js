/* Arayüz yardımcıları: pencereler, onay ve giriş kutuları, sağ tık menüsü, bildirim, indirme, pano.
   Uygulama içi pencereler kullanılır: tarayıcının confirm/prompt pencereleri Esc ve odakla iyi çalışmaz. */

const BomxUi = (() => {
  const M = BomxModel;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ─── Bildirim ────────────────────────────────────────── */

  let toastTimer = null;
  /** @param options.action { label, run } bildirimde düğme (ör. Geri al) */
  function toast(message, type, options) {
    const el = $('toast');
    const o = options || {};
    el.innerHTML = `<span>${esc(message)}</span>${o.action ? `<button type="button" class="btn btn-xs">${esc(o.action.label)}</button>` : ''}`;
    el.className = `toast ${type || ''}`;
    if (o.action) {
      el.querySelector('button').addEventListener('click', () => {
        el.classList.add('hidden');
        o.action.run();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), o.ms || (type === 'error' ? 7000 : o.action ? 6000 : 3400));
  }

  /* ─── Meşgul göstergesi ───────────────────────────────── */

  function busy(message) {
    let el = $('busyRoot');
    if (!el) {
      el = document.createElement('div');
      el.id = 'busyRoot';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="busy"><div class="busy-box"><div class="spinner"></div><span>${esc(message || 'Çalışıyor…')}</span></div></div>`;
    return {
      update(text) {
        const span = el.querySelector('.busy-box span');
        if (span) span.textContent = text;
      },
      close() { el.innerHTML = ''; }
    };
  }

  /* ─── Pencereler ──────────────────────────────────────── */

  const stack = [];

  function topModal() {
    return stack[stack.length - 1] || null;
  }

  /**
   * Uygulama içi pencere. html: pencerenin içi (form değil); onClose Esc ve dışarı tıklamada çağrılır.
   * @returns { el, close }
   */
  function modal(html, options) {
    const o = options || {};
    const root = $('modalRoot');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<form class="modal ${o.size || ''}" novalidate>${html}</form>`;
    root.appendChild(overlay);
    const form = overlay.firstElementChild;
    let closed = false;
    const entry = {
      el: form,
      close(result) {
        if (closed) return;
        closed = true;
        overlay.remove();
        const i = stack.indexOf(entry);
        if (i >= 0) stack.splice(i, 1);
        if (o.onClose) o.onClose(result);
      },
      cancel() {
        // confirmCancel false dönerse pencere açık kalır (ör. kaybolacak düzenleme için onay sorulur)
        if (o.confirmCancel && !o.confirmCancel()) return;
        if (o.onCancel) o.onCancel();
        entry.close(undefined);
      }
    };
    stack.push(entry);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (o.onSubmit) o.onSubmit(e, entry);
    });
    form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => entry.cancel()));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && o.dismissable !== false) entry.cancel();
    });
    const focus = form.querySelector('[autofocus]') || form.querySelector('input:not([type=hidden]):not([disabled]), select, textarea, button[type=submit]');
    if (focus) setTimeout(() => focus.focus(), 0);
    return entry;
  }

  function confirmModal(title, message, okLabel, options) {
    const o = options || {};
    return new Promise((resolve) => {
      modal(`
        <h2>${esc(title)}</h2>
        <p class="field-help">${esc(message).replace(/\n/g, '<br>')}</p>
        ${o.detail ? `<div class="field-help warn">${esc(o.detail)}</div>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn" data-close>${esc(o.cancelLabel || 'Vazgeç')}</button>
          <button type="submit" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" autofocus>${esc(okLabel || 'Tamam')}</button>
        </div>`, {
        onSubmit: (e, m) => {
          m.close(true);
          resolve(true);
        },
        onCancel: () => resolve(false)
      });
    });
  }

  /** @returns girilen metin; vazgeçilirse null */
  function promptModal(title, label, value, okLabel, options) {
    const o = options || {};
    return new Promise((resolve) => {
      const m = modal(`
        <h2>${esc(title)}</h2>
        <div class="field">
          <label for="pmInput">${esc(label)}</label>
          ${o.multiline
            ? `<textarea id="pmInput" class="field-input" rows="4" placeholder="${esc(o.placeholder || '')}">${esc(value || '')}</textarea>`
            : `<input id="pmInput" class="field-input" value="${esc(value || '')}" placeholder="${esc(o.placeholder || '')}" autocomplete="off" ${o.list ? 'list="pmList"' : ''}>`}
          ${o.list ? `<datalist id="pmList">${o.list.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>` : ''}
          ${o.help ? `<p class="field-help">${esc(o.help)}</p>` : ''}
          <div class="field-error" id="pmError"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" data-close>Vazgeç</button>
          <button type="submit" class="btn btn-primary">${esc(okLabel || 'Tamam')}</button>
        </div>`, {
        onSubmit: (e, entry) => {
          const text = entry.el.querySelector('#pmInput').value.trim();
          if (o.required !== false && !text) {
            entry.el.querySelector('#pmError').textContent = 'Boş bırakılamaz';
            return;
          }
          const problem = o.validate ? o.validate(text) : '';
          if (problem) {
            entry.el.querySelector('#pmError').textContent = problem;
            return;
          }
          entry.close(text);
          resolve(text);
        },
        onCancel: () => resolve(null)
      });
      const input = m.el.querySelector('#pmInput');
      setTimeout(() => {
        input.focus();
        if (input.select) input.select();
      }, 0);
      if (o.multiline) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) m.el.requestSubmit();
        });
      }
    });
  }

  /* ─── Sağ tık menüsü ──────────────────────────────────── */

  let menuEl = null;

  function closeMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
  }

  /**
   * items: { label, run, disabled, danger, key, items (alt menü) } ya da '-' (ayırıcı) ya da { title }
   */
  function contextMenu(x, y, items) {
    closeMenu();
    const build = (list) => {
      const el = document.createElement('div');
      el.className = 'ctx-menu';
      for (const item of list) {
        if (!item) continue;
        if (item === '-') {
          el.insertAdjacentHTML('beforeend', '<div class="ctx-sep"></div>');
          continue;
        }
        if (item.title) {
          el.insertAdjacentHTML('beforeend', `<div class="ctx-title">${esc(item.title)}</div>`);
          continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `ctx-item${item.danger ? ' danger' : ''}`;
        b.disabled = !!item.disabled;
        b.innerHTML = `<span>${esc(item.label)}</span>${item.items ? '<span class="arrow">▸</span>' : item.key ? `<span class="k">${esc(item.key)}</span>` : ''}`;
        if (item.items) {
          b.addEventListener('mouseenter', () => {
            el.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
            el.querySelectorAll('.ctx-item.open').forEach((m) => m.classList.remove('open'));
            b.classList.add('open');
            const sub = build(item.items);
            el.appendChild(sub);
            const r = b.getBoundingClientRect();
            const base = el.getBoundingClientRect();
            sub.style.position = 'absolute';
            sub.style.left = `${r.width + 2}px`;
            sub.style.top = `${r.top - base.top - 4}px`;
            const sr = sub.getBoundingClientRect();
            if (sr.right > window.innerWidth - 4) sub.style.left = `${-sr.width - 2}px`;
            if (sr.bottom > window.innerHeight - 4) sub.style.top = `${r.top - base.top - 4 - (sr.bottom - window.innerHeight + 8)}px`;
          });
        } else {
          b.addEventListener('mouseenter', () => {
            el.querySelectorAll(':scope > .ctx-menu').forEach((m) => m.remove());
            el.querySelectorAll(':scope > .ctx-item.open').forEach((m) => m.classList.remove('open'));
          });
          b.addEventListener('click', () => {
            closeMenu();
            if (item.run) item.run();
          });
        }
        el.appendChild(b);
      }
      return el;
    };
    menuEl = build(items);
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
    menuEl.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
  }

  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);

  /* ─── Dosya ───────────────────────────────────────────── */

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  /** Dosya seçtirir; vazgeçilirse null */
  function pickFile(accept) {
    return pickFiles(accept, false).then((files) => files[0] || null);
  }

  /** @returns seçilen dosyalar (vazgeçilirse boş dizi); multiple false ise en çok bir dosya */
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '';
      input.multiple = multiple !== false;
      input.style.display = 'none';
      document.body.appendChild(input);
      let done = false;
      const finish = (files) => {
        if (done) return;
        done = true;
        input.remove();
        resolve(files);
      };
      input.addEventListener('change', () => finish([...input.files]));
      // Vazgeçilince change gelmez; pencere odağa dönünce kapanır
      window.addEventListener('focus', () => setTimeout(() => { if (!input.files.length) finish([]); }, 600), { once: true });
      input.click();
    });
  }

  function decodeText(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch {
      // Türkçe Excel'in eski CSV'si
      return new TextDecoder('windows-1254').decode(bytes);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch { /* pano kapalı */ }
      ta.remove();
      return ok;
    }
  }

  /** Dosya adında yasak işaretler olmaz */
  const fileName = (text) => M.sanitizeName(text) || 'BOMX';

  /* ─── Kalıcı tercihler (bu tarayıcı) ─────────────────── */

  function pref(key, fallback) {
    try {
      const v = localStorage.getItem(`bomx_${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }

  function setPref(key, value) {
    try {
      localStorage.setItem(`bomx_${key}`, JSON.stringify(value));
    } catch { /* gizli pencerede saklanmaz */ }
  }

  /* ─── Biçim ───────────────────────────────────────────── */

  function formatDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
  }

  /** "az önce", "5 dk önce", "bugün 14:20", "dün 09:10", "10.11.2026" */
  function relTime(value) {
    if (!value) return '';
    const t = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const diff = Date.now() - t;
    const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    if (diff < 60000 && diff > -60000) return 'az önce';
    if (diff > 0 && diff < 3600000) return `${Math.round(diff / 60000)} dk önce`;
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return `bugün ${hm}`;
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `dün ${hm}`;
    return d.toLocaleDateString('tr-TR');
  }

  /** Para birimi başına toplamlar: "1.234,50 € + 820,00 ₺" */
  function moneyList(byCurrency, options) {
    const parts = Object.keys(byCurrency || {}).sort().map((c) => M.formatMoney(byCurrency[c], c, options));
    return parts.join(' + ');
  }

  function totalText(totals, options) {
    if (!totals || !totals.count) return '';
    if (totals.converted !== null && totals.converted !== undefined) return M.formatMoney(totals.converted, totals.currency, options);
    return moneyList(totals.byCurrency, options) || '';
  }

  function debounce(fn, ms) {
    let timer = null;
    const run = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
    run.cancel = () => clearTimeout(timer);
    return run;
  }

  const isTyping = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

  /** Aranan sözcükleri işaretler (Türkçe işaretlerden bağımsız) */
  function highlight(text, query) {
    const raw = String(text == null ? '' : text);
    const tokens = M.fold(query || '').split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length || !raw) return esc(raw);
    const folded = M.fold(raw);
    if (folded.length !== raw.length) return esc(raw);
    const marks = new Array(raw.length).fill(false);
    for (const t of tokens) {
      let at = folded.indexOf(t);
      while (at >= 0) {
        for (let i = at; i < at + t.length; i += 1) marks[i] = true;
        at = folded.indexOf(t, at + t.length);
      }
    }
    let out = '';
    let open = false;
    for (let i = 0; i < raw.length; i += 1) {
      if (marks[i] && !open) {
        out += '<mark>';
        open = true;
      } else if (!marks[i] && open) {
        out += '</mark>';
        open = false;
      }
      out += esc(raw[i]);
    }
    return open ? `${out}</mark>` : out;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded) resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.dataset.src = src;
      s.onload = () => {
        s.dataset.loaded = '1';
        resolve();
      };
      s.onerror = () => reject(new Error(`${src} yüklenemedi`));
      document.head.appendChild(s);
    });
  }

  /* ─── Komponent fotoğrafı ─────────────────────────────── */

  // Fotoğraflar küçültülüp JPEG olarak saklanır: en uzun kenar 420 px (~15–30 KB). Veritabanı ve eşitleme küçük kalır.
  const PHOTO_MAX = 420;
  const PHOTO_QUALITY = 0.82;
  const PHOTO_KEEP = 200000;

  /**
   * Görseli küçültüp "data:image/jpeg;base64,…" yapar. Saydam PNG beyaz zemine oturur.
   * @param src File, Blob ya da data URL
   */
  async function shrinkImage(src, max, quality) {
    const limit = max || PHOTO_MAX;
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Görsel okunamadı: JPEG, PNG ya da WebP olmalı'));
        i.src = url;
      });
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) throw new Error('Görsel boş');
      const scale = Math.min(1, limit / Math.max(w0, h0));
      // Zaten küçük JPEG (ör. paketten gelen) olduğu gibi kalır: yeniden sıkıştırmak kaliteyi düşürür, aynı fotoğrafı "değişmiş" gösterir
      if (scale === 1 && typeof src === 'string' && /^data:image\/jpeg;base64,/.test(src) && src.length <= PHOTO_KEEP) return src;
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', quality || PHOTO_QUALITY);
    } finally {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
    }
  }

  /** Panodaki ya da bırakılan ilk görsel dosyası */
  function imageFrom(transfer) {
    if (!transfer) return null;
    for (const item of transfer.items || []) {
      if (item.kind === 'file' && /^image\//.test(item.type)) return item.getAsFile();
    }
    return [...(transfer.files || [])].find((f) => /^image\//.test(f.type)) || null;
  }

  /** Fotoğrafın büyük görünümü (tık ya da Esc kapatır) */
  function lightbox(src, caption) {
    const m = modal(`<div class="lightbox"><img src="${esc(src)}" alt="${esc(caption || '')}"><div class="lb-cap">${esc(caption || '')}</div></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Kapat</button></div>`, { size: 'photo' });
    m.el.querySelector('img').addEventListener('click', () => m.close());
    return m;
  }

  const ICONS = {
    undo: '<svg viewBox="0 0 20 20"><path d="M7 4L3 8l4 4M3 8h9a5 5 0 010 10H8"/></svg>',
    redo: '<svg viewBox="0 0 20 20"><path d="M13 4l4 4-4 4M17 8H8a5 5 0 000 10h4"/></svg>',
    trash: '<svg viewBox="0 0 20 20"><path d="M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12M8.5 8v6M11.5 8v6"/></svg>',
    copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7"/></svg>',
    up: '<svg viewBox="0 0 20 20"><path d="M10 16V4M5 9l5-5 5 5"/></svg>',
    down: '<svg viewBox="0 0 20 20"><path d="M10 4v12M5 11l5 5 5-5"/></svg>',
    plus: '<svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg>',
    section: '<svg viewBox="0 0 20 20"><path d="M3 4h14M3 8h9M3 12h14M3 16h9"/></svg>',
    paste: '<svg viewBox="0 0 20 20"><path d="M7 4H5.5A1.5 1.5 0 004 5.5v11A1.5 1.5 0 005.5 18h9a1.5 1.5 0 001.5-1.5v-11A1.5 1.5 0 0014.5 4H13"/><rect x="7" y="2.5" width="6" height="3" rx="1"/><path d="M7 10h6M7 13.5h4"/></svg>',
    free: '<svg viewBox="0 0 20 20"><path d="M4 16l1-4 8-8 3 3-8 8zM11 6l3 3"/></svg>',
    refresh: '<svg viewBox="0 0 20 20"><path d="M16 10a6 6 0 11-2-4.5M16 2v4h-4"/></svg>'
  };

  return {
    $,
    esc,
    toast,
    busy,
    modal,
    topModal,
    confirmModal,
    promptModal,
    contextMenu,
    closeMenu,
    download,
    pickFile,
    pickFiles,
    decodeText,
    copyText,
    fileName,
    pref,
    setPref,
    formatDate,
    relTime,
    moneyList,
    totalText,
    debounce,
    isTyping,
    highlight,
    loadScript,
    shrinkImage,
    imageFrom,
    lightbox,
    ICONS
  };
})();

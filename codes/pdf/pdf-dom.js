/* Ekrandaki düzeni PDF'e çevirir: sayfalar tarayıcıda dizilir, her kutu, çizgi ve harfin yeri ölçülür,
   PDF'e aynı yerde çizilir. Sayfalar vektör kalır; metin seçilip aranabilir.
   Yazı tipleri programla gelir (assets/fonts): Calibri yerine Carlito, Segoe UI yerine Selawik.
   Ölçüleri aynıdır, bu yüzden dizgi ekrandakiyle aynı olur ve bilgisayarda yüklü yazı tiplerine bağlı kalmaz. */

(function (root) {
  'use strict';

  const PX = 25.4 / 96;
  const MAX_IMAGE_DPI = 600;
  const EXTRA_BOLD = 0.028;

  // BOMX: P&PX'in pdf-dom.js dosyasıdır. Belge yalnız Segoe UI kullanır; Calibri (Carlito, 1,3 MB) yüklenmez.
  const FACES = [
    { family: 'Segoe UI', weight: 400, file: 'selawk.ttf', name: 'Selawik-Regular' },
    { family: 'Segoe UI', weight: 600, file: 'selawksb.ttf', name: 'Selawik-Semibold' },
    { family: 'Segoe UI', weight: 700, file: 'selawkb.ttf', name: 'Selawik-Bold' }
  ];
  // Hiçbir yazı tipinde olmayan görünmez karakterler çizilmez
  const INVISIBLE = new Set([0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

  let faces = null;

  /** @param readBytes dosya adı → { ok, bytes } */
  async function loadFonts(readBytes) {
    if (faces) return;
    const list = await Promise.all(FACES.map(async (f) => {
      const res = await readBytes(f.file);
      if (!res.ok) throw new Error(`Yazı tipi okunamadı: ${f.file}`);
      const fontFace = new FontFace(f.family, res.bytes, { weight: String(f.weight) });
      await fontFace.load();
      return Object.assign({}, f, { fontFace, ttf: new PidPdf.TrueType(res.bytes, f.name) });
    }));
    faces = list;
  }

  /** Dizgiyi gömülecek yazı tipleriyle yapar; bitince end çağrılır */
  function begin() {
    for (const f of faces) document.fonts.add(f.fontFace);
    document.documentElement.classList.add('pdf-exporting');
  }

  function end() {
    document.documentElement.classList.remove('pdf-exporting');
    if (faces) for (const f of faces) document.fonts.delete(f.fontFace);
  }

  /* ─── Yazı tipi seçimi ────────────────────────────────── */

  const chainCache = new Map();

  function pickFace(family, weight) {
    const own = faces.filter((f) => f.family === family);
    if (!own.length) return null;
    const wanted = weight >= 700 ? 700 : weight >= 550 ? 600 : 400;
    return own.find((f) => f.weight === wanted) || own.find((f) => f.weight === 700 && wanted === 600) || own[0];
  }

  /** CSS sırasıyla yazı tipleri; bulunmayan harf sıradakinden alınır */
  function fontChain(cs) {
    const key = `${cs.fontFamily}|${cs.fontWeight}`;
    if (chainCache.has(key)) return chainCache.get(key);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const names = cs.fontFamily.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    const chain = [];
    for (const name of [...names, 'Calibri', 'Segoe UI']) {
      const face = pickFace(name, weight);
      if (face && !chain.includes(face.ttf)) chain.push(face.ttf);
    }
    chainCache.set(key, chain);
    return chain;
  }

  function glyphOf(chain, cp, state) {
    for (const ttf of chain) {
      const gid = ttf.glyphIndex(cp);
      if (gid) return { ttf, gid };
    }
    state.missing.add(String.fromCodePoint(cp));
    return { ttf: chain[0], gid: 0 };
  }

  /* ─── Renk ve taban çizgisi ───────────────────────────── */

  function parseColor(value, currentColor) {
    if (!value || value === 'none' || value === 'transparent') return null;
    if (value.startsWith('url(')) return null;
    if (value === 'currentcolor' || value === 'currentColor') return parseColor(currentColor);
    const m = /rgba?\(([^)]+)\)/.exec(value);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    const a = p.length > 3 ? p[3] : 1;
    return a > 0 ? { r: p[0], g: p[1], b: p[2], a } : null;
  }

  const baselineCache = new Map();

  /** Yazının kutusunun üstünden taban çizgisine uzaklık (px): tarayıcının kullandığı yuvarlanmış değer */
  function ascentOf(cs) {
    const key = `${cs.fontFamily}|${cs.fontWeight}|${cs.fontSize}`;
    if (baselineCache.has(key)) return baselineCache.get(key);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-30000px;top:0;visibility:hidden;white-space:nowrap;line-height:normal;text-rendering:geometricPrecision';
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontWeight = cs.fontWeight;
    probe.style.fontSize = cs.fontSize;
    const text = document.createElement('span');
    text.textContent = 'Hg';
    const mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0';
    probe.append(text, mark);
    document.body.appendChild(probe);
    const ascent = mark.getBoundingClientRect().bottom - text.getBoundingClientRect().top;
    probe.remove();
    baselineCache.set(key, ascent);
    return ascent;
  }

  /* ─── Görseller ───────────────────────────────────────── */

  /**
   * RGBA'yı renk ve maske olarak ayırır. Saydam pikseller tarayıcıda siyahtır; görüntüleyici küçültürken
   * renk ile maskeyi ayrı ayrı örneklediği için bu siyah kenarlara bulaşır ve ince yazı soluk görünür.
   * Bu yüzden saydam piksel komşularının rengini alır.
   */
  function splitPixels(data, w, h) {
    const count = w * h;
    const rgb = new Uint8Array(count * 3);
    const alpha = new Uint8Array(count);
    let opaque = true;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let seen = 0;
    for (let i = 0, p = 0; i < count; i += 1, p += 4) {
      rgb[i * 3] = data[p];
      rgb[i * 3 + 1] = data[p + 1];
      rgb[i * 3 + 2] = data[p + 2];
      alpha[i] = data[p + 3];
      if (data[p + 3] !== 255) opaque = false;
      if (data[p + 3] > 127) {
        sumR += data[p];
        sumG += data[p + 1];
        sumB += data[p + 2];
        seen += 1;
      }
    }
    if (opaque) return { rgb, alpha: null };
    const avg = seen ? [sumR / seen, sumG / seen, sumB / seen] : [0, 0, 0];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (alpha[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (!alpha[j]) continue;
            r += rgb[j * 3];
            g += rgb[j * 3 + 1];
            b += rgb[j * 3 + 2];
            n += 1;
          }
        }
        rgb[i * 3] = n ? r / n : avg[0];
        rgb[i * 3 + 1] = n ? g / n : avg[1];
        rgb[i * 3 + 2] = n ? b / n : avg[2];
      }
    }
    return { rgb, alpha };
  }

  async function rasterize(href, widthMm, heightMm, state) {
    if (state.images.has(href)) return state.images.get(href);
    const job = (async () => {
      const img = new Image();
      img.src = href;
      await img.decode();
      const limitW = Math.ceil((widthMm / 25.4) * MAX_IMAGE_DPI);
      const limitH = Math.ceil((heightMm / 25.4) * MAX_IMAGE_DPI);
      // Vektör logoların doğal boyutu küçük olabilir: basım çözünürlüğünde çizilir
      const isVector = /^data:image\/svg|\.svg(\?|$)/i.test(href);
      const natW = img.naturalWidth || limitW;
      const natH = img.naturalHeight || limitH;
      const k = isVector ? Math.max(limitW / natW, limitH / natH) / 2 : Math.min(1, Math.max(limitW / natW, limitH / natH));
      const w = Math.max(1, Math.round(natW * k));
      const h = Math.max(1, Math.round(natH * k));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0, w, h);
      const { data } = g.getImageData(0, 0, w, h);
      const { rgb, alpha } = splitPixels(data, w, h);
      return { image: state.doc.addImage({ width: w, height: h, rgb, alpha }), naturalW: natW, naturalH: natH };
    })().catch(() => {
      state.failedImages += 1;
      return null;
    });
    state.images.set(href, job);
    return job;
  }

  /* ─── Yazı çizimi ─────────────────────────────────────── */

  /** Aynı yazı tipindeki ardışık harfleri tek parçada yazar */
  function drawGlyphs(page, glyphs, size, y, thicken) {
    let from = 0;
    for (let i = 1; i <= glyphs.length; i += 1) {
      if (i === glyphs.length || glyphs[i].ttf !== glyphs[from].ttf) {
        page.text(glyphs[from].ttf, size, y, glyphs.slice(from, i), thicken);
        from = i;
      }
    }
  }

  function setFill(page, color, alpha) {
    page.fillColor(color.r, color.g, color.b);
    page.alpha(color.a * alpha, 1);
  }

  /** En kalın kesim (800 ve üstü) yazı tipinde yok: Bold dıştan çizilerek kalınlaştırılır */
  function thickenFor(cs, size) {
    return (parseInt(cs.fontWeight, 10) || 400) >= 800 ? size * EXTRA_BOLD : 0;
  }

  function setTextColor(page, color, alpha, thicken) {
    page.fillColor(color.r, color.g, color.b);
    if (thicken) page.strokeColor(color.r, color.g, color.b);
    page.alpha(color.a * alpha, thicken ? color.a * alpha : 1);
  }

  function casing(cs, el) {
    if (cs.textTransform === 'uppercase') {
      const owner = el.closest('[lang]');
      const lang = (owner && owner.lang) || 'tr';
      return (ch) => ch.toLocaleUpperCase(lang);
    }
    if (cs.textTransform === 'lowercase') {
      const owner = el.closest('[lang]');
      const lang = (owner && owner.lang) || 'tr';
      return (ch) => ch.toLocaleLowerCase(lang);
    }
    return null;
  }

  /** Düğümdeki harflerin ekrandaki kutuları */
  function measureChars(node) {
    const text = node.data;
    const range = document.createRange();
    const out = [];
    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i);
      const len = cp > 0xffff ? 2 : 1;
      range.setStart(node, i);
      range.setEnd(node, i + len);
      const rects = range.getClientRects();
      const r = rects.length ? rects[rects.length - 1] : null;
      if (r && r.width + r.height > 0 && (r.width > 0 || r.height > 0)) out.push({ cp, ch: text.slice(i, i + len), rect: r });
      i += len;
    }
    return out;
  }

  /** Sayfada dönüş açısı: yazı yönü ve üstlerdeki döndürmeler (derece) */
  function textRotation(el, cs) {
    let angle = cs.writingMode.startsWith('vertical') ? 90 : 0;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== 'none') {
        const m = /matrix\(([^,]+),\s*([^,]+)/.exec(t);
        if (m) angle += (Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180) / Math.PI;
      }
      if (n.classList.contains('print-sheet')) break;
    }
    return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  }

  function paintTextNode(node, el, cs, ctx, state) {
    if (!node.data.trim()) return;
    const color = parseColor(cs.color);
    if (!color) return;
    const chars = measureChars(node);
    if (!chars.length) return;
    const { page } = state;
    const chain = fontChain(cs);
    const fontPx = parseFloat(cs.fontSize);
    const size = fontPx * PX;
    const ascent = ascentOf(cs);
    const map = casing(cs, el);
    const toX = (v) => (v - ctx.ox) * PX;
    const toY = (v) => (v - ctx.oy) * PX;
    const rotation = textRotation(el, cs);
    const thicken = thickenFor(cs, size);

    page.save();
    setTextColor(page, color, ctx.alpha, thicken);

    /* Yan yazı: harfler dikey dizilir, yazı kendi ekseninde döndürülerek çizilir */
    if (rotation === 90 || rotation === 270) {
      const up = rotation === 270;
      const first = chars[0].rect;
      const originX = up ? toX(first.left) + ascent * PX : toX(first.right) - ascent * PX;
      const originY = up ? toY(first.bottom) : toY(first.top);
      const glyphs = [];
      for (const c of chars) {
        const text = map ? map(c.ch) : c.ch;
        const along = up ? originY - toY(c.rect.bottom) : toY(c.rect.top) - originY;
        for (const part of Array.from(text)) {
          const cp = part.codePointAt(0);
          if (INVISIBLE.has(cp)) continue;
          glyphs.push(Object.assign(glyphOf(chain, cp, state), { x: along, ch: part }));
        }
      }
      page.save();
      if (up) page.transform(0, -1, 1, 0, originX, originY);
      else page.transform(0, 1, -1, 0, originX, originY);
      drawGlyphs(page, glyphs, size, 0, thicken);
      page.restore();
      page.restore();
      return;
    }

    /* Yatay yazı: satırlara ayrılır, her harf ölçülen yerine gelir */
    let line = [];
    let lineTop = null;
    const flush = () => {
      if (!line.length) return;
      // Satır sonundaki boşluk çizilmez, satır başındaki taşma olmaz
      while (line.length && line[line.length - 1].ch.trim() === '') line.pop();
      if (line.length) drawGlyphs(page, line, size, toY(lineTop + ascent), thicken);
      line = [];
    };
    for (const c of chars) {
      if (lineTop === null || Math.abs(c.rect.top - lineTop) > 1) {
        flush();
        lineTop = c.rect.top;
      }
      if (INVISIBLE.has(c.cp)) continue;
      const text = map ? map(c.ch) : c.ch;
      let x = toX(c.rect.left);
      for (const part of Array.from(text)) {
        const cp = /\s/.test(part) ? 0x20 : part.codePointAt(0);
        const g = glyphOf(chain, cp, state);
        line.push(Object.assign(g, { x, ch: cp === 0x20 ? ' ' : part }));
        x += g.ttf.widthEm(g.gid) * size;
      }
    }
    flush();
    page.restore();
  }

  /* ─── HTML kutuları ───────────────────────────────────── */

  function paintBox(el, cs, rect, ctx, state) {
    const { page } = state;
    const x = (rect.left - ctx.ox) * PX;
    const y = (rect.top - ctx.oy) * PX;
    const w = rect.width * PX;
    const h = rect.height * PX;
    const bg = parseColor(cs.backgroundColor);
    if (bg && w > 0 && h > 0) {
      page.save();
      setFill(page, bg, ctx.alpha);
      const radius = Math.min(parseFloat(cs.borderTopLeftRadius) * PX || 0, w / 2, h / 2);
      if (radius > 0) {
        const k = radius * 0.4477153;
        page.moveTo(x + radius, y);
        page.lineTo(x + w - radius, y);
        page.curveTo(x + w - k, y, x + w, y + k, x + w, y + radius);
        page.lineTo(x + w, y + h - radius);
        page.curveTo(x + w, y + h - k, x + w - k, y + h, x + w - radius, y + h);
        page.lineTo(x + radius, y + h);
        page.curveTo(x + k, y + h, x, y + h - k, x, y + h - radius);
        page.lineTo(x, y + radius);
        page.curveTo(x, y + k, x + k, y, x + radius, y);
        page.closePath();
      } else {
        page.rect(x, y, w, h);
      }
      page.paint({ fill: true });
      page.restore();
    }
    // Birleşik tablo kenarlığı hücre sınırının ortasına biner
    const collapsed = cs.display === 'table-cell' && cs.borderCollapse === 'collapse';
    const side = (name, draw) => {
      const width = parseFloat(cs[`border${name}Width`]) * PX;
      if (!(width > 0) || cs[`border${name}Style`] === 'none' || cs[`border${name}Style`] === 'hidden') return;
      const color = parseColor(cs[`border${name}Color`]);
      if (!color) return;
      page.save();
      setFill(page, color, ctx.alpha);
      draw(width);
      page.paint({ fill: true });
      page.restore();
    };
    side('Top', (b) => page.rect(x, collapsed ? y - b / 2 : y, w, b));
    side('Bottom', (b) => page.rect(x, collapsed ? y + h - b / 2 : y + h - b, w, b));
    side('Left', (b) => page.rect(collapsed ? x - b / 2 : x, y, b, h));
    side('Right', (b) => page.rect(collapsed ? x + w - b / 2 : x + w - b, y, b, h));
  }

  async function paintImg(el, cs, rect, ctx, state) {
    const href = el.currentSrc || el.src;
    if (!href) return;
    const boxW = rect.width * PX;
    const boxH = rect.height * PX;
    const res = await rasterize(href, boxW, boxH, state);
    if (!res) return;
    let w = boxW;
    let h = boxH;
    if (cs.objectFit === 'contain' || cs.objectFit === 'scale-down') {
      const k = Math.min(boxW / res.naturalW, boxH / res.naturalH);
      w = res.naturalW * k;
      h = res.naturalH * k;
    }
    const pos = cs.objectPosition.split(/\s+/).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
    const x = (rect.left - ctx.ox) * PX + (boxW - w) * (pos[0] === undefined ? 0.5 : pos[0]);
    const y = (rect.top - ctx.oy) * PX + (boxH - h) * (pos[1] === undefined ? 0.5 : pos[1]);
    const { page } = state;
    page.save();
    page.alpha(ctx.alpha, 1);
    page.image(res.image, x, y, w, h);
    page.restore();
  }

  /** Düzen sırası: akıştakiler önce, konumlananlar sonra (z-index sırasıyla) */
  function paintOrder(el) {
    const normal = [];
    const positioned = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3) normal.push(child);
      else if (child.nodeType === 1) {
        const cs = getComputedStyle(child);
        if (cs.position !== 'static' || cs.transform !== 'none') positioned.push({ child, z: parseInt(cs.zIndex, 10) || 0 });
        else normal.push(child);
      }
    }
    positioned.sort((a, b) => a.z - b.z);
    return normal.concat(positioned.map((p) => p.child));
  }

  async function paintElement(el, ctx, state) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const tag = el.localName;
    if (tag === 'svg') {
      await paintSvgRoot(el, cs, ctx, state);
      return;
    }
    const visible = cs.visibility === 'visible';
    const next = Object.assign({}, ctx, { alpha: ctx.alpha * parseFloat(cs.opacity) });
    if (!(next.alpha > 0)) return;
    const rect = el.getBoundingClientRect();
    if (visible) paintBox(el, cs, rect, next, state);
    if (tag === 'img') {
      if (visible) await paintImg(el, cs, rect, next, state);
      return;
    }
    const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    const { page } = state;
    if (clips) {
      page.save();
      page.rect((rect.left - ctx.ox) * PX, (rect.top - ctx.oy) * PX, rect.width * PX, rect.height * PX);
      page.clip();
    }
    for (const child of paintOrder(el)) {
      if (child.nodeType === 3) {
        if (visible) paintTextNode(child, el, cs, next, state);
      } else {
        await paintElement(child, next, state);
      }
    }
    if (clips) page.restore();
  }

  /* ─── SVG ─────────────────────────────────────────────── */

  const CIRCLE_K = 0.5522847;

  function ellipseCommands(cx, cy, rx, ry) {
    const kx = rx * CIRCLE_K;
    const ky = ry * CIRCLE_K;
    return [
      ['M', cx + rx, cy],
      ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
      ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
      ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
      ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
      ['Z']
    ];
  }

  function shapeCommands(el, tag) {
    const val = (name) => el[name].baseVal.value;
    switch (tag) {
      case 'path':
        return PidPdf.parsePath(el.getAttribute('d'));
      case 'rect': {
        const x = val('x');
        const y = val('y');
        const w = val('width');
        const h = val('height');
        if (!(w > 0) || !(h > 0)) return null;
        let rx = val('rx');
        let ry = val('ry');
        if (!el.hasAttribute('ry')) ry = rx;
        if (!el.hasAttribute('rx')) rx = ry;
        rx = Math.min(rx, w / 2);
        ry = Math.min(ry, h / 2);
        if (!rx || !ry) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
        const kx = rx * (1 - CIRCLE_K);
        const ky = ry * (1 - CIRCLE_K);
        return [
          ['M', x + rx, y], ['L', x + w - rx, y], ['C', x + w - kx, y, x + w, y + ky, x + w, y + ry],
          ['L', x + w, y + h - ry], ['C', x + w, y + h - ky, x + w - kx, y + h, x + w - rx, y + h],
          ['L', x + rx, y + h], ['C', x + kx, y + h, x, y + h - ky, x, y + h - ry],
          ['L', x, y + ry], ['C', x, y + ky, x + kx, y, x + rx, y], ['Z']
        ];
      }
      case 'circle':
        return val('r') > 0 ? ellipseCommands(val('cx'), val('cy'), val('r'), val('r')) : null;
      case 'ellipse':
        return val('rx') > 0 && val('ry') > 0 ? ellipseCommands(val('cx'), val('cy'), val('rx'), val('ry')) : null;
      case 'line':
        return [['M', val('x1'), val('y1')], ['L', val('x2'), val('y2')]];
      case 'polyline':
      case 'polygon': {
        const pts = [...el.points];
        if (!pts.length) return null;
        const out = pts.map((p, i) => [i ? 'L' : 'M', p.x, p.y]);
        if (tag === 'polygon') out.push(['Z']);
        return out;
      }
      default:
        return null;
    }
  }

  function applyCtm(el, ctx, page) {
    const m = el.getScreenCTM();
    if (!m) return false;
    page.transform(m.a * PX, m.b * PX, m.c * PX, m.d * PX, (m.e - ctx.ox) * PX, (m.f - ctx.oy) * PX);
    return true;
  }

  function paintShape(el, tag, cs, ctx, state) {
    const commands = shapeCommands(el, tag);
    if (!commands || !commands.length) return;
    const fill = parseColor(cs.fill, cs.color);
    const stroke = parseColor(cs.stroke, cs.color);
    const width = parseFloat(cs.strokeWidth);
    const hasStroke = !!stroke && width > 0;
    const open = tag === 'line';
    const hasFill = !!fill && !open;
    if (!hasFill && !hasStroke) return;
    const { page } = state;
    page.save();
    if (!applyCtm(el, ctx, page)) {
      page.restore();
      return;
    }
    if (hasFill) page.fillColor(fill.r, fill.g, fill.b);
    if (hasStroke) {
      page.strokeColor(stroke.r, stroke.g, stroke.b);
      const dash = cs.strokeDasharray && cs.strokeDasharray !== 'none'
        ? cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter((v) => v >= 0)
        : null;
      page.lineStyle({
        width,
        cap: { round: 1, square: 2 }[cs.strokeLinecap],
        join: { round: 1, bevel: 2 }[cs.strokeLinejoin],
        miter: parseFloat(cs.strokeMiterlimit) || 4,
        dash: dash && dash.some((v) => v > 0) ? dash : null,
        dashOffset: parseFloat(cs.strokeDashoffset) || 0
      });
    }
    const fillAlpha = hasFill ? fill.a * parseFloat(cs.fillOpacity) * ctx.alpha : 1;
    const strokeAlpha = hasStroke ? stroke.a * parseFloat(cs.strokeOpacity) * ctx.alpha : 1;
    page.alpha(fillAlpha, strokeAlpha);
    page.addPath(commands);
    page.paint({ fill: hasFill, stroke: hasStroke, evenOdd: cs.fillRule === 'evenodd' });
    page.restore();
  }

  function paintSvgText(el, cs, ctx, state) {
    const count = el.getNumberOfChars();
    if (!count) return;
    const color = parseColor(cs.fill, cs.color);
    if (!color) return;
    const raw = el.textContent;
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    const text = collapsed.length === count ? collapsed : raw;
    const chain = fontChain(cs);
    const size = parseFloat(cs.fontSize);
    const { page } = state;
    page.save();
    if (!applyCtm(el, ctx, page)) {
      page.restore();
      return;
    }
    const thicken = thickenFor(cs, size);
    setTextColor(page, color, parseFloat(cs.fillOpacity) * ctx.alpha, thicken);
    let line = [];
    let lineY = null;
    const flush = () => {
      if (line.length) drawGlyphs(page, line, size, lineY, thicken);
      line = [];
    };
    for (let i = 0; i < Math.min(count, text.length); i += 1) {
      const cp = text.codePointAt(i);
      if (cp >= 0xdc00 && cp <= 0xdfff) continue;
      if (INVISIBLE.has(cp)) continue;
      let pos;
      try {
        pos = el.getStartPositionOfChar(i);
      } catch {
        continue;
      }
      if (lineY === null || Math.abs(pos.y - lineY) > size * 0.01) {
        flush();
        lineY = pos.y;
      }
      const code = /\s/.test(text[i]) ? 0x20 : cp;
      line.push(Object.assign(glyphOf(chain, code, state), { x: pos.x, ch: String.fromCodePoint(code) }));
    }
    flush();
    page.restore();
  }

  async function paintSvgImage(el, ctx, state) {
    const href = el.href.baseVal || el.getAttribute('href') || el.getAttribute('xlink:href');
    if (!href) return;
    const boxX = el.x.baseVal.value;
    const boxY = el.y.baseVal.value;
    const boxW = el.width.baseVal.value;
    const boxH = el.height.baseVal.value;
    if (!(boxW > 0) || !(boxH > 0)) return;
    const m = el.getScreenCTM();
    const scale = m ? Math.hypot(m.a, m.b) * PX : 1;
    const res = await rasterize(href, boxW * scale, boxH * scale, state);
    if (!res) return;
    const par = (el.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim();
    let w = boxW;
    let h = boxH;
    if (!par.startsWith('none')) {
      const k = Math.min(boxW / res.naturalW, boxH / res.naturalH);
      w = res.naturalW * k;
      h = res.naturalH * k;
    }
    const alignX = par.includes('xMin') ? 0 : par.includes('xMax') ? 1 : 0.5;
    const alignY = par.includes('YMin') ? 0 : par.includes('YMax') ? 1 : 0.5;
    const { page } = state;
    page.save();
    if (applyCtm(el, ctx, page)) {
      page.alpha(ctx.alpha, 1);
      page.image(res.image, boxX + (boxW - w) * alignX, boxY + (boxH - h) * alignY, w, h);
    }
    page.restore();
  }

  async function paintSvgNode(el, ctx, state) {
    const tag = el.localName;
    if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'style') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const next = Object.assign({}, ctx, { alpha: ctx.alpha * parseFloat(cs.opacity) });
    if (!(next.alpha > 0)) return;
    if (tag === 'g' || tag === 'a' || tag === 'svg') {
      for (const child of el.children) await paintSvgNode(child, next, state);
      return;
    }
    if (cs.visibility !== 'visible') return;
    if (tag === 'text') paintSvgText(el, cs, next, state);
    else if (tag === 'image') await paintSvgImage(el, next, state);
    else paintShape(el, tag, cs, next, state);
  }

  async function paintSvgRoot(svg, cs, ctx, state) {
    const { page } = state;
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const next = Object.assign({}, ctx, { alpha: ctx.alpha * parseFloat(cs.opacity) });
    page.save();
    if (cs.overflowX !== 'visible') {
      page.rect((rect.left - ctx.ox) * PX, (rect.top - ctx.oy) * PX, rect.width * PX, rect.height * PX);
      page.clip();
    }
    for (const child of svg.children) await paintSvgNode(child, next, state);
    page.restore();
  }

  /* ─── Belge ───────────────────────────────────────────── */

  /**
   * @param root içinde .print-sheet sayfaları olan, dizilmiş öğe
   * @param options.onProgress (bitti, toplam)
   * @returns {{ bytes: Uint8Array, pages: number, missing: string[], failedImages: number }}
   */
  async function render(root, options) {
    const opts = options || {};
    const doc = PidPdf.create({ title: opts.title, producer: 'BOMX' });
    const sheets = [...root.children].filter((el) => el.classList.contains('print-sheet'));
    const state = { doc, page: null, images: new Map(), missing: new Set(), failedImages: 0 };
    baselineCache.clear();
    chainCache.clear();
    for (let i = 0; i < sheets.length; i += 1) {
      const rect = sheets[i].getBoundingClientRect();
      state.page = doc.addPage(Math.round(rect.width * PX * 100) / 100, Math.round(rect.height * PX * 100) / 100);
      await paintElement(sheets[i], { ox: rect.left, oy: rect.top, alpha: 1 }, state);
      if (opts.onProgress) opts.onProgress(i + 1, sheets.length);
      // Uzun belgede arayüz donmasın
      await new Promise((resolve) => setTimeout(resolve));
    }
    const bytes = await doc.save();
    return { bytes, pages: sheets.length, missing: [...state.missing], failedImages: state.failedImages };
  }

  root.PidPdfDom = { loadFonts, begin, end, render, FACES };
})(typeof self !== 'undefined' ? self : this);

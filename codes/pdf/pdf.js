/* PDF yazıcı: yazdırma penceresi olmadan doğrudan PDF dosyası üretir. Bağımlılığı yoktur.
   Sayfa koordinatı milimetredir, y aşağı doğru artar. Yazı tipleri kullanılan harflere indirilip gömülür,
   metin seçilebilir ve aranabilir kalır. Ekran düzeninden çizime çeviri pdf-dom.js içindedir. */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PidPdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PT_PER_MM = 72 / 25.4;

  const num = (v) => {
    const r = Math.round(v * 10000) / 10000;
    return r === 0 ? '0' : String(r);
  };
  const hex4 = (v) => v.toString(16).padStart(4, '0');

  function latin1(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  function concat(chunks) {
    const size = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  /** PDF metin dizesi: UTF-16BE, başında BOM */
  function textString(value) {
    let out = 'FEFF';
    for (let i = 0; i < value.length; i += 1) out += hex4(value.charCodeAt(i)).toUpperCase();
    return `<${out}>`;
  }

  /** Karakteri Unicode'a çeviren tablodaki UTF-16BE karşılığı */
  function utf16Hex(text) {
    let out = '';
    for (let i = 0; i < text.length; i += 1) out += hex4(text.charCodeAt(i));
    return out;
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ─── SVG yolu ────────────────────────────────────────── */

  const COUNTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

  /** Yay → kübik eğriler (SVG 1.1 F.6) */
  function arcToCubics(x0, y0, rxIn, ryIn, rotation, large, sweep, x, y) {
    if (x0 === x && y0 === y) return [];
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (!rx || !ry) return [[x0, y0, x, y, x, y]];
    const phi = (rotation * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (x0 - x) / 2;
    const dy = (y0 - y) / 2;
    const px = cos * dx + sin * dy;
    const py = -sin * dx + cos * dy;
    const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    const num2 = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
    const den = rx * rx * py * py + ry * ry * px * px;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
    const cxp = (co * rx * py) / ry;
    const cyp = (-co * ry * px) / rx;
    const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
    const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
    const angle = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const theta = angle(1, 0, (px - cxp) / rx, (py - cyp) / ry);
    let delta = angle((px - cxp) / rx, (py - cyp) / ry, (-px - cxp) / rx, (-py - cyp) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
    const step = delta / parts;
    const k = (4 / 3) * Math.tan(step / 4);
    const out = [];
    const point = (ux, uy) => [cx + cos * rx * ux - sin * ry * uy, cy + sin * rx * ux + cos * ry * uy];
    for (let i = 0; i < parts; i += 1) {
      const a0 = theta + i * step;
      const a1 = a0 + step;
      const [c1x, c1y] = point(Math.cos(a0) - k * Math.sin(a0), Math.sin(a0) + k * Math.cos(a0));
      const [c2x, c2y] = point(Math.cos(a1) + k * Math.sin(a1), Math.sin(a1) - k * Math.cos(a1));
      const [ex, ey] = i === parts - 1 ? [x, y] : point(Math.cos(a1), Math.sin(a1));
      out.push([c1x, c1y, c2x, c2y, ex, ey]);
    }
    return out;
  }

  /** SVG yol metnini mutlak M, L, C, Z komutlarına çevirir */
  function parsePath(d) {
    const text = String(d || '');
    const out = [];
    let i = 0;
    const skip = () => {
      while (i < text.length && /[\s,]/.test(text[i])) i += 1;
    };
    const number = () => {
      skip();
      const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(text.slice(i));
      if (!m) return null;
      i += m[0].length;
      return parseFloat(m[0]);
    };
    // Yay bayrakları tek hanedir, araları boş olmayabilir ("a1 1 0 01.5.5")
    const flag = () => {
      skip();
      const c = text[i];
      if (c !== '0' && c !== '1') return null;
      i += 1;
      return c === '1' ? 1 : 0;
    };
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let prevCtrl = null;
    let prevQuad = null;
    let cmd = null;
    while (true) {
      skip();
      if (i >= text.length) break;
      if (/[a-zA-Z]/.test(text[i])) {
        cmd = text[i];
        i += 1;
        if (COUNTS[cmd.toUpperCase()] === undefined) break;
      } else if (!cmd) {
        break;
      }
      const upper = cmd.toUpperCase();
      const rel = cmd !== upper;
      if (upper === 'Z') {
        out.push(['Z']);
        cx = sx;
        cy = sy;
        prevCtrl = null;
        prevQuad = null;
        cmd = null;
        continue;
      }
      const args = [];
      let ok = true;
      for (let n = 0; n < COUNTS[upper]; n += 1) {
        const v = upper === 'A' && (n === 3 || n === 4) ? flag() : number();
        if (v === null) {
          ok = false;
          break;
        }
        args.push(v);
      }
      if (!ok) break;
      const ax = (v) => (rel ? cx + v : v);
      const ay = (v) => (rel ? cy + v : v);
      let ctrl = null;
      let quad = null;
      switch (upper) {
        case 'M':
          cx = ax(args[0]);
          cy = ay(args[1]);
          sx = cx;
          sy = cy;
          out.push(['M', cx, cy]);
          cmd = rel ? 'l' : 'L';
          break;
        case 'L':
          cx = ax(args[0]);
          cy = ay(args[1]);
          out.push(['L', cx, cy]);
          break;
        case 'H':
          cx = ax(args[0]);
          out.push(['L', cx, cy]);
          break;
        case 'V':
          cy = ay(args[0]);
          out.push(['L', cx, cy]);
          break;
        case 'C': {
          const c = [ax(args[0]), ay(args[1]), ax(args[2]), ay(args[3]), ax(args[4]), ay(args[5])];
          out.push(['C', ...c]);
          ctrl = [c[2], c[3]];
          [cx, cy] = [c[4], c[5]];
          break;
        }
        case 'S': {
          const c1 = prevCtrl ? [2 * cx - prevCtrl[0], 2 * cy - prevCtrl[1]] : [cx, cy];
          const c = [ax(args[0]), ay(args[1]), ax(args[2]), ay(args[3])];
          out.push(['C', c1[0], c1[1], ...c]);
          ctrl = [c[0], c[1]];
          [cx, cy] = [c[2], c[3]];
          break;
        }
        case 'Q':
        case 'T': {
          const q = upper === 'Q'
            ? [ax(args[0]), ay(args[1])]
            : (prevQuad ? [2 * cx - prevQuad[0], 2 * cy - prevQuad[1]] : [cx, cy]);
          const ex = upper === 'Q' ? ax(args[2]) : ax(args[0]);
          const ey = upper === 'Q' ? ay(args[3]) : ay(args[1]);
          out.push(['C', cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy), ex + (2 / 3) * (q[0] - ex), ey + (2 / 3) * (q[1] - ey), ex, ey]);
          quad = q;
          cx = ex;
          cy = ey;
          break;
        }
        case 'A': {
          const ex = ax(args[5]);
          const ey = ay(args[6]);
          for (const c of arcToCubics(cx, cy, args[0], args[1], args[2], args[3], args[4], ex, ey)) out.push(['C', ...c]);
          cx = ex;
          cy = ey;
          break;
        }
        default:
          break;
      }
      prevCtrl = ctrl;
      prevQuad = quad;
    }
    return out;
  }

  /* ─── TrueType ────────────────────────────────────────── */

  class TrueType {
    /** @param bytes .ttf dosyası @param name PDF'te görünecek ad */
    constructor(bytes, name) {
      this.bytes = bytes;
      this.name = String(name).replace(/[^A-Za-z0-9-]/g, '');
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.view = view;
      this.tables = new Map();
      const count = view.getUint16(4);
      for (let i = 0; i < count; i += 1) {
        const at = 12 + i * 16;
        const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
        this.tables.set(tag, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
      }
      for (const tag of ['head', 'hhea', 'hmtx', 'maxp', 'loca', 'glyf']) {
        if (!this.tables.has(tag)) throw new Error(`Yazı tipinde ${tag} tablosu yok: ${name}`);
      }
      const head = this.tables.get('head').offset;
      this.unitsPerEm = view.getUint16(head + 18);
      this.bbox = [view.getInt16(head + 36), view.getInt16(head + 38), view.getInt16(head + 40), view.getInt16(head + 42)];
      this.longLoca = view.getInt16(head + 50) === 1;
      const hhea = this.tables.get('hhea').offset;
      this.ascent = view.getInt16(hhea + 4);
      this.descent = view.getInt16(hhea + 6);
      this.hMetrics = view.getUint16(hhea + 34);
      this.numGlyphs = view.getUint16(this.tables.get('maxp').offset + 4);
      const os2 = this.tables.get('OS/2');
      this.capHeight = os2 && os2.length >= 90 && view.getUint16(os2.offset) >= 2 ? view.getInt16(os2.offset + 88) : this.ascent;
      this.weight = os2 ? view.getUint16(os2.offset + 4) : 400;
      // Küçültülmüş dosyada harf tablosu yoktur: PDF harfleri numarasıyla çağırır
      this.lookup = this.tables.has('cmap') ? this.readCmap() : () => 0;
      this.glyphCache = new Map();
    }

    readCmap() {
      const { view } = this;
      const base = this.tables.get('cmap').offset;
      const count = view.getUint16(base + 2);
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < count; i += 1) {
        const platform = view.getUint16(base + 4 + i * 8);
        const encoding = view.getUint16(base + 6 + i * 8);
        const offset = base + view.getUint32(base + 8 + i * 8);
        const format = view.getUint16(offset);
        const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
        if (!unicode || (format !== 4 && format !== 12)) continue;
        const score = format === 12 ? 2 : 1;
        if (score > bestScore) {
          best = { offset, format };
          bestScore = score;
        }
      }
      if (!best) throw new Error(`Yazı tipinde Unicode tablosu yok: ${this.name}`);
      const { offset, format } = best;
      if (format === 12) {
        const groups = view.getUint32(offset + 12);
        return (cp) => {
          for (let i = 0; i < groups; i += 1) {
            const at = offset + 16 + i * 12;
            const start = view.getUint32(at);
            if (cp < start) return 0;
            if (cp <= view.getUint32(at + 4)) return view.getUint32(at + 8) + cp - start;
          }
          return 0;
        };
      }
      const segX2 = view.getUint16(offset + 6);
      const ends = offset + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      return (cp) => {
        if (cp > 0xffff) return 0;
        for (let s = 0; s < segX2; s += 2) {
          if (cp > view.getUint16(ends + s)) continue;
          const start = view.getUint16(starts + s);
          if (cp < start) return 0;
          const delta = view.getUint16(deltas + s);
          const range = view.getUint16(ranges + s);
          if (range === 0) return (cp + delta) & 0xffff;
          const g = view.getUint16(ranges + s + range + (cp - start) * 2);
          return g ? (g + delta) & 0xffff : 0;
        }
        return 0;
      };
    }

    /** Kod noktasının harf numarası; yoksa 0 */
    glyphIndex(cp) {
      if (!this.glyphCache.has(cp)) this.glyphCache.set(cp, this.lookup(cp));
      return this.glyphCache.get(cp);
    }

    /** Harfin ilerlemesi (em oranı) */
    widthEm(gid) {
      const hmtx = this.tables.get('hmtx').offset;
      const index = Math.min(gid, this.hMetrics - 1);
      return this.view.getUint16(hmtx + index * 4) / this.unitsPerEm;
    }

    glyphRange(gid) {
      const loca = this.tables.get('loca').offset;
      const glyf = this.tables.get('glyf').offset;
      const start = this.longLoca ? this.view.getUint32(loca + gid * 4) : this.view.getUint16(loca + gid * 2) * 2;
      const end = this.longLoca ? this.view.getUint32(loca + (gid + 1) * 4) : this.view.getUint16(loca + (gid + 1) * 2) * 2;
      return [glyf + start, glyf + end];
    }

    /** Birleşik harfin (ş, Ğ gibi) parçaları */
    components(gid) {
      const [start, end] = this.glyphRange(gid);
      if (end - start < 10 || this.view.getInt16(start) >= 0) return [];
      const out = [];
      let at = start + 10;
      let flags;
      do {
        flags = this.view.getUint16(at);
        out.push(this.view.getUint16(at + 2));
        at += 4 + (flags & 0x0001 ? 4 : 2);
        if (flags & 0x0008) at += 2;
        else if (flags & 0x0040) at += 4;
        else if (flags & 0x0080) at += 8;
      } while (flags & 0x0020);
      return out;
    }

    /**
     * Yalnız kullanılan harfleri taşıyan dosya. Harf numaraları değişmez, kullanılmayanlar boş kalır.
     * @param used harf numaraları
     */
    subset(used) {
      const keep = new Set([0]);
      const stack = [...used];
      while (stack.length) {
        const gid = stack.pop();
        if (keep.has(gid) && gid !== 0) continue;
        keep.add(gid);
        for (const c of this.components(gid)) if (!keep.has(c)) stack.push(c);
      }
      const loca = new Uint8Array((this.numGlyphs + 1) * 4);
      const locaView = new DataView(loca.buffer);
      const parts = [];
      let at = 0;
      for (let gid = 0; gid < this.numGlyphs; gid += 1) {
        locaView.setUint32(gid * 4, at);
        if (!keep.has(gid)) continue;
        const [start, end] = this.glyphRange(gid);
        if (end <= start) continue;
        parts.push(this.bytes.subarray(start, end));
        at += end - start;
        const pad = (4 - (at % 4)) % 4;
        if (pad) {
          parts.push(new Uint8Array(pad));
          at += pad;
        }
      }
      locaView.setUint32(this.numGlyphs * 4, at);

      const table = (tag) => {
        const t = this.tables.get(tag);
        return t ? this.bytes.subarray(t.offset, t.offset + t.length) : null;
      };
      const head = table('head').slice();
      const headView = new DataView(head.buffer);
      headView.setUint32(8, 0);
      headView.setInt16(50, 1);

      const out = new Map();
      out.set('glyf', concat(parts));
      out.set('head', head);
      out.set('hhea', table('hhea'));
      out.set('hmtx', table('hmtx'));
      out.set('loca', loca);
      out.set('maxp', table('maxp'));
      for (const tag of ['cvt ', 'fpgm', 'prep']) {
        const t = table(tag);
        if (t) out.set(tag, t);
      }
      return { bytes: buildSfnt(out), glyphs: keep };
    }
  }

  function tableChecksum(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let sum = 0;
    const whole = bytes.length & ~3;
    for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    if (bytes.length > whole) {
      let tail = 0;
      for (let i = whole; i < whole + 4; i += 1) tail = ((tail << 8) | (i < bytes.length ? bytes[i] : 0)) >>> 0;
      sum = (sum + tail) >>> 0;
    }
    return sum;
  }

  function buildSfnt(tables) {
    const tags = [...tables.keys()].sort();
    const headerSize = 12 + tags.length * 16;
    let size = headerSize;
    for (const tag of tags) size += (tables.get(tag).length + 3) & ~3;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    const power = Math.floor(Math.log2(tags.length));
    view.setUint32(0, 0x00010000);
    view.setUint16(4, tags.length);
    view.setUint16(6, (1 << power) * 16);
    view.setUint16(8, power);
    view.setUint16(10, tags.length * 16 - (1 << power) * 16);
    let at = headerSize;
    let headAt = 0;
    tags.forEach((tag, i) => {
      const data = tables.get(tag);
      const entry = 12 + i * 16;
      for (let c = 0; c < 4; c += 1) out[entry + c] = tag.charCodeAt(c);
      view.setUint32(entry + 4, tableChecksum(data));
      view.setUint32(entry + 8, at);
      view.setUint32(entry + 12, data.length);
      out.set(data, at);
      if (tag === 'head') headAt = at;
      at += (data.length + 3) & ~3;
    });
    view.setUint32(headAt + 8, (0xb1b0afba - tableChecksum(out)) >>> 0);
    return out;
  }

  /* ─── Sayfa ───────────────────────────────────────────── */

  class Page {
    constructor(doc, widthMm, heightMm) {
      this.doc = doc;
      this.width = widthMm;
      this.height = heightMm;
      const k = num(PT_PER_MM);
      this.ops = [`${k} 0 0 -${k} 0 ${num(heightMm * PT_PER_MM)} cm`];
    }

    save() { this.ops.push('q'); }
    restore() { this.ops.push('Q'); }
    transform(a, b, c, d, e, f) { this.ops.push(`${[a, b, c, d, e, f].map(num6).join(' ')} cm`); }

    fillColor(r, g, b) { this.ops.push(`${unit(r)} ${unit(g)} ${unit(b)} rg`); }
    strokeColor(r, g, b) { this.ops.push(`${unit(r)} ${unit(g)} ${unit(b)} RG`); }
    alpha(fill, stroke) {
      if (fill >= 1 && stroke >= 1) return;
      this.ops.push(`/${this.doc.alphaState(fill, stroke)} gs`);
    }
    lineStyle({ width, cap, join, miter, dash, dashOffset }) {
      if (width !== undefined) this.ops.push(`${num(width)} w`);
      if (cap) this.ops.push(`${cap} J`);
      if (join) this.ops.push(`${join} j`);
      if (miter !== undefined) this.ops.push(`${num(miter)} M`);
      if (dash && dash.length) this.ops.push(`[${dash.map(num).join(' ')}] ${num(dashOffset || 0)} d`);
    }

    rect(x, y, w, h) { this.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`); }
    moveTo(x, y) { this.ops.push(`${num(x)} ${num(y)} m`); }
    lineTo(x, y) { this.ops.push(`${num(x)} ${num(y)} l`); }
    curveTo(a, b, c, d, e, f) { this.ops.push(`${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} c`); }
    closePath() { this.ops.push('h'); }

    /** parsePath çıktısını yola ekler */
    addPath(commands) {
      for (const c of commands) {
        if (c[0] === 'M') this.moveTo(c[1], c[2]);
        else if (c[0] === 'L') this.lineTo(c[1], c[2]);
        else if (c[0] === 'C') this.curveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
        else this.closePath();
      }
    }

    paint({ fill, stroke, evenOdd }) {
      if (fill && stroke) this.ops.push(evenOdd ? 'B*' : 'B');
      else if (fill) this.ops.push(evenOdd ? 'f*' : 'f');
      else if (stroke) this.ops.push('S');
      else this.ops.push('n');
    }

    clip() { this.ops.push('W n'); }

    image(image, x, y, w, h) {
      this.ops.push(`q ${num(w)} 0 0 ${num(-h)} ${num(x)} ${num(y + h)} cm /${image.name} Do Q`);
    }

    /**
     * Taban çizgisinde yazı. Harf yerleri ölçüldüğü gibi korunur (aralık, kerning).
     * @param glyphs [{ gid, x, ch }] x: bu koordinatta harfin başlangıcı
     * @param thicken harfi bu kalınlıkta dıştan da çizer (daha kalın kesimi olmayan yazı tipi için)
     */
    text(font, size, y, glyphs, thicken) {
      if (!glyphs.length || !(size > 0)) return;
      const slot = this.doc.fontSlot(font);
      const items = [];
      let run = '';
      glyphs.forEach((g, i) => {
        if (!slot.used.has(g.gid)) slot.used.set(g.gid, g.ch);
        if (i) {
          const prev = glyphs[i - 1];
          const adjust = (-(g.x - prev.x - font.widthEm(prev.gid) * size) / size) * 1000;
          if (Math.abs(adjust) >= 0.5) {
            items.push(`<${run}>`, String(Math.round(adjust)));
            run = '';
          }
        }
        run += hex4(g.gid);
      });
      items.push(`<${run}>`);
      const mode = thicken > 0 ? `${num6(thicken)} w 2 Tr ` : '';
      const reset = thicken > 0 ? ' 0 Tr' : '';
      this.ops.push(`${mode}BT /${slot.name} 1 Tf ${num6(size)} 0 0 ${num6(-size)} ${num(glyphs[0].x)} ${num(y)} Tm [${items.join(' ')}] TJ ET${reset}`);
    }
  }

  const unit = (v) => num(Math.max(0, Math.min(255, v)) / 255);
  const num6 = (v) => {
    const r = Math.round(v * 1000000) / 1000000;
    return r === 0 ? '0' : String(r);
  };

  /* ─── Belge ───────────────────────────────────────────── */

  class Document {
    constructor(info) {
      this.info = info || {};
      this.pages = [];
      this.fonts = new Map();
      this.images = [];
      this.alphas = new Map();
    }

    addPage(widthMm, heightMm) {
      const page = new Page(this, widthMm, heightMm);
      this.pages.push(page);
      return page;
    }

    fontSlot(font) {
      if (!this.fonts.has(font)) this.fonts.set(font, { font, name: `F${this.fonts.size}`, used: new Map() });
      return this.fonts.get(font);
    }

    alphaState(fill, stroke) {
      const key = `${num(fill)}|${num(stroke)}`;
      if (!this.alphas.has(key)) this.alphas.set(key, { name: `G${this.alphas.size}`, fill, stroke });
      return this.alphas.get(key).name;
    }

    /** @param image { width, height, rgb, alpha } alpha yoksa saydamlık yoktur */
    addImage(image) {
      const entry = Object.assign({ name: `I${this.images.length}` }, image);
      this.images.push(entry);
      return entry;
    }

    async save() {
      let next = 5;
      const alloc = () => {
        next += 1;
        return next - 1;
      };
      const objects = [];
      const put = (id, dict, stream) => objects.push({ id, dict, stream });
      const CATALOG = 1;
      const PAGES = 2;
      const INFO = 3;
      const RESOURCES = 4;

      const fontRefs = [];
      let index = 0;
      for (const slot of this.fonts.values()) {
        fontRefs.push(`/${slot.name} ${await this.writeFont(slot, index, alloc, put)} 0 R`);
        index += 1;
      }

      const imageRefs = [];
      for (const image of this.images) {
        let mask = '';
        if (image.alpha) {
          const maskId = alloc();
          const data = await deflate(image.alpha);
          put(maskId, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`, data);
          mask = ` /SMask ${maskId} 0 R`;
        }
        const id = alloc();
        const data = await deflate(image.rgb);
        put(id, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${mask} /Length ${data.length} >>`, data);
        imageRefs.push(`/${image.name} ${id} 0 R`);
      }

      const alphaRefs = [...this.alphas.values()].map((a) => `/${a.name} << /ca ${num(a.fill)} /CA ${num(a.stroke)} >>`);
      put(RESOURCES, `<< /ProcSet [/PDF /Text /ImageC]${fontRefs.length ? ` /Font << ${fontRefs.join(' ')} >>` : ''}${imageRefs.length ? ` /XObject << ${imageRefs.join(' ')} >>` : ''}${alphaRefs.length ? ` /ExtGState << ${alphaRefs.join(' ')} >>` : ''} >>`);

      const kids = [];
      for (const page of this.pages) {
        const contentId = alloc();
        const pageId = alloc();
        const data = await deflate(latin1(page.ops.join('\n')));
        put(contentId, `<< /Filter /FlateDecode /Length ${data.length} >>`, data);
        put(pageId, `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${num(page.width * PT_PER_MM)} ${num(page.height * PT_PER_MM)}] /Resources ${RESOURCES} 0 R /Contents ${contentId} 0 R >>`);
        kids.push(`${pageId} 0 R`);
      }
      put(PAGES, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`);
      put(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`);

      const now = new Date();
      const pad = (v) => String(v).padStart(2, '0');
      const stamp = `D:${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const infoParts = [`/Producer ${textString(this.info.producer || 'P&IDX')}`, `/CreationDate (${this.info.date || stamp})`];
      if (this.info.title) infoParts.unshift(`/Title ${textString(this.info.title)}`);
      put(INFO, `<< ${infoParts.join(' ')} >>`);

      return assemble(objects, next, CATALOG, INFO);
    }

    async writeFont(slot, index, alloc, put) {
      const { font, used } = slot;
      const { bytes } = font.subset([...used.keys()]);
      const file = await deflate(bytes);
      const fileId = alloc();
      put(fileId, `<< /Filter /FlateDecode /Length ${file.length} /Length1 ${bytes.length} >>`, file);

      const scale = 1000 / font.unitsPerEm;
      const tag = `PID${String.fromCharCode(65 + Math.floor(index / 26) % 26)}${String.fromCharCode(65 + index % 26)}A`;
      const base = `${tag}+${font.name}`;
      const descId = alloc();
      put(descId, `<< /Type /FontDescriptor /FontName /${base} /Flags 4 /FontBBox [${font.bbox.map((v) => Math.round(v * scale)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} /CapHeight ${Math.round(font.capHeight * scale)} /StemV ${font.weight >= 600 ? 120 : 80} /FontWeight ${font.weight} /FontFile2 ${fileId} 0 R >>`);

      // Genişlikler kesintisiz harf numarası öbekleri hâlinde yazılır
      const gids = [...used.keys()].sort((a, b) => a - b);
      const widths = [];
      for (let i = 0; i < gids.length; i += 1) {
        const start = gids[i];
        const run = [Math.round(font.widthEm(start) * 1000)];
        while (i + 1 < gids.length && gids[i + 1] === gids[i] + 1) {
          i += 1;
          run.push(Math.round(font.widthEm(gids[i]) * 1000));
        }
        widths.push(`${start} [${run.join(' ')}]`);
      }
      const cidId = alloc();
      put(cidId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${widths.join(' ')}] >>`);

      const lines = [];
      for (let i = 0; i < gids.length; i += 100) {
        const block = gids.slice(i, i + 100);
        lines.push(`${block.length} beginbfchar`);
        for (const g of block) lines.push(`<${hex4(g)}> <${utf16Hex(used.get(g))}>`);
        lines.push('endbfchar');
      }
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${lines.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const cmapData = await deflate(latin1(cmap));
      const cmapId = alloc();
      put(cmapId, `<< /Filter /FlateDecode /Length ${cmapData.length} >>`, cmapData);

      const fontId = alloc();
      put(fontId, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${cmapId} 0 R >>`);
      return fontId;
    }
  }

  function assemble(objects, size, catalog, info) {
    const chunks = [];
    let at = 0;
    const write = (data) => {
      const bytes = typeof data === 'string' ? latin1(data) : data;
      chunks.push(bytes);
      at += bytes.length;
    };
    write('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
    const offsets = new Map();
    for (const o of objects.slice().sort((a, b) => a.id - b.id)) {
      offsets.set(o.id, at);
      write(`${o.id} 0 obj\n${o.dict}\n`);
      if (o.stream) {
        write('stream\n');
        write(o.stream);
        write('\nendstream\n');
      }
      write('endobj\n');
    }
    const xref = at;
    write(`xref\n0 ${size}\n0000000000 65535 f \n`);
    for (let id = 1; id < size; id += 1) {
      write(offsets.has(id) ? `${String(offsets.get(id)).padStart(10, '0')} 00000 n \n` : '0000000000 00000 f \n');
    }
    write(`trailer\n<< /Size ${size} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return concat(chunks);
  }

  return {
    PT_PER_MM,
    Document,
    Page,
    TrueType,
    parsePath,
    arcToCubics,
    create: (info) => new Document(info)
  };
});

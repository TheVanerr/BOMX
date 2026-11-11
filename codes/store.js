/* BOMX veri katmanı: kütüphane, projeler, şablonlar ve ayarlar veritabanında JSON dosyalarıdır.
   Depoda programdaki gibi durur:
     BOM/kutuphane/k0.json … kf.json   komponent kütüphanesi (kimliğe göre 16 parça; bir değişiklik tek parçayı yazar)
     BOM/projeler/<proje>/proje.json   proje bilgileri ve malzeme listesi
     BOM/projeler/<proje>/revizyon/<rev>.json  revizyon yükseltilirken listenin o anki hâli (değişmez)
     BOM/sablonlar/<kimlik>.json       hazır setler
     BOM/ayarlar.json                  kategori, birim ve varsayılanlar
   db: BomxDb (read, write, remove, list). Tarayıcıya bağlı değildir; Node testleri aynı kodu çalıştırır. */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./model.js'));
  else root.BomxStore = factory(root.BomxModel);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const isConflict = (path) => /\.catisma-\d{8}-\d{6}$/.test(path);

  function createStore(db) {
    async function readJson(path) {
      const rec = await db.read(path);
      if (!rec || rec.kind !== 'file' || !rec.bytes || !rec.bytes.length) return null;
      return M.decodeJson(rec.bytes);
    }

    const writeJson = (path, obj) => db.write(path, M.encodeJson(obj));

    /* ── Kütüphane ── */

    async function loadLibrary() {
      const records = (await db.list()).filter((r) => r.kind === 'file' && M.isShardPath(r.path));
      const byId = new Map();
      const errors = [];
      for (const r of records) {
        try {
          for (const c of M.parseShard(r.bytes).komponentler) {
            const prev = byId.get(c.id);
            if (!prev || (c.zaman || '') > (prev.zaman || '')) byId.set(c.id, c);
          }
        } catch {
          errors.push(r.path);
        }
      }
      return { components: [...byId.values()].sort(M.compareComponents), errors };
    }

    async function readShard(shard) {
      const rec = await db.read(M.shardPath(shard));
      if (!rec || !rec.bytes || !rec.bytes.length) return { komponentler: [], silinen: {} };
      return M.parseShard(rec.bytes);
    }

    function groupByShard(items, idOf) {
      const map = new Map();
      for (const item of items) {
        const shard = M.shardOf(idOf(item));
        if (!map.has(shard)) map.set(shard, []);
        map.get(shard).push(item);
      }
      return map;
    }

    /**
     * Kütüphane yazımları sırayla yapılır: her yazım parçayı okuyup değiştirip yazar; üst üste binen iki yazım
     * (ör. yıldız ve geri al aynı anda) aynı parçanın eski hâlinden yola çıkıp birbirinin değişikliğini silmesin.
     */
    let libraryQueue = Promise.resolve();
    function serial(fn) {
      const run = libraryQueue.then(fn, fn);
      libraryQueue = run.catch(() => {});
      return run;
    }

    /** Yeni ya da değişen komponentler; her biri kendi parçasına yazılır. @returns kaydedilen hâller */
    function saveComponents(list, options) {
      return serial(() => writeComponents(list, options));
    }

    async function writeComponents(list, options) {
      const at = (options && options.at) || M.nowIso();
      const saved = [];
      for (const [shard, items] of groupByShard(list, (c) => c.id || '')) {
        const doc = await readShard(shard);
        const map = new Map(doc.komponentler.map((c) => [c.id, c]));
        for (const item of items) {
          const prev = item.id ? map.get(item.id) : null;
          const c = M.normalizeComponent(Object.assign({}, item, { zaman: M.laterStamp(at, prev && prev.zaman) }));
          map.set(c.id, c);
          delete doc.silinen[c.id];
          saved.push(c);
        }
        await writeJson(M.shardPath(shard), M.shardDocument([...map.values()], doc.silinen));
      }
      return saved;
    }

    /** Silinen komponentin kimliği parçada silinme zamanıyla kalır: öbür cihaz eski kopyayla geri getirmez */
    function deleteComponents(ids) {
      return serial(() => removeComponents(ids));
    }

    async function removeComponents(ids) {
      const at = M.nowIso();
      let count = 0;
      for (const [shard, list] of groupByShard(ids, (id) => id)) {
        const doc = await readShard(shard);
        const map = new Map(doc.komponentler.map((c) => [c.id, c]));
        for (const id of list) {
          const prev = map.get(id);
          if (map.delete(id)) count += 1;
          doc.silinen[id] = M.laterStamp(at, prev && prev.zaman);
        }
        await writeJson(M.shardPath(shard), M.shardDocument([...map.values()], doc.silinen));
      }
      return count;
    }

    /* ── Komponent fotoğrafları (BOM/fotograflar/f<ilk hex>.json) ── */

    /** @returns Map komponent kimliği → "data:image/…" */
    async function loadPhotos() {
      const records = (await db.list()).filter((r) => r.kind === 'file' && M.isPhotoShardPath(r.path));
      const byId = new Map();
      for (const r of records) {
        try {
          for (const p of M.parsePhotoShard(r.bytes).fotolar) {
            const prev = byId.get(p.id);
            if (!prev || (p.zaman || '') > (prev.zaman || '')) byId.set(p.id, p);
          }
        } catch { /* bozuk parça diğerlerini engellemez */ }
      }
      return new Map([...byId.values()].map((p) => [p.id, p.veri]));
    }

    async function readPhotoShard(shard) {
      const rec = await db.read(M.photoShardPath(shard));
      if (!rec || !rec.bytes || !rec.bytes.length) return { fotolar: [], silinen: {} };
      return M.parsePhotoShard(rec.bytes);
    }

    /**
     * Fotoğraf yazar ya da siler (veri boşsa silinir; kimlik silinme zamanıyla kalır).
     * @param list [{ id, veri }] @returns yazılan kayıt sayısı
     */
    function savePhotos(list) {
      return serial(async () => {
        const at = M.nowIso();
        let count = 0;
        for (const [shard, items] of groupByShard(list.filter((p) => p && p.id), (p) => p.id)) {
          const doc = await readPhotoShard(shard);
          const map = new Map(doc.fotolar.map((p) => [p.id, p]));
          for (const item of items) {
            const prev = map.get(item.id);
            const zaman = M.laterStamp(at, prev && prev.zaman);
            if (M.isPhotoData(item.veri)) {
              map.set(item.id, { id: item.id, veri: item.veri, zaman });
              delete doc.silinen[item.id];
              count += 1;
            } else if (prev || !doc.silinen[item.id]) {
              map.delete(item.id);
              doc.silinen[item.id] = zaman;
              count += 1;
            }
          }
          await writeJson(M.photoShardPath(shard), M.photoShardDocument([...map.values()], doc.silinen));
        }
        return count;
      });
    }

    /* ── Ayarlar ── */

    async function readSettings() {
      try {
        return M.normalizeSettings(await readJson(M.PATHS.settings));
      } catch {
        return M.normalizeSettings({});
      }
    }

    /** Veritabanındaki hâlle anahtar anahtar birleşir: eşitlemenin getirdiği ayar ezilmez. @returns yazılan ayarlar */
    async function saveSettings(settings) {
      let next = M.normalizeSettings(settings);
      try {
        const current = await readJson(M.PATHS.settings);
        if (current) next = M.mergeSettings(current, next);
      } catch { /* bozuk dosya: bu sürüm yazılır */ }
      await writeJson(M.PATHS.settings, next);
      return next;
    }

    /* ── Projeler ── */

    function folderOf(path) {
      return path.split('/')[2];
    }

    function summary(project, path) {
      const p = project;
      const used = new Set();
      for (const l of p.kalemler) if (l.komponentId) used.add(l.komponentId);
      return {
        id: folderOf(path),
        seriNo: p.seriNo,
        musteri: p.musteri,
        model: p.model,
        baslik: p.baslik,
        durum: p.durum,
        rev: p.rev,
        tarih: p.tarih,
        firma: p.firma,
        bolumSayisi: p.bolumler.length,
        kalemSayisi: p.kalemler.length,
        totals: M.projectTotals(p),
        komponentler: [...used],
        kodlar: [...new Set(p.kalemler.map((l) => M.codeKey(l.kod)).filter(Boolean))],
        guncelleme: p.guncelleme
      };
    }

    async function listProjects() {
      const records = (await db.list()).filter((r) => r.kind === 'file' && M.isProjectPath(r.path));
      const projects = [];
      const errors = [];
      for (const r of records) {
        try {
          const p = M.normalizeProject(M.decodeJson(r.bytes));
          projects.push(summary(p, r.path));
        } catch {
          errors.push(folderOf(r.path));
        }
      }
      projects.sort((a, b) => String(b.guncelleme).localeCompare(String(a.guncelleme)));
      return { projects, errors };
    }

    async function readProject(id) {
      const raw = await readJson(M.projectPath(id));
      if (!raw) return null;
      const p = M.normalizeProject(raw);
      p.id = id;
      return p;
    }

    /** Aynı ad (harf büyüklüğü farklı da olsa) iki projede olamaz: klasörler Windows'ta karışır */
    async function findProjectId(id) {
      const key = M.fold(id);
      const records = (await db.list()).filter((r) => r.kind === 'file' && M.isProjectPath(r.path));
      const hit = records.find((r) => M.fold(folderOf(r.path)) === key);
      return hit ? folderOf(hit.path) : null;
    }

    async function createProject(input, settings, seed) {
      const project = M.createProject(input, settings);
      if (!project.id) throw new Error('Seri no, müşteri ve model gerekli');
      const existing = await findProjectId(project.id);
      if (existing) throw new Error(`"${existing}" adında bir proje zaten var`);
      if (seed && Array.isArray(seed.bolumler) && seed.bolumler.length) {
        // Kopyadan ya da şablondan başlayan proje: bölümler ve kalemler yeni kimlikle gelir
        const ids = new Map();
        project.bolumler = seed.bolumler.map((s) => {
          const id = M.uid();
          ids.set(s.id, id);
          return M.normalizeSection({ id, ad: s.ad, zaman: project.guncelleme });
        });
        project.kalemler = (seed.kalemler || []).map((l) => M.normalizeLine(Object.assign({}, l, {
          id: M.uid(),
          bolum: ids.get(l.bolum) || project.bolumler[0].id,
          zaman: project.guncelleme
        })));
        // Kopyada belge ayarları da gelir (notlar, antet, dil, PDF seçenekleri); kimlik, durum ve revizyon gelmez
        for (const key of ['notlar', 'firma', 'dil', 'cikti']) {
          if (seed[key] !== undefined && (input || {})[key] === undefined) project[key] = M.clone(seed[key]);
        }
      }
      await writeJson(M.projectPath(project.id), M.projectDocument(project));
      return project;
    }

    /**
     * Yazmadan önce veritabanındaki hâlle kayıt kayıt birleşir. Eşitleme başka cihazın değişikliğini
     * veritabanına almışsa, düzenleyicideki (henüz o değişikliği görmemiş) hâl onu ezmez.
     * @returns { savedAt, project: yazılan (birleşmiş) hâl }
     */
    async function saveProject(project) {
      if (!project || !project.id) throw new Error('Proje adı yok');
      const path = M.projectPath(project.id);
      let doc = M.projectDocument(project);
      try {
        const current = await readJson(path);
        if (current) {
          doc = M.projectDocument(M.mergeProjects(current, doc));
          doc.id = project.id;
        }
      } catch { /* bozuk dosya: bu sürüm yazılır */ }
      await writeJson(path, doc);
      return { savedAt: Date.now(), project: doc };
    }

    async function deleteProject(id) {
      if (!id || /[\\/]/.test(id)) throw new Error('Geçersiz proje adı');
      return db.remove(`${M.PATHS.projects}/${id}`);
    }

    /**
     * Proje adı (klasörü) seri no, müşteri ve modelden oluşur; değişince klasör taşınır.
     * Önce yeni yere yazılır, sonra eskisi silinir: yarıda kalırsa asıl proje yerinde durur.
     */
    async function renameProject(oldId, project) {
      const id = M.projectId(project.seriNo, project.musteri, project.model);
      if (!id) throw new Error('Seri no, müşteri ve model dolu olmalı');
      if (id === oldId) {
        await saveProject(Object.assign({}, project, { id }));
        return id;
      }
      const existing = await findProjectId(id);
      if (existing && existing !== oldId) throw new Error(`"${existing}" adında bir proje zaten var`);
      const from = `${M.PATHS.projects}/${oldId}/`;
      const to = `${M.PATHS.projects}/${id}/`;
      const files = (await db.list()).filter((r) => r.kind === 'file' && r.path.startsWith(from) && !M.isProjectPath(r.path));
      for (const f of files) await db.write(to + f.path.slice(from.length), f.bytes);
      await saveProject(Object.assign({}, project, { id }));
      // Harf büyüklüğü değişen adda eski yol yenisiyle aynı klasör sayılabilir: yalnız gerçekten farklıysa silinir
      if (from !== to) await db.remove(`${M.PATHS.projects}/${oldId}`);
      return id;
    }

    /* ── Revizyon anlık görüntüleri ── */

    async function saveRevision(id, project) {
      const p = M.normalizeProject(project);
      await writeJson(M.revisionPath(id, p.rev), {
        format: 'bomx-revizyon',
        surum: M.SCHEMA,
        rev: p.rev,
        tarih: p.tarih,
        kaydedildi: M.nowIso(),
        bolumler: p.bolumler.map((s) => ({ id: s.id, ad: s.ad })),
        kalemler: p.kalemler.map((l) => {
          const copy = Object.assign({}, l);
          delete copy.zaman;
          return copy;
        })
      });
    }

    async function readRevision(id, rev) {
      const doc = await readJson(M.revisionPath(id, rev));
      if (!doc) return null;
      return { rev: doc.rev, tarih: doc.tarih, bolumler: doc.bolumler || [], kalemler: (doc.kalemler || []).map(M.normalizeLine) };
    }

    async function listRevisions(id) {
      const prefix = `${M.PATHS.projects}/${id}/revizyon/`;
      return (await db.list())
        .filter((r) => r.kind === 'file' && r.path.startsWith(prefix) && r.path.endsWith('.json'))
        .map((r) => r.path.slice(prefix.length, -'.json'.length))
        .sort((a, b) => M.revNumber(a) - M.revNumber(b));
    }

    async function deleteRevision(id, rev) {
      return db.remove(M.revisionPath(id, rev));
    }

    /* ── Şablonlar ── */

    async function listTemplates() {
      const records = (await db.list()).filter((r) => r.kind === 'file' && M.isTemplatePath(r.path));
      const out = [];
      const errors = [];
      for (const r of records) {
        try {
          const t = M.normalizeTemplate(M.decodeJson(r.bytes));
          t.id = r.path.split('/').pop().replace(/\.json$/, '');
          out.push(t);
        } catch {
          errors.push(r.path);
        }
      }
      return { templates: out.sort((a, b) => M.compareText(a.ad, b.ad)), errors };
    }

    async function saveTemplate(template) {
      const t = M.normalizeTemplate(Object.assign({}, template, { guncelleme: M.nowIso() }));
      if (!/^[A-Za-z0-9_-]+$/.test(t.id)) t.id = M.uid();
      await writeJson(M.templatePath(t.id), t);
      return t;
    }

    const deleteTemplate = (id) => db.remove(M.templatePath(id));

    /* ── Bakım ── */

    async function listConflicts() {
      return (await db.list()).filter((r) => r.kind === 'file' && isConflict(r.path)).map((r) => ({ path: r.path, at: r.at, bytes: r.bytes }));
    }

    async function stats() {
      const rows = await db.list();
      return {
        files: rows.filter((r) => r.kind === 'file').length,
        bytes: rows.reduce((n, r) => n + (r.bytes ? r.bytes.length : 0), 0)
      };
    }

    /** Depoda yalnız README varsa ya da hiç dosya yoksa veri yok sayılır */
    async function isEmpty() {
      return !(await db.list()).some((r) => r.path.startsWith(`${M.PATHS.library}/`) || r.path.startsWith(`${M.PATHS.projects}/`) || r.path.startsWith(`${M.PATHS.templates}/`));
    }

    return {
      db,
      loadLibrary,
      saveComponents,
      deleteComponents,
      loadPhotos,
      savePhotos,
      readSettings,
      saveSettings,
      listProjects,
      readProject,
      findProjectId,
      createProject,
      saveProject,
      deleteProject,
      renameProject,
      saveRevision,
      readRevision,
      listRevisions,
      deleteRevision,
      listTemplates,
      saveTemplate,
      deleteTemplate,
      listConflicts,
      removeFile: (path) => db.remove(path),
      stats,
      isEmpty,
      readJson
    };
  }

  return { createStore, isConflict };
});

/* Ana ekran: projeler, komponent kütüphanesi (BomxLibrary), şablonlar, ayarlar ve veritabanı sekmeleri;
   yeni proje, çoğaltma ve silme pencereleri. */

const BomxHome = (() => {
  const M = BomxModel;
  const U = BomxUi;
  const { esc } = U;
  const app = () => BomxApp;

  const H = { tab: 'projects', query: '', status: '', sort: U.pref('projeSira', 'recent'), templateId: null, templateDraft: null, templateQuery: '' };
  const TABS = { projects: 'homeProjects', library: 'homeLibrary', templates: 'homeTemplates', settings: 'homeSettings', db: 'homeDb' };

  function show(tab) {
    H.tab = TABS[tab] ? tab : 'projects';
    U.setPref('sekme', H.tab);
    document.querySelectorAll('.home-tab').forEach((b) => b.classList.toggle('active', b.dataset.homeTab === H.tab));
    for (const [key, id] of Object.entries(TABS)) U.$(id).classList.toggle('hidden', key !== H.tab);
    U.$('btnNewProject').classList.toggle('hidden', H.tab !== 'projects');
    updateCounts();
    if (H.tab === 'projects') renderProjects();
    else if (H.tab === 'library') BomxLibrary.render();
    else if (H.tab === 'templates') renderTemplates();
    else if (H.tab === 'settings') renderSettings();
    else if (H.tab === 'db') renderDb();
    renderBanner();
  }

  function updateCounts() {
    const st = app().state;
    U.$('cntProjects').textContent = st.projects.length || '';
    U.$('cntLibrary').textContent = st.library.length || '';
    U.$('cntTemplates').textContent = st.templates.length || '';
    U.$('cntDb').textContent = st.conflicts.length ? '!' : '';
  }

  /** Yerel modda ve anahtar sorununda üstte kalıcı uyarı */
  function renderBanner() {
    const box = U.$('homeBanner');
    const s = BomxBoot.settings();
    const st = app().state.status || {};
    const expires = s.tokenExpires;
    const days = expires ? Math.ceil((expires - Date.now()) / 86400000) : null;
    let html = '';
    let cls = '';
    if (s.mode === 'yerel') {
      html = '<span><b>Yerel mod:</b> veriler yalnız bu tarayıcıda. Başka bilgisayardan erişmek ve geçmişi tutmak için GitHub deposuna bağlanın; buradaki her şey depoya gönderilir.</span><button type="button" class="btn btn-sm btn-primary" data-banner="connect">GitHub deposuna bağla</button>';
    } else if (st.state === 'error' && st.auth) {
      cls = 'err';
      html = `<span><b>GitHub anahtarı geçersiz ya da süresi dolmuş.</b> ${esc(st.pending || 0)} dosya bu bilgisayarda bekliyor; kaybolmadı.</span><button type="button" class="btn btn-sm btn-primary" data-banner="token">Anahtarı yenile</button>`;
    } else if (days !== null && days <= 21) {
      cls = days <= 3 ? 'err' : '';
      html = `<span><b>GitHub anahtarının süresi ${days <= 0 ? 'doldu' : `${days} gün içinde doluyor`}</b> (${esc(new Date(expires).toLocaleDateString('tr-TR'))}). Yeni anahtar oluşturup girin.</span><button type="button" class="btn btn-sm" data-banner="token">Anahtarı yenile</button>`;
    }
    box.innerHTML = html;
    box.className = `home-banner ${cls}${html ? '' : ' hidden'}`;
  }

  /* ─── Durum yazısı ────────────────────────────────────── */

  function statusInfo() {
    const s = BomxBoot.settings();
    const st = app().state.status || {};
    if (s.mode !== 'github') return { text: 'Yerel mod · yalnız bu tarayıcıda', cls: 'local warn' };
    if (st.state === 'syncing') return { text: 'Eşitleniyor…', cls: 'syncing' };
    if (st.state === 'error') return { text: st.auth ? 'Anahtar geçersiz · kayıtlar bu cihazda' : `Gönderilemedi · ${st.pending || 0} dosya bekliyor`, cls: 'err', title: st.error };
    if (st.state === 'offline') return { text: `Çevrimdışı · ${st.pending || 0} dosya bekliyor`, cls: 'warn', title: st.error };
    if (st.pending) return { text: `${st.pending} dosya gönderilecek`, cls: 'pending' };
    return { text: `Depoda kayıtlı${st.lastSync ? ` · ${new Date(st.lastSync).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}`, cls: '' };
  }

  function renderStatus() {
    const info = statusInfo();
    for (const id of ['homeStatus', 'appStatus']) {
      const el = U.$(id);
      if (!el) continue;
      el.className = `db-chip ${info.cls}`;
      el.title = `${BomxBoot.settings().repo || 'Yerel veritabanı'}${info.title ? `\n${info.title}` : ''}\nTıklayın: veritabanı ve eşitleme`;
      el.innerHTML = `<span class="dot"></span><span>${esc(info.text)}</span>`;
    }
    if (H.tab === 'db' && !U.$('home').classList.contains('hidden')) renderDbStatus();
    renderBanner();
  }

  /* ─── Projeler ────────────────────────────────────────── */

  function filteredProjects() {
    const tokens = M.fold(H.query).split(/\s+/).filter(Boolean);
    let list = app().state.projects.filter((p) => {
      if (H.status && p.durum !== H.status) return false;
      if (!tokens.length) return true;
      const text = M.fold(`${p.id} ${p.baslik}`);
      return tokens.every((t) => text.includes(t));
    });
    const sorters = {
      recent: (a, b) => String(b.guncelleme).localeCompare(String(a.guncelleme)),
      seri: (a, b) => M.compareText(a.seriNo, b.seriNo),
      musteri: (a, b) => M.compareText(a.musteri, b.musteri) || M.compareText(a.seriNo, b.seriNo),
      total: (a, b) => (b.totals.partial || 0) - (a.totals.partial || 0)
    };
    list = list.slice().sort(sorters[H.sort] || sorters.recent);
    return list;
  }

  function renderProjects() {
    const box = U.$('projectGrid');
    const st = app().state;
    U.$('pjStatus').innerHTML = `<option value="">Tüm durumlar</option>${M.STATUSES.map((s) => `<option value="${s.id}"${H.status === s.id ? ' selected' : ''}>${esc(s.label)} (${st.projects.filter((p) => p.durum === s.id).length})</option>`).join('')}`;
    U.$('pjSort').value = H.sort;
    if (!st.projects.length) {
      box.innerHTML = `<div class="home-empty"><strong>Henüz proje yok</strong>
        Projeyi <b>+ Yeni Proje</b> ile açın (seri no, müşteri, model). Malzeme listesini soldaki komponent kütüphanesinden seçerek kurarsınız.
        ${!st.library.length ? '<br>Önce <b>Komponentler</b> sekmesinden genel komponent listenizi oluşturun ya da CSV / Excel ile içe aktarın.' : ''}
        <br><button type="button" class="btn btn-primary" data-act="new">+ Yeni Proje</button>${!st.library.length ? ' <button type="button" class="btn" data-act="library">Komponentler</button>' : ''}</div>`;
      return;
    }
    const list = filteredProjects();
    if (!list.length) {
      box.innerHTML = '<div class="home-empty">Aramaya uyan proje yok.</div>';
      return;
    }
    box.innerHTML = list.map((p) => {
      const status = M.STATUSES.find((s) => s.id === p.durum) || M.STATUSES[0];
      const total = U.totalText(p.totals);
      return `<div class="project-card" role="button" tabindex="0" data-id="${esc(p.id)}">
        <div class="pc-head"><div class="pc-no">${esc(p.seriNo)}</div><button type="button" class="pc-menu" data-menu="${esc(p.id)}" title="İşlemler">⋯</button></div>
        <div class="pc-model">${esc(p.model)}</div>
        <div class="pc-customer">${esc(p.musteri)}</div>
        ${p.baslik ? `<div class="pc-title">${esc(p.baslik)}</div>` : ''}
        <div class="pc-chips">
          <span class="pc-chip st-${status.id}">${esc(status.label)}</span>
          <span class="pc-chip dark">Rev. ${esc(p.rev)}</span>
          <span class="pc-chip${p.kalemSayisi ? ' has' : ''}">${p.kalemSayisi} kalem</span>
          ${p.bolumSayisi > 1 ? `<span class="pc-chip">${p.bolumSayisi} bölüm</span>` : ''}
          ${p.totals.missingPrice ? `<span class="pc-chip">${p.totals.missingPrice} fiyatsız</span>` : ''}
        </div>
        <div class="pc-total">${total ? esc(total) : '—'}${p.totals.missingRates.length ? '<small>kur eksik</small>' : ''}</div>
        <div class="pc-meta">${esc(U.formatDate(p.tarih))} · güncelleme ${esc(U.relTime(p.guncelleme))}</div>
      </div>`;
    }).join('');
  }

  function projectMenu(id, x, y) {
    U.contextMenu(x, y, [
      { title: id },
      { label: 'Aç', run: () => app().openProject(id) },
      { label: 'Excel indir', run: async () => BomxOutput.exportExcel({ project: await app().store.readProject(id) }) },
      { label: 'CSV indir', run: async () => BomxOutput.exportCsv({ project: await app().store.readProject(id) }) },
      { label: 'Çoğalt…', run: () => duplicateProjectDialog(id) },
      '-',
      { label: 'Sil…', danger: true, run: () => deleteProjectDialog(id) }
    ]);
  }

  /** Yeni proje: boş, şablondan, başka projenin kopyası ya da P&PX makine kaydından */
  async function newProjectDialog(preset) {
    const st = app().state;
    const pre = preset || {};
    const ppx = st.ppx || (await app().loadPpx());
    const machines = ppx ? ppx.machines : [];
    const sections = st.settings.varsayilanBolumler.join(', ');
    const m = U.modal(`
      <h2>Yeni Proje <button type="button" class="icon-btn sm x" data-close>×</button></h2>
      ${machines.length ? `<div class="field"><label for="npMachine">P&amp;PX makine kaydı (isteğe bağlı)</label><select id="npMachine" class="field-input"><option value="">Kayıt seçilmedi</option>${machines.map((x) => `<option value="${esc(x.id)}">${esc(x.seriNo)} · ${esc(x.firma)} · ${esc(x.model)} (${x.kodlar.length} kod)</option>`).join('')}</select><p class="field-help">Seçilirse seri no, müşteri ve model gelir; makinedeki kodlar kütüphanede varsa listeye eklenir.</p></div>` : ''}
      <div class="field-row three">
        <div class="field"><label for="npSeri">Seri no <span class="req">*</span></label><input id="npSeri" class="field-input" placeholder="0626051" value="${esc(pre.seriNo || '')}" autocomplete="off"></div>
        <div class="field"><label for="npMusteri">Müşteri <span class="req">*</span></label><input id="npMusteri" class="field-input" placeholder="DÜNYA" value="${esc(pre.musteri || '')}" autocomplete="off"></div>
        <div class="field"><label for="npModel">Model <span class="req">*</span></label><input id="npModel" class="field-input" placeholder="ULT M200 3B" value="${esc(pre.model || '')}" autocomplete="off"></div>
      </div>
      <p class="field-help" id="npId"></p>
      <div class="field"><label for="npBaslik">Açıklama</label><input id="npBaslik" class="field-input" placeholder="Örn: 3 tanklı ultrasonik yıkama makinesi" autocomplete="off"></div>
      <div class="field"><label>Başlangıç</label>
        <div class="radio-list" id="npStart">
          <label class="on"><input type="radio" name="npStart" value="empty" checked><span>Boş liste<small>Bölümler: <input id="npSections" class="field-input" value="${esc(sections)}" style="margin-top:4px" title="Virgülle ayırın"></small></span></label>
          <label><input type="radio" name="npStart" value="template" ${st.templates.length ? '' : 'disabled'}><span>Şablondan${st.templates.length ? '' : ' (şablon yok)'}<small><select id="npTemplate" class="field-input" style="margin-top:4px" ${st.templates.length ? '' : 'disabled'}>${st.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.ad)} (${t.kalemler.length} kalem)</option>`).join('')}</select></small></span></label>
          <label><input type="radio" name="npStart" value="copy" ${st.projects.length ? '' : 'disabled'}><span>Başka projenin kopyası${st.projects.length ? '' : ' (proje yok)'}<small><select id="npCopy" class="field-input" style="margin-top:4px" ${st.projects.length ? '' : 'disabled'}>${st.projects.map((p) => `<option value="${esc(p.id)}"${pre.copyFrom === p.id ? ' selected' : ''}>${esc(p.id)} (${p.kalemSayisi} kalem)</option>`).join('')}</select>Bölümler ve kalemler kopyalanır; kaynak proje değişmez, revizyon geçmişi gelmez.</small></span></label>
        </div>
      </div>
      <div class="field-error" id="npError"></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>İptal</button><button type="submit" class="btn btn-primary">Oluştur</button></div>`, {
      size: 'wide',
      onSubmit: async (e, entry) => {
        const v = (id) => entry.el.querySelector(`#${id}`).value;
        const err = (t) => { entry.el.querySelector('#npError').textContent = t; };
        const input = { seriNo: v('npSeri'), musteri: v('npMusteri'), model: v('npModel'), baslik: v('npBaslik') };
        if (!M.projectId(input.seriNo, input.musteri, input.model)) return err('Seri no, müşteri ve model gerekli');
        const start = entry.el.querySelector('input[name=npStart]:checked').value;
        let seed = null;
        if (start === 'empty') {
          input.bolumler = v('npSections').split(',').map((s) => M.clean(s)).filter(Boolean);
        } else if (start === 'template') {
          const t = st.templates.find((x) => x.id === v('npTemplate'));
          if (!t) return err('Şablon seçin');
          const secId = 'sablon';
          seed = { bolumler: [{ id: secId, ad: t.ad }], kalemler: M.linesFromTemplate(t, st.libraryById, secId) };
        } else if (start === 'copy') {
          seed = await app().store.readProject(v('npCopy'));
          if (!seed) return err('Kaynak proje okunamadı');
        }
        const machineId = entry.el.querySelector('#npMachine') ? v('npMachine') : '';
        const machine = machines.find((x) => x.id === machineId);
        let fromMachine = null;
        if (machine) {
          const byKey = new Map(st.library.map((c) => [M.codeKey(c.kod), c]));
          const found = machine.kodlar.map((k) => byKey.get(M.codeKey(k))).filter(Boolean);
          fromMachine = { found, missing: machine.kodlar.filter((k) => !byKey.has(M.codeKey(k))) };
        }
        try {
          const project = await app().createProject(input, seed);
          entry.close();
          if (fromMachine && fromMachine.found.length) {
            const sec = project.bolumler[0].id;
            project.kalemler.push(...fromMachine.found.map((c) => Object.assign(M.lineFromComponent(c, 1, sec), { referans: c.kod })));
            M.stampChanges(await app().store.readProject(project.id), project);
            await app().store.saveProject(project);
          }
          await app().openProject(project.id);
          if (fromMachine) {
            U.toast(`Makine kaydından ${fromMachine.found.length} kod listeye eklendi${fromMachine.missing.length ? `; kütüphanede olmayan ${fromMachine.missing.length} kod eklenmedi (${fromMachine.missing.slice(0, 8).join(', ')}${fromMachine.missing.length > 8 ? '…' : ''})` : ''}`, fromMachine.missing.length ? 'warn' : '', { ms: 9000 });
          } else if (seed) {
            U.toast(`${project.id} oluşturuldu: ${project.kalemler.length} kalemle başladı`);
          }
        } catch (ex) {
          err(ex.message);
        }
        return undefined;
      }
    });
    const el = m.el;
    const updateId = () => {
      const id = M.projectId(el.querySelector('#npSeri').value, el.querySelector('#npMusteri').value, el.querySelector('#npModel').value);
      el.querySelector('#npId').innerHTML = id ? `Proje adı: <b>${esc(id)}</b> · depoda <code>BOM/projeler/${esc(id)}/</code>` : 'Proje adı seri no-müşteri-model biçiminde olur (P&amp;PX ile aynı).';
    };
    ['npSeri', 'npMusteri', 'npModel'].forEach((id) => el.querySelector(`#${id}`).addEventListener('input', updateId));
    el.querySelector('#npStart').addEventListener('change', () => {
      el.querySelectorAll('#npStart label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    });
    el.querySelectorAll('#npStart select, #npStart input:not([type=radio])').forEach((x) => x.addEventListener('focus', () => {
      const radio = x.closest('label').querySelector('input[type=radio]');
      if (!radio.disabled) {
        radio.checked = true;
        el.querySelector('#npStart').dispatchEvent(new Event('change'));
      }
    }));
    if (pre.copyFrom) {
      el.querySelector('input[name=npStart][value=copy]').checked = true;
      el.querySelector('#npStart').dispatchEvent(new Event('change'));
    }
    const machineSel = el.querySelector('#npMachine');
    if (machineSel) {
      machineSel.addEventListener('change', () => {
        const x = machines.find((mm) => mm.id === machineSel.value);
        if (!x) return;
        el.querySelector('#npSeri').value = x.seriNo;
        el.querySelector('#npMusteri').value = x.firma;
        el.querySelector('#npModel').value = x.model;
        updateId();
      });
    }
    updateId();
    setTimeout(() => el.querySelector('#npSeri').focus(), 0);
  }

  async function duplicateProjectDialog(id) {
    const src = await app().store.readProject(id);
    if (!src) return;
    newProjectDialog({ seriNo: '', musteri: src.musteri, model: src.model, copyFrom: id });
  }

  async function deleteProjectDialog(id) {
    const p = app().state.projects.find((x) => x.id === id);
    const ok = await U.confirmModal('Projeyi sil', `"${id}" projesi ve revizyon dosyaları silinsin mi?${p ? ` (${p.kalemSayisi} kalem)` : ''}`, 'Sil', {
      danger: true,
      detail: BomxBoot.settings().mode === 'github' ? 'Silinen proje GitHub deposunun geçmişinden geri alınabilir.' : 'Yerel modda silinen proje geri alınamaz; önce yedek indirmeniz önerilir.'
    });
    if (!ok) return;
    if (BomxEditor.currentId() === id) await app().showHome('projects');
    await app().deleteProject(id);
    U.toast(`${id} silindi`);
  }

  /* ─── Şablonlar ───────────────────────────────────────── */

  function renderTemplates() {
    renderTemplateList();
    renderTemplateEditor();
  }

  function renderTemplateList() {
    const st = app().state;
    const list = U.$('tpList');
    const tokens = M.fold(H.templateQuery).split(/\s+/).filter(Boolean);
    const items = st.templates.filter((t) => tokens.every((tk) => M.fold(`${t.ad} ${t.aciklama}`).includes(tk)));
    list.innerHTML = items.length ? items.map((t) => `<li><button type="button" class="side-item${H.templateId === t.id ? ' active' : ''}" data-id="${esc(t.id)}"><strong>${esc(t.ad)}</strong><span class="count">${t.kalemler.length} kalem</span><span class="meta">${esc(t.aciklama || U.relTime(t.guncelleme))}</span></button></li>`).join('')
      : `<li class="lp-empty">${st.templates.length ? 'Aramaya uyan şablon yok' : 'Henüz şablon yok'}</li>`;
  }

  function renderTemplateEditor() {
    const box = U.$('tpEditor');
    const t = H.templateDraft;
    if (!t) {
      box.innerHTML = `<div class="empty-state"><strong>Şablonlar (hazır setler)</strong>Sık kullanılan komponent gruplarını şablon yapın (pompa grubu, pano standart malzemeleri, pnömatik set…). Projede tek tıkla bölüme ya da yeni bölüm olarak eklenir; miktarlar ve referanslar gelir, fiyatlar kütüphanedeki güncel hâlinden alınır.<br><br>Şablon, düzenleyicide kalemleri seçip <b>Seçilenlerden şablon</b> ile ya da buradan <b>+ Yeni şablon</b> ile oluşturulur.</div>`;
      return;
    }
    const library = app().state.libraryById;
    const total = M.summarize(M.linesFromTemplate(t, library, 'x'), app().settings.raporParaBirimi, app().settings.kurlar);
    box.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>${t.id && app().state.templates.some((x) => x.id === t.id) ? 'Şablonu düzenle' : 'Yeni şablon'}</h2>
          <div class="card-actions">
            ${app().state.templates.some((x) => x.id === t.id) ? '<button type="button" class="btn btn-sm" id="tpDup">Çoğalt</button><button type="button" class="btn btn-sm btn-danger" id="tpDel">Sil</button>' : ''}
            <button type="button" class="btn btn-sm btn-primary" id="tpSave">Kaydet</button>
          </div></div>
        <div class="field-row"><div class="field"><label for="tpName">Şablon adı</label><input id="tpName" class="field-input" value="${esc(t.ad)}"></div>
        <div class="field"><label for="tpDesc">Açıklama</label><input id="tpDesc" class="field-input" value="${esc(t.aciklama)}" placeholder="Hangi makinelerde, ne için"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Kalemler (${t.kalemler.length})${total.converted ? ` · ${esc(M.formatMoney(total.converted, total.currency))}` : ''}</h3></div>
        <div class="suggest-wrap"><input type="search" id="tpAdd" class="search" placeholder="Komponent ekle: kod ya da ad yazın, Enter" autocomplete="off"><div class="suggest hidden" id="tpSuggest"></div></div>
        <div style="overflow:auto;margin-top:10px">
        <table class="mini-table"><thead><tr><th>Kod</th><th>Ad</th><th class="num" style="width:90px">Miktar</th><th>Birim</th><th style="width:160px">Referans</th><th style="width:200px">Not</th><th></th></tr></thead><tbody>
          ${t.kalemler.map((l, i) => {
            const c = l.komponentId ? library.get(l.komponentId) : null;
            return `<tr data-i="${i}"><td><b>${esc(l.kod)}</b>${!l.komponentId ? ' <span class="chip amber">serbest</span>' : !c ? ' <span class="chip gray">silinmiş</span>' : ''}</td><td>${esc(c ? c.ad : l.ad)}</td>
            <td><input class="field-input num" data-tf="miktar" value="${esc(M.formatQty(l.miktar))}" style="text-align:right"></td><td>${esc(l.birim)}</td>
            <td><input class="field-input" data-tf="referans" value="${esc(l.referans)}"></td><td><input class="field-input" data-tf="not" value="${esc(l.not)}"></td>
            <td><button type="button" class="icon-btn sm" data-tdel="${i}" title="Çıkar">×</button></td></tr>`;
          }).join('') || '<tr><td colspan="7" class="dk-empty">Kalem yok: yukarıdan komponent ekleyin.</td></tr>'}
        </tbody></table></div>
      </div>`;
    bindTemplateEditor();
  }

  function bindTemplateEditor() {
    const t = H.templateDraft;
    // Ad ve açıklama taslağa yazılır: kalem ekleme ya da arama ekranı yeniden kurunca kaybolmaz
    U.$('tpName').addEventListener('input', (e) => { t.ad = e.target.value; });
    U.$('tpDesc').addEventListener('input', (e) => { t.aciklama = e.target.value; });
    const add = U.$('tpAdd');
    const sug = U.$('tpSuggest');
    let cursor = 0;
    let results = [];
    const showSuggest = () => {
      const q = add.value.trim();
      if (!q) {
        sug.classList.add('hidden');
        return;
      }
      results = M.searchComponents(app().state.library, q, app().state.libraryIndex).slice(0, 30);
      cursor = 0;
      sug.innerHTML = results.map((c, i) => `<div class="suggest-row${i === cursor ? ' active' : ''}" data-id="${esc(c.id)}"><strong>${U.highlight(c.kod, q)}</strong><span>${U.highlight(c.ad, q)}</span><em>${esc(c.birim)}</em></div>`).join('') || '<div class="suggest-row"><span>Bulunamadı</span></div>';
      sug.classList.remove('hidden');
    };
    const pick = (c) => {
      if (!c) return;
      const existing = t.kalemler.find((l) => l.komponentId === c.id);
      if (existing) existing.miktar = M.round(existing.miktar + 1, 6);
      else t.kalemler.push(Object.assign(M.lineFromComponent(c, 1, ''), { bolum: undefined }));
      t.ad = U.$('tpName').value;
      t.aciklama = U.$('tpDesc').value;
      renderTemplateEditor();
      U.$('tpAdd').focus();
    };
    add.addEventListener('input', showSuggest);
    add.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cursor = Math.max(0, Math.min(results.length - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)));
        sug.querySelectorAll('.suggest-row').forEach((r, i) => r.classList.toggle('active', i === cursor));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(results[cursor]);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        add.value = '';
        sug.classList.add('hidden');
      }
    });
    sug.addEventListener('mousedown', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) {
        e.preventDefault();
        pick(app().state.libraryById.get(row.dataset.id));
      }
    });
    add.addEventListener('blur', () => setTimeout(() => sug.classList.add('hidden'), 150));
    U.$('tpEditor').querySelectorAll('[data-tf]').forEach((input) => input.addEventListener('change', () => {
      const i = Number(input.closest('tr').dataset.i);
      const f = input.dataset.tf;
      if (f === 'miktar') {
        const n = M.parseNumber(input.value);
        if (!(n > 0)) {
          U.toast('Miktar sıfırdan büyük olmalı', 'error');
          input.value = M.formatQty(t.kalemler[i].miktar);
          return;
        }
        t.kalemler[i].miktar = n;
      } else {
        t.kalemler[i][f] = input.value.trim();
      }
    }));
    U.$('tpEditor').querySelectorAll('[data-tdel]').forEach((b) => b.addEventListener('click', () => {
      t.kalemler.splice(Number(b.dataset.tdel), 1);
      t.ad = U.$('tpName').value;
      t.aciklama = U.$('tpDesc').value;
      renderTemplateEditor();
    }));
    U.$('tpSave').addEventListener('click', async () => {
      t.ad = U.$('tpName').value.trim();
      t.aciklama = U.$('tpDesc').value.trim();
      if (!t.ad) {
        U.toast('Şablon adı gerekli', 'error');
        return;
      }
      const saved = await app().saveTemplate(t);
      H.templateId = saved.id;
      H.templateDraft = M.clone(saved);
      renderTemplates();
      U.toast(`"${saved.ad}" kaydedildi`);
    });
    if (U.$('tpDel')) {
      U.$('tpDel').addEventListener('click', async () => {
        if (!(await U.confirmModal('Şablonu sil', `"${t.ad}" şablonu silinsin mi? Bu şablondan eklenmiş projeler değişmez.`, 'Sil', { danger: true }))) return;
        await app().deleteTemplate(t.id);
        H.templateId = null;
        H.templateDraft = null;
        renderTemplates();
      });
      U.$('tpDup').addEventListener('click', () => {
        H.templateDraft = Object.assign(M.clone(t), { id: M.uid(), ad: `${t.ad} (kopya)` });
        H.templateId = null;
        renderTemplates();
      });
    }
  }

  /* ─── Ayarlar ─────────────────────────────────────────── */

  function renderSettings() {
    const s = app().settings;
    const lines = (list) => esc(list.join('\n'));
    const foreign = s.paraBirimleri.filter((c) => c !== 'TRY');
    U.$('settingsBody').innerHTML = `<div class="page-grid">
      <div class="card">
        <div class="card-head"><h3>Kurlar (TL karşılığı)</h3><span class="muted">${s.kurTarihi ? `Kur tarihi ${esc(U.formatDate(s.kurTarihi))}` : 'Kur girilmemiş'}</span></div>
        ${foreign.length ? `<div class="rate-grid">${foreign.map((c) => `<span class="cur">${esc(c)}</span><input class="field-input" data-set-rate="${esc(c)}" value="${esc(M.isNum(s.kurlar[c]) ? M.formatPrice(s.kurlar[c]) : '')}" placeholder="örn. 36,50"><span class="hint">1 ${esc(c)} = ? TRY</span>`).join('')}</div>` : '<p class="field-help">Yalnız TRY kullanılıyor.</p>'}
        <div class="field-row" style="margin-top:10px"><div class="field"><label for="stKurTarihi">Kur tarihi</label><input type="date" id="stKurTarihi" class="field-input" value="${esc(s.kurTarihi)}"></div>
        <div class="field"><label for="stRapor">Yeni projelerde toplam para birimi</label><select id="stRapor" class="field-input">${s.paraBirimleri.map((c) => `<option${c === s.raporParaBirimi ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div></div>
        <p class="field-help">Yeni projeler bu kurlarla başlar; proje kurları belgenin değişmemesi için projede saklanır. Açık projeye sağ paneldeki <b>Ayarlardaki kurları al</b> ile aktarılır. Kurlar elle girilir (TCMB ya da bankanızın satış kuru).</p>
      </div>
      <div class="card">
        <div class="card-head"><h3>Para birimleri</h3></div>
        <div class="field"><label for="stCurrencies">Kullanılan para birimleri (virgülle)</label><input id="stCurrencies" class="field-input" value="${esc(s.paraBirimleri.join(', '))}"><p class="field-help">Üç harfli kod: TRY, EUR, USD, GBP, CHF…</p></div>
        <div class="field"><label for="stDefCur">Yeni komponentte para birimi</label><select id="stDefCur" class="field-input">${s.paraBirimleri.map((c) => `<option${c === s.varsayilanParaBirimi ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Belge kişileri ve antet</h3></div>
        <div class="field-row three">
          <div class="field"><label for="stHaz">Hazırlayan</label><input id="stHaz" class="field-input" value="${esc(s.kisiler.hazirlayan)}"></div>
          <div class="field"><label for="stKon">Kontrol</label><input id="stKon" class="field-input" value="${esc(s.kisiler.kontrol)}"></div>
          <div class="field"><label for="stOnay">Onay</label><input id="stOnay" class="field-input" value="${esc(s.kisiler.onay)}"></div>
        </div>
        <div class="field" style="margin-top:8px"><label for="stFirma">Varsayılan belge anteti</label><select id="stFirma" class="field-input">${M.BRAND_IDS.map((b) => `<option${b === s.firma ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
        <p class="field-help">Yeni projelere yazılır; her projede sağ panelden değiştirilir.</p>
      </div>
      <div class="card">
        <div class="card-head"><h3>Yeni projede bölümler</h3></div>
        <div class="field"><label for="stSections">Her satıra bir bölüm</label><textarea id="stSections" class="field-input" rows="5">${lines(s.varsayilanBolumler)}</textarea></div>
        <p class="field-help">Örn: Elektrik Panosu, Pnömatik, Mekanik, Hidrolik, Sarf Malzeme. Yeni proje penceresinde değiştirilebilir.</p>
      </div>
      <div class="card">
        <div class="card-head"><h3>Kategoriler</h3></div>
        <div class="field"><label for="stCats">Her satıra bir kategori (sıra listelerde kullanılır)</label><textarea id="stCats" class="field-input" rows="9">${lines(s.kategoriler)}</textarea></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Birimler</h3></div>
        <div class="field"><label for="stUnits">Her satıra bir birim</label><textarea id="stUnits" class="field-input" rows="6">${lines(s.birimler)}</textarea></div>
        <div class="field"><label for="stDefUnit">Varsayılan birim</label><input id="stDefUnit" class="field-input" value="${esc(s.varsayilanBirim)}" list="unitList"></div>
      </div>
    </div>`;
  }

  /** Sayfa yalnız yapısı değişince yeniden kurulur (para birimleri → kur satırları); Tab ile alandan alana geçiş bozulmaz */
  async function saveSetting(patch, message) {
    try {
      await app().updateSettings(patch);
      U.toast(message || 'Ayar kaydedildi');
      if ('paraBirimleri' in patch) renderSettings();
      else {
        const label = U.$('settingsBody').querySelector('.card-head .muted');
        const s = app().settings;
        if (label) label.textContent = s.kurTarihi ? `Kur tarihi ${U.formatDate(s.kurTarihi)}` : 'Kur girilmemiş';
      }
    } catch (e) {
      U.toast(`Ayar kaydedilemedi: ${e.message}`, 'error');
      renderSettings();
    }
  }

  function bindSettings() {
    U.$('settingsBody').addEventListener('change', (e) => {
      const t = e.target;
      const s = app().settings;
      const list = (v) => v.split(/\r?\n|,/).map((x) => M.clean(x)).filter(Boolean);
      if (t.dataset.setRate) {
        const n = t.value.trim() ? M.parseNumber(t.value) : null;
        if (t.value.trim() && !(n > 0)) {
          U.toast('Kur sıfırdan büyük olmalı', 'error');
          renderSettings();
          return;
        }
        const patch = { kurlar: Object.assign({}, s.kurlar, { [t.dataset.setRate]: n }) };
        if (!s.kurTarihi || s.kurTarihi !== M.today()) patch.kurTarihi = M.today();
        saveSetting(patch, `${t.dataset.setRate} kuru kaydedildi`);
        return;
      }
      const map = {
        stKurTarihi: () => ({ kurTarihi: t.value }),
        stRapor: () => ({ raporParaBirimi: t.value }),
        stCurrencies: () => ({ paraBirimleri: t.value.split(/[\s,;]+/).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)) }),
        stDefCur: () => ({ varsayilanParaBirimi: t.value }),
        stHaz: () => ({ kisiler: Object.assign({}, s.kisiler, { hazirlayan: t.value }) }),
        stKon: () => ({ kisiler: Object.assign({}, s.kisiler, { kontrol: t.value }) }),
        stOnay: () => ({ kisiler: Object.assign({}, s.kisiler, { onay: t.value }) }),
        stFirma: () => ({ firma: t.value }),
        stSections: () => ({ varsayilanBolumler: list(t.value) }),
        stCats: () => ({ kategoriler: list(t.value) }),
        stUnits: () => ({ birimler: list(t.value) }),
        stDefUnit: () => ({ varsayilanBirim: t.value })
      };
      if (map[t.id]) saveSetting(map[t.id]());
    });
  }

  /* ─── Veritabanı ──────────────────────────────────────── */

  async function renderDb() {
    const s = BomxBoot.settings();
    const github = s.mode === 'github';
    const st = app().state;
    const stats = await app().store.stats();
    const repoUrl = s.url || (s.repo ? `https://github.com/${s.repo}` : '');
    const expires = s.tokenExpires ? new Date(s.tokenExpires) : null;
    U.$('dbBody').innerHTML = `<div class="page-grid">
      <div class="card wide">
        <div id="dbStatusBox"></div>
        <dl class="kv">
          <dt>Veritabanı</dt><dd>${github ? `GitHub deposu <b>${esc(s.repo)}</b> (özel)` : 'Yerel: yalnız bu tarayıcı'}</dd>
          <dt>Kayıt</dt><dd>${stats.files} dosya · ${(stats.bytes / 1024).toFixed(0)} KB · ${st.library.length} komponent · ${st.projects.length} proje · ${st.templates.length} şablon</dd>
          ${github ? `<dt>Bağlantı</dt><dd>${s.connectedAt ? `${esc(new Date(s.connectedAt).toLocaleDateString('tr-TR'))} tarihinde bağlandı` : '—'}${expires ? ` · anahtar <b>${esc(expires.toLocaleDateString('tr-TR'))}</b> tarihinde doluyor` : ' · anahtar süresi GitHub ayarlarında görünür'}</dd>` : ''}
        </dl>
        <div class="actions">
          ${github ? '<button type="button" class="btn btn-primary" id="dbSync">Şimdi eşitle</button>' : ''}
          ${github && repoUrl ? `<a class="btn" href="${esc(repoUrl)}" target="_blank" rel="noopener">Depoyu aç ↗</a><a class="btn" href="${esc(repoUrl)}/commits" target="_blank" rel="noopener">Kayıt geçmişi ↗</a>` : ''}
          <button type="button" class="btn" id="dbConnect">${github ? 'Depoyu ya da anahtarı değiştir' : 'GitHub deposuna bağla'}</button>
          ${github ? '<button type="button" class="btn btn-danger" id="dbDisconnect">Bağlantıyı kaldır</button>' : ''}
        </div>
        <div class="result" id="dbResult" role="status"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Yedek</h3></div>
        <p class="field-help">Bütün veri (kütüphane, projeler, şablonlar, ayarlar) tek JSON dosyasına alınır. Yüklerken var olan dosyalar korunur, eksikler eklenir.</p>
        <div class="actions"><button type="button" class="btn" id="dbBackup">Yedek indir</button><button type="button" class="btn" id="dbRestore">Yedekten yükle</button></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>İki cihazda değişen dosyalar</h3><span class="muted">${st.conflicts.length || 'yok'}</span></div>
        <p class="field-help">Kütüphane, projeler, şablonlar ve ayarlar iki cihazda aynı anda değişince kayıt kayıt birleşir; kopya oluşmaz. Program tanımadığı bir dosyayı iki taraf değiştirirse yeni olan asıl dosya olur, eskisi <code>.catisma-&lt;tarih&gt;</code> adıyla burada durur.</p>
        ${st.conflicts.map((c) => `<div class="conflict-row"><code title="${esc(c.path)}">${esc(c.path)}</code><button type="button" class="btn btn-xs" data-cdl="${esc(c.path)}">İndir</button><button type="button" class="btn btn-xs btn-danger" data-cdel="${esc(c.path)}">Sil</button></div>`).join('')}
      </div>
      <div class="card">
        <div class="card-head"><h3>P&amp;PX</h3></div>
        ${st.ppx ? `<p class="field-help">P&amp;PX bu tarayıcıda kullanılıyor: <b>${st.ppx.codes.length}</b> kod, <b>${st.ppx.machines.length}</b> makine kaydı okunabiliyor. Kod listesi kütüphaneye alınabilir; yeni projede makine kaydı seçilince kodları listeye gelir. P&amp;PX verisine yazılmaz.</p>
          <div class="actions"><button type="button" class="btn" id="dbPpx">Kod listesini kütüphaneye al</button></div>`
          : '<p class="field-help">P&amp;PX bu tarayıcıda bulunamadı. P&amp;PX aynı tarayıcıda (Chrome / Edge) kullanılıyorsa kod listesi ve makine kayıtları buradan okunur. Ya da P&amp;PX klasöründeki <code>ML/kayitlar/kodlar.json</code> veya <code>ML/KODListesi.csv</code> dosyasını Komponentler → İçe aktar ile alın.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Depoda dosyalar</h3></div>
        <dl class="kv">
          <dt><code>BOM/kutuphane/k0…kf.json</code></dt><dd>Komponent kütüphanesi (kimliğe göre 16 parça)</dd>
          <dt><code>BOM/projeler/&lt;proje&gt;/proje.json</code></dt><dd>Proje bilgileri ve malzeme listesi</dd>
          <dt><code>…/revizyon/&lt;rev&gt;.json</code></dt><dd>Revizyon yükseltilirken listenin hâli</dd>
          <dt><code>BOM/sablonlar/*.json</code></dt><dd>Hazır setler</dd>
          <dt><code>BOM/ayarlar.json</code></dt><dd>Kurlar, kategoriler, birimler, kişiler</dd>
        </dl>
        <p class="field-help">Kayıt önce bu cihaza yazılır, en geç 1 dakikada bir (ve sayfadan çıkarken) tek commit olarak depoya gider. İnternet kesilse de kayıt kaybolmaz.</p>
      </div>
    </div>`;
    renderDbStatus();
  }

  function renderDbStatus() {
    const box = U.$('dbStatusBox');
    if (!box) return;
    const info = statusInfo();
    const st = app().state.status || {};
    const cls = info.cls.includes('err') ? 'err' : info.cls.includes('warn') ? 'warn' : info.cls.includes('syncing') ? 'syncing' : '';
    box.innerHTML = `<div class="status-big ${cls}"><span class="dot"></span><div><strong>${esc(info.text)}</strong><span>${esc(st.error || (BomxBoot.settings().mode === 'github' ? 'Değişiklikler kendiliğinden gönderilir; başka cihazdaki değişiklikler açılışta ve birkaç dakikada bir gelir.' : 'GitHub deposuna bağlanınca buradaki her şey gönderilir.'))}</span></div></div>`;
  }

  function bindDb() {
    U.$('dbBody').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const say = (t, err) => {
        const el = U.$('dbResult');
        if (el) {
          el.textContent = t;
          el.className = `result${err ? ' err' : ''}`;
        }
      };
      if (b.id === 'dbSync') {
        say('Eşitleniyor…');
        const s = await app().syncNow();
        await renderDb();
        say(s.error || `Eşitlendi${s.pending ? `, ${s.pending} dosya sırada` : ''}.`, !!s.error);
      } else if (b.id === 'dbConnect') {
        BomxSetup.show({ reason: 'change', onCancel: () => {} });
      } else if (b.id === 'dbDisconnect') {
        const ok = await U.confirmModal('Bağlantıyı kaldır', 'Anahtar bu tarayıcıdan silinir; veriler bu bilgisayarda kalır ve yerel modda çalışılır. Yeniden bağlanınca yapılanlar depoya gönderilir.', 'Bağlantıyı kaldır', { danger: true });
        if (!ok) return;
        await BomxEditor.flush();
        await app().syncNow();
        BomxBoot.disconnect();
        location.reload();
      } else if (b.id === 'dbBackup') {
        const backup = await app().state.db.exportBackup();
        U.download(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `bomx-yedek-${M.today()}.json`);
        say(`Yedek indirildi: ${backup.files.length} dosya.`);
      } else if (b.id === 'dbRestore') {
        const file = await U.pickFile('.json,application/json');
        if (!file) return;
        try {
          const res = await app().state.db.importBackup(JSON.parse(await file.text()));
          say(`${res.written} dosya yüklendi, ${res.kept} dosya zaten vardı ve korundu.`);
          const lib = await app().store.loadLibrary();
          app().setLibrary(lib.components);
          app().state.settings = await app().store.readSettings();
          await app().refreshProjects();
          await app().refreshTemplates();
          renderDb();
        } catch (err) {
          say(err.message, true);
        }
      } else if (b.id === 'dbPpx') {
        BomxLibrary.importFromPpx();
      } else if (b.dataset.cdl) {
        const c = app().state.conflicts.find((x) => x.path === b.dataset.cdl);
        if (c) U.download(new Blob([c.bytes]), c.path.split('/').pop());
      } else if (b.dataset.cdel) {
        if (!(await U.confirmModal('Kopyayı sil', `${b.dataset.cdel} silinsin mi? Asıl dosya değişmez.`, 'Sil', { danger: true }))) return;
        await app().store.removeFile(b.dataset.cdel);
        await app().refreshConflicts();
        renderDb();
      }
    });
  }

  /* ─── Bağlantılar ─────────────────────────────────────── */

  function handleKey(e) {
    if (H.tab === 'library') {
      BomxLibrary.handleKey(e);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      const target = H.tab === 'projects' ? U.$('pjSearch') : H.tab === 'templates' ? U.$('tpSearch') : null;
      if (target) {
        e.preventDefault();
        target.focus();
        target.select();
      }
    }
  }

  function init() {
    document.querySelectorAll('.home-tab').forEach((b) => b.addEventListener('click', () => show(b.dataset.homeTab)));
    U.$('btnNewProject').addEventListener('click', () => newProjectDialog());
    U.$('homeStatus').addEventListener('click', () => show('db'));
    U.$('appStatus').addEventListener('click', () => app().showHome('db'));
    U.$('homeBanner').addEventListener('click', (e) => {
      const b = e.target.closest('[data-banner]');
      if (b) BomxSetup.show({ reason: b.dataset.banner === 'token' ? 'auth' : 'change', onCancel: () => {} });
    });
    const search = U.$('pjSearch');
    search.addEventListener('input', U.debounce(() => {
      H.query = search.value;
      renderProjects();
    }, 80));
    U.$('pjStatus').addEventListener('change', (e) => {
      H.status = e.target.value;
      renderProjects();
    });
    U.$('pjSort').addEventListener('change', (e) => {
      H.sort = e.target.value;
      U.setPref('projeSira', H.sort);
      renderProjects();
    });
    const grid = U.$('projectGrid');
    grid.addEventListener('click', (e) => {
      const menu = e.target.closest('[data-menu]');
      if (menu) {
        e.stopPropagation();
        const r = menu.getBoundingClientRect();
        projectMenu(menu.dataset.menu, r.left, r.bottom + 4);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'new') newProjectDialog();
        if (act.dataset.act === 'library') show('library');
        return;
      }
      const card = e.target.closest('.project-card');
      if (card) app().openProject(card.dataset.id);
    });
    grid.addEventListener('keydown', (e) => {
      const card = e.target.closest('.project-card');
      if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        app().openProject(card.dataset.id);
      }
    });
    grid.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.project-card');
      if (!card) return;
      e.preventDefault();
      projectMenu(card.dataset.id, e.clientX, e.clientY);
    });
    U.$('tpNew').addEventListener('click', () => {
      H.templateId = null;
      H.templateDraft = M.normalizeTemplate({ id: M.uid(), ad: '', kalemler: [] });
      renderTemplates();
      setTimeout(() => U.$('tpName').focus(), 0);
    });
    U.$('tpSearch').addEventListener('input', (e) => {
      H.templateQuery = e.target.value;
      renderTemplateList();
    });
    U.$('tpList').addEventListener('click', (e) => {
      const item = e.target.closest('.side-item');
      if (!item) return;
      const t = app().state.templates.find((x) => x.id === item.dataset.id);
      H.templateId = t ? t.id : null;
      H.templateDraft = t ? M.clone(t) : null;
      renderTemplates();
    });
    bindSettings();
    bindDb();
    app().on('projects', () => {
      updateCounts();
      if (H.tab === 'projects' && !U.$('home').classList.contains('hidden')) renderProjects();
    });
    app().on('library', updateCounts);
    app().on('templates', () => {
      updateCounts();
      if (H.tab === 'templates' && !U.$('home').classList.contains('hidden')) {
        if (H.templateId && !app().state.templates.some((t) => t.id === H.templateId)) {
          H.templateId = null;
          H.templateDraft = null;
        }
        renderTemplates();
      }
    });
    app().on('settings', () => {
      if (H.tab === 'settings' && !U.$('home').classList.contains('hidden') && !U.$('settingsBody').contains(document.activeElement)) renderSettings();
    });
    app().on('conflicts', () => {
      updateCounts();
      if (H.tab === 'db' && !U.$('home').classList.contains('hidden')) renderDb();
    });
    app().on('status', renderStatus);
  }

  return { init, show, handleKey, newProjectDialog, duplicateProjectDialog, deleteProjectDialog, renderStatus };
})();

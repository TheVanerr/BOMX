/* Kurulum ekranı: veritabanı olacak özel GitHub deposu ve erişim anahtarı.
   P&PX ana ekranındaki bağlantı adımlarının aynısı: depo ve anahtar bağlantıları gerekli seçimleri hazır getirir. */

const BomxSetup = (() => {
  const U = BomxUi;
  const { esc } = U;

  const REPO_NAME = 'bomx-veri';
  const NEW_REPO_URL = `https://github.com/new?name=${REPO_NAME}&visibility=private&description=${encodeURIComponent('BOMX malzeme listesi veritabanı')}`;
  const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new' +
    `?name=${encodeURIComponent('BOMX veri')}` +
    `&description=${encodeURIComponent('BOMX malzeme listesi programı: yalnız bomx-veri deposu')}` +
    '&contents=write&expires_in=365';
  const TOKEN_LIST_URL = 'https://github.com/settings/personal-access-tokens';
  const DONE_KEY = 'bomx_kurulum_adim';

  function doneSteps() {
    try {
      return JSON.parse(sessionStorage.getItem(DONE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function markDone(step) {
    const d = doneSteps();
    d[step] = true;
    try {
      sessionStorage.setItem(DONE_KEY, JSON.stringify(d));
    } catch { /* gizli pencere */ }
  }

  /** Anahtar biçimi: ince ayarlı (github_pat_) önerilir; klasik anahtar bütün depolara erişir */
  function tokenHint(token) {
    const t = String(token || '').trim();
    if (!t) return { text: '', cls: '' };
    if (/^github_pat_[A-Za-z0-9_]{20,}$/.test(t)) return { text: 'İnce ayarlı anahtar (doğru tür).', cls: 'ok-text' };
    if (/^gh[pousr]_[A-Za-z0-9]{20,}$/.test(t)) {
      return { text: 'Bu klasik bir anahtar: bütün depolarınıza erişir. Yalnız bomx-veri deposuna izinli ince ayarlı (fine-grained) anahtar önerilir.', cls: 'warn-text' };
    }
    return { text: 'Bu bir GitHub anahtarına benzemiyor. Anahtar github_pat_ ile başlar.', cls: 'err-text' };
  }

  /**
   * @param options.reason 'first' (ilk açılış), 'change' (veritabanı sekmesinden), 'auth' (anahtar geçersiz)
   * @param options.onCancel bağlıyken vazgeçilince
   */
  function show(options) {
    const o = options || {};
    const settings = BomxBoot.settings();
    const connected = settings.mode === 'github';
    const done = doneSteps();
    const root = U.$('setup');
    const repoValue = settings.repo || settings.lastRepo || REPO_NAME;
    const banner = o.reason === 'auth'
      ? `<div class="setup-note" style="margin:0 0 16px;border-left-color:var(--dolfin);background:rgba(255,0,0,.08)"><strong style="color:#ff8585">GitHub anahtarı geçersiz ya da süresi dolmuş.</strong> Kayıtlarınız bu bilgisayarda duruyor, kaybolmadı. 2. adımdan yeni bir anahtar oluşturup 3. adımda yapıştırın; bekleyen kayıtlar kendiliğinden gönderilir.</div>`
      : '';
    root.innerHTML = `
      <div class="setup-inner">
        <div class="setup-brand">
          <img src="assets/logos/dolfin.png" alt="Dolfin">
          <div><h1>BOMX · Malzeme Listesi</h1><p>BILL OF MATERIALS · PROJE · KOMPONENT KÜTÜPHANESİ</p></div>
          ${connected || o.reason === 'change' ? '<button type="button" class="btn setup-close" id="suCancel" style="margin-left:auto">Vazgeç</button>' : ''}
        </div>
        ${banner}
        <div class="setup-card">
          <h2>${connected ? 'Depoyu ya da anahtarı değiştir' : 'Verileriniz nerede dursun?'}</h2>
          <p>Veritabanı sizin <strong>özel GitHub deposunuzdur</strong> (<code>${REPO_NAME}</code>). Komponent kütüphanesi, projeler ve malzeme listeleri orada JSON dosyaları olarak durur.
          ${connected ? `Şu an bağlı depo: <strong>${esc(settings.repo)}</strong>.` : ''}</p>
          <div class="setup-why">
            <div><strong>Ücretsiz, sunucusuz</strong>Kurulum yok; program bu dosyadan çalışır, doğrudan GitHub ile konuşur.</div>
            <div><strong>Her kayıt geçmişte</strong>Her değişiklik bir commit'tir; eski bir sürüm GitHub geçmişinden geri alınır.</div>
            <div><strong>Her bilgisayardan</strong>Başka bilgisayarda aynı depo ve anahtarla bağlanınca veriler kendiliğinden gelir.</div>
          </div>

          <ol class="steps">
            <li class="step${done.repo ? ' done' : ''}" id="suStepRepo">
              <div class="step-num">${done.repo ? '✓' : '1'}</div>
              <div>
                <h3>Özel depoyu oluşturun</h3>
                <p>Bağlantı GitHub'da yeni depo sayfasını açar; ad (<code>${REPO_NAME}</code>) ve görünürlük (<strong>Private</strong>) hazır gelir. Sayfanın altındaki <strong>Create repository</strong> düğmesine basmanız yeter. README ya da başka dosya eklemeyin, boş depoyu program hazırlar. Depo zaten varsa bu adımı geçin.</p>
                <div class="step-actions">
                  <a class="btn btn-primary btn-sm" id="suRepoLink" href="${NEW_REPO_URL}" target="_blank" rel="noopener">GitHub'da ${REPO_NAME} deposunu oluştur ↗</a>
                </div>
              </div>
            </li>
            <li class="step${done.token ? ' done' : ''}" id="suStepToken">
              <div class="step-num">${done.token ? '✓' : '2'}</div>
              <div>
                <h3>Erişim anahtarı oluşturun</h3>
                <p>Bağlantı ince ayarlı (fine-grained) anahtar sayfasını açar; ad, açıklama, süre (365 gün) ve <strong>Contents: Read and write</strong> izni hazır seçilir. Sayfada yalnız şunları yapın:</p>
                <ul class="checklist">
                  <li><span><strong>Repository access</strong> bölümünde <strong>Only select repositories</strong> seçin, listeden <strong>${REPO_NAME}</strong> deposunu işaretleyin. Anahtar başka depoya erişemez.</span></li>
                  <li><span><strong>Permissions → Repository permissions</strong> altında <strong>Contents</strong> satırı <strong>Read and write</strong> olmalı (hazır gelir). <em>Metadata: Read-only</em> kendiliğinden eklenir; başka izin gerekmez.</span></li>
                  <li><span>En altta <strong>Generate token</strong> deyin ve çıkan, <code>github_pat_</code> ile başlayan anahtarı kopyalayın. Sayfadan çıkınca bir daha gösterilmez; kaybederseniz yenisini oluşturun.</span></li>
                </ul>
                <div class="step-actions">
                  <a class="btn btn-primary btn-sm" id="suTokenLink" href="${NEW_TOKEN_URL}" target="_blank" rel="noopener">Anahtar oluşturma sayfasını aç ↗</a>
                  <a class="btn btn-sm" href="${TOKEN_LIST_URL}" target="_blank" rel="noopener">Anahtarlarım ↗</a>
                </div>
              </div>
            </li>
            <li class="step" id="suStepConnect">
              <div class="step-num">3</div>
              <div>
                <h3>Anahtarı yapıştırıp bağlanın</h3>
                <p>Anahtar yalnız bu tarayıcıda saklanır. Bağlanırken deponun gerçekten özel (Private) olduğu denetlenir; herkese açık depoya bağlanılmaz.</p>
                <div class="setup-form">
                  <div class="field">
                    <label for="suRepo">Depo</label>
                    <input id="suRepo" class="field-input" value="${esc(repoValue)}" placeholder="kullanici/${REPO_NAME}" autocomplete="off" spellcheck="false">
                    <p class="field-help">Yalnız <code>${REPO_NAME}</code> yazarsanız kullanıcı adınız anahtardan bulunur. Bir kuruluşun deposuysa <code>kurulus/${REPO_NAME}</code> yazın.</p>
                  </div>
                  <div class="field">
                    <label for="suToken">Erişim anahtarı</label>
                    <div class="token-wrap">
                      <input id="suToken" class="field-input" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
                      <button type="button" class="btn btn-xs" id="suShow">Göster</button>
                    </div>
                    <p class="field-help" id="suHint"></p>
                  </div>
                  <div class="step-actions">
                    <button type="button" class="btn btn-primary" id="suConnect">Bağlan</button>
                    <span class="setup-result" id="suResult" role="status"></span>
                  </div>
                </div>
              </div>
            </li>
          </ol>

          <div class="setup-note">
            <strong>Anahtar güvenliği.</strong> Anahtar yalnız bu tarayıcıda saklanır, ancak bu bilgisayarda açtığınız başka bir yerel HTML dosyası da onu okuyabilir. Bu yüzden anahtar yalnız <code>${REPO_NAME}</code> deposuna izinli olmalıdır; bilinmeyen HTML dosyalarını bu tarayıcıda açmayın. Süresi dolunca program uyarır, bu ekrandan yenisi girilir; bekleyen kayıtlar kaybolmaz.
          </div>
          ${connected ? '' : `
          <div class="setup-alt">
            <button type="button" class="btn" id="suLocal">Şimdilik yalnız bu bilgisayarda kullan</button>
            <span>GitHub'a sonradan bağlanınca bu bilgisayarda yapılanlar depoya gönderilir.</span>
          </div>`}
        </div>
      </div>`;
    root.classList.remove('hidden');

    const result = (text, cls) => {
      const el = U.$('suResult');
      el.textContent = text;
      el.className = `setup-result ${cls || ''}`;
    };
    U.$('suRepoLink').addEventListener('click', () => {
      markDone('repo');
      setTimeout(() => {
        U.$('suStepRepo').classList.add('done');
        U.$('suStepRepo').querySelector('.step-num').textContent = '✓';
      }, 300);
    });
    U.$('suTokenLink').addEventListener('click', () => {
      markDone('token');
      setTimeout(() => {
        U.$('suStepToken').classList.add('done');
        U.$('suStepToken').querySelector('.step-num').textContent = '✓';
      }, 300);
    });
    const tokenInput = U.$('suToken');
    const updateHint = () => {
      const h = tokenHint(tokenInput.value);
      const el = U.$('suHint');
      el.textContent = h.text;
      el.className = `field-help ${h.cls}`;
    };
    tokenInput.addEventListener('input', updateHint);
    tokenInput.addEventListener('paste', () => setTimeout(() => {
      tokenInput.value = tokenInput.value.trim();
      updateHint();
    }));
    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') U.$('suConnect').click();
    });
    U.$('suShow').addEventListener('click', () => {
      const show = tokenInput.type === 'password';
      tokenInput.type = show ? 'text' : 'password';
      U.$('suShow').textContent = show ? 'Gizle' : 'Göster';
    });
    U.$('suConnect').addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      if (!token) {
        result('Önce 2. adımda oluşturduğunuz anahtarı yapıştırın.', 'err');
        tokenInput.focus();
        return;
      }
      U.$('suConnect').disabled = true;
      result('Deneniyor…');
      try {
        const { repo } = await BomxBoot.connectGitHub(U.$('suRepo').value, token);
        result(`Bağlandı: ${repo}. Veriler hazırlanıyor…`, 'ok');
        setTimeout(() => location.reload(), 400);
      } catch (e) {
        U.$('suConnect').disabled = false;
        result(e.message || String(e), 'err');
      }
    });
    if (U.$('suLocal')) {
      U.$('suLocal').addEventListener('click', () => {
        BomxBoot.useLocal();
        location.reload();
      });
    }
    if (U.$('suCancel')) {
      U.$('suCancel').addEventListener('click', () => {
        hide();
        if (o.onCancel) o.onCancel();
      });
    }
    setTimeout(() => (connected || done.token ? tokenInput : U.$('suRepoLink')).focus(), 0);
  }

  function hide() {
    U.$('setup').classList.add('hidden');
    U.$('setup').innerHTML = '';
  }

  const isOpen = () => !U.$('setup').classList.contains('hidden');

  return { show, hide, isOpen, tokenHint, NEW_REPO_URL, NEW_TOKEN_URL, REPO_NAME };
})();

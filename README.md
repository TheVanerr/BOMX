# BOMX

Malzeme listesi (BOM) programı: genel komponent kütüphanesi, projeler, bölümlere ayrılmış malzeme listesi, revizyonlar, antetli PDF, Excel ve CSV. Veritabanı özel bir GitHub deposudur (`bomx-veri`): ücretsizdir, sunucu ve kurulum gerektirmez, her kayıt geçmişte durur. Arayüz ve veri katmanı P&PX ile aynı yapıdadır.

## Başlatma

`index.html` dosyasını **Chrome veya Edge** ile açın (çift tık). Sunucu, Node ya da kurulacak paket yoktur.

İlk açılışta ekrandaki üç adımı izleyin (yaklaşık 3 dakika):

1. **Özel depoyu oluşturun.** Bağlantı GitHub'da yeni depo sayfasını `bomx-veri` adı ve **Private** görünürlükle hazır açar; yalnız "Create repository" deyin. README ya da başka dosya eklemeyin, boş depoyu program hazırlar.
2. **Erişim anahtarı oluşturun.** Bağlantı ince ayarlı (fine-grained) anahtar sayfasını açar; ad, açıklama, süre (365 gün) ve **Contents: Read and write** izni hazır gelir. Sayfada:
   - **Repository access** → **Only select repositories** → listeden **bomx-veri** deposunu seçin. Anahtar başka depoya erişemez.
   - **Contents** satırının **Read and write** olduğunu görün (Metadata: Read-only kendiliğinden eklenir, başka izin gerekmez).
   - **Generate token** deyin, `github_pat_` ile başlayan anahtarı kopyalayın. Sayfadan çıkınca bir daha gösterilmez.
3. **Anahtarı yapıştırıp Bağlan deyin.** Depo alanına yalnız `bomx-veri` yazmanız yeter, kullanıcı adınız anahtardan bulunur (kuruluş deposuysa `kurulus/bomx-veri`). Bağlanırken deponun gerçekten özel olduğu denetlenir; herkese açık depoya bağlanılmaz.

Başka bir bilgisayarda: program klasörünü kopyalayın ya da git ile alın, `index.html` dosyasını açın, aynı depo ve anahtarla bağlanın. Veriler kendiliğinden gelir. Veri ve program ayrı durur.

GitHub'a bağlanmadan denemek için ekrandaki **Şimdilik yalnız bu bilgisayarda kullan** seçilir; sonradan bağlanınca yapılanlar depoya gönderilir.

Anahtarın süresi dolmadan üç hafta önce ana ekranda uyarı çıkar (GitHub bitiş tarihini bildiriyorsa). Süresi dolan ya da iptal edilen anahtarda kayıtlar bu bilgisayarda bekler; **Anahtarı yenile** ile yeni anahtar girilince gönderilir.

## Kullanım

### 1. Komponent kütüphanesi (ana ekran → Komponentler)

Genel komponent listesi: kod, ad, kategori, üretici ve üretici kodu (parça no), tedarikçi ve tedarikçi kodu, birim, birim fiyat ve para birimi, teslim süresi, açıklama / teknik özellik, bağlantı, favori, pasif.

- **+ Yeni komponent** sağdaki formu açar. Kod tekrarı (büyük/küçük harf ve Türkçe işaret farkı gözetmeden) kabul edilmez.
- **Tabloda düzenleme**: satıra tıklamak yan formu açar, hücreye çift tıklamak hücreyi yerinde düzenler. **✎ Tabloda düzenle** açıkken tek tık yeter ve tabloya para birimi ile açıklama sütunları gelir. <kbd>Enter</kbd> alttaki satırın aynı hücresine, <kbd>Tab</kbd> sağdaki hücreye geçer, <kbd>Esc</kbd> vazgeçer; açıklamada <kbd>Shift</kbd>+<kbd>Enter</kbd> yeni satırdır. Her hücre ayrı kaydedilir; başka komponentin kodu ya da boş ad kabul edilmez, kutu kırmızı kalır.
- **Seçme ve silme**: satır başındaki kutular; <kbd>Shift</kbd> ile tıklamak aradakileri de seçer, <kbd>Ctrl</kbd>+<kbd>A</kbd> görünenlerin hepsini seçer, <kbd>Delete</kbd> seçilenleri siler (onay sorar; projede kullanılan için **Pasif yap** önerilir).
- **Geri al**: <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> ya da araç çubuğundaki ↶ ↷. Hücre düzenlemesi, form, toplu değişiklik, silme ve içe aktarma geri alınır (sayfa açık kaldıkça son 60 işlem); bildirimdeki **Geri al** da aynısını yapar.
- **Fotoğraf**: formun başındaki alana **Fotoğraf seç…** ile dosya seçilir, kopyalanan görsel form açıkken <kbd>Ctrl</kbd>+<kbd>V</kbd> ile yapıştırılır ya da dosya alana sürüklenip bırakılır; **Kaldır** siler. Görsel en uzun kenarı 420 px olacak şekilde küçültülüp JPEG olarak saklanır (~15–30 KB). Fotoğraf tabloda, düzenleyicinin sol panelinde ve ayrıntısında görünür; tıklayınca büyür. Fotoğraf değişikliği de geri alınır; silinen komponent geri alınınca fotoğrafıyla gelir. **Çoğalt** kaynağın fotoğrafını alır.
- **İçe aktar**: dosya (BOMX komponent paketi .json, CSV, Excel .xlsx / .xlsm, ERP ürün ağacı, HTML rapor ya da tablo; ERP'lerin `.xls` adıyla verdiği HTML tablosu da), HTML raporları (aşağıda), Excel'den yapıştırılan tablo veya P&PX kod listesi. **Komponent paketi** alanları ve fotoğrafları tek dosyada taşır: önizlemede fotoğraf sütunu görünür, kütüphanede fotoğrafı olmayan koda paketteki fotoğraf eklenir (var olan fotoğrafa yalnız "dosyadakiyle değiştir" kipinde dokunulur). Dosyalar sayfaya sürüklenip bırakılabilir, birden çok dosya birlikte seçilebilir. Sütunlar başlıktan tahmin edilir (Stok Kodu, Sipariş kodu, Malzeme / Stok / Parça Adı, Ürün tam adı, Marka, Birim Fiyatı, Döviz…); kod ya da ad sütunu bulunamazsa önce eşleştirme sorulur. Excel'in `sep=;` satırıyla başlayan CSV'si doğrudan okunur. **Boş CSV şablonu indir** doğru başlıkları verir.
- **Önizleme** (her aktarmada, kütüphaneye yazmadan önce): her satır durumunu gösterir (Yeni, Güncellenecek, Değişmeyecek, Hatalı, Alınmayacak; ipucunda değişecek alanlar). Hücreye tıklayıp düzeltin; satır başındaki kutuyla alın ya da çıkarın; aramayla ve filtrelerle süzüp **Görünenleri al / alma**, **Kategori / Üretici / Tedarikçi ata**. Kütüphanede olan kodlar için: dolu alanları güncelle (boş hücre var olanı silmez), dokunma (yalnız yenileri ekle), dosyadakiyle değiştir. Elle düzeltilen satır ✎ ile işaretlenir; düzeltme varken pencereyi kapatmak onay ister.
- Aktarılanlar **Son aktarılanlar** filtresiyle açılır: gereksizleri seçip silin, kalanları tabloda düzeltin. GitHub'a bağlıysa aktarma beklemeden depoya gönderilir.
- **Toplu düzenleme**: satırları işaretleyip kategori, üretici, tedarikçi, birim, para birimi atayın; fiyatları yüzdeyle değiştirin (zam / indirim); favori ya da pasif yapın; silin.
- Kullanımdan kalkan komponenti silmek yerine **pasif** yapın: listelerde gizlenir, kullanıldığı projelerde Kontrol uyarı verir, eski projeler bozulmaz.
- **Dışa aktar**: tümü ya da görünenler; Excel, CSV ya da fotoğraflı paket (JSON). Paket başka bir BOMX'e (ya da yeniden kurulan kütüphaneye) **İçe aktar → Dosyadan** ile fotoğraflarıyla alınır.

#### Raporlardan ve ürün ağaçlarından: ürün ağacı, kritik parça, sarf listesi

**İçe aktar → HTML raporlarından** (ya da dosyaları sayfaya bırakın): `urun-agaci-bom.html`, `kritik-parca-listeleri.html`, `KBN-2B-1650-KSY-Yillik-Sarf-Listesi.html` gibi raporlar birlikte seçilir, tek önizlemede birleşir. Sayfaların kodu çalıştırılmaz, yalnız içlerindeki veri okunur. ERP'nin tek ya da çok seviyeli ürün ağacı (Excel .xlsx / .xlsm ya da CSV; Kaynak Kodu, Kaynak Adı, Seviye, Tip sütunlarıyla) **İçe aktar → Dosyadan** ile aynı şekilde okunur: kök satır makinedir, alt seviyeler kompleleri açar, operasyon ve süre satırları atlanır.

- Aynı stok kodu dosyalarda ve makinelerde tek kayda iner. Ürün ağacındaki komplelerin alt kırılımı açılır; kompledeki parça, kompleyi kullanan makinelerde sayılır.
- Raporlardaki fotoğraflar komponentle gelir (ürün ağacı, kritik parça ve sarf listesindeki fotoğraflar). Fotoğrafı olmayan kalem, tek üst komplesi aynı kategorideyse onun fotoğrafını; değilse adı yalnız ölçüsüyle ayrılan aynı ailedeki kalemin fotoğrafını alır (ipucunda "10 08542 fotoğrafı" gibi yazar).
- Her kod türüne ayrılır. **Elektrikli parça**: sensör, switch, termokupl, termostat, seviye ve basınç şalteri, pompa, fan, redüktör motoru, rezistans, selenoid valf, kontaktör, termik / MKŞ, sigorta, röle, PLC, operatör paneli, invertör, güç kaynağı, buton, lamba, fiş / priz, kablo. **Redüktör** (motorsuz). **Elektrikli komple**: içinde elektrikli parça olan komple (redüktör ve motor komplesi, elektrik kutusu, kurutma ve tank dolum üniteleri…). **Elektrik dışı**: filtre, conta, rulman, amortisör, nozzle, vana… İlk üçü seçili gelir; elektrik dışı olanlar listede durur, kutusu işaretlenirse alınır. Türün nedeni satırın ipucunda yazar.
- Alanlar: **Ad** ERP stok adıdır (istenirse ürün tam adı). **Kategori** türden gelir (Kontaktör, Termik / MKŞ, Seviye Sensörü…). **Üretici** ve **üretici kodu** tam addan çıkarılır (Schneider · LC1K0910M7, Siemens · 6ES7214-1AG40-0XB0, Goulds · ESHE 32-160/22…). **Açıklama**da ürün tam adı, kullanıldığı makineler ve içinde bulunduğu kompleler yazar.
- Stok kodu olmayan sarf kalemi üretici koduyla gelir (uyarıyla); hiç kodu olmayan kalem hatalı görünür, kodu yazılınca alınır.
- Raporlar ikinci kez aktarılırken varsayılan "dokunma"dır: kütüphanede düzelttiğiniz kategori ve adların üzerine tahmin yazılmaz, yalnız yeni kodlar eklenir.

Aynı liste dosya olarak da üretilebilir: `node tools/rapor-aktar.js` BOMX klasöründeki raporları ve ürün ağaçlarını okuyup seçili gelenleri fotoğraflarıyla `BOMX elektrik komponentleri.json` paketine yazar (`--ek` ile koda göre ek özellik ve fotoğraf, `--csv klasör` ile Excel'de incelemek için CSV de). Paket **İçe aktar → Dosyadan** ile alınır.

### 2. Proje (ana ekran → + Yeni Proje)

Proje adı P&PX ile aynı biçimdedir: `seri no-müşteri-model` (ör. `0626051-DÜNYA-ULT M200 3B`). Başlangıç: boş liste (bölümler ayarlardan gelir), şablondan, başka projenin kopyası. P&PX bu tarayıcıda kullanılıyorsa **P&PX makine kaydı** seçilebilir: seri no, müşteri ve model gelir; makinedeki kodlar kütüphanede varsa listeye eklenir (referans olarak kodu da yazılır).

### 3. Malzeme listesini kurma (düzenleyici)

Solda komponent kütüphanesi, ortada liste, sağda özellikler ve kontrol, altta özet. Ekleme yolları, en hızlısından:

| Yol | Nasıl |
|---|---|
| Ara ve Enter | <kbd>/</kbd> ile arama kutusu; yazın, <kbd>↑</kbd> <kbd>↓</kbd> ile seçin, <kbd>Enter</kbd> bir ekler. <kbd>Shift</kbd>+<kbd>Enter</kbd> miktar kutusuna geçer, sayıyı yazıp <kbd>Enter</kbd> |
| Miktar kutusu | Soldaki her satırda `−  [miktar]  +`: kutu bu bölümdeki miktarı gösterir, yazılan değer listeye işlenir; 0 yazmak kalemi çıkarır |
| Çift tık, sürükle | Çift tık bir ekler; satırı tabloda istediğiniz yere ya da alttaki bölüm sekmesine sürükleyin |
| Yapıştır | Excel'den kod ve miktar sütunlarını kopyalayıp <kbd>Ctrl</kbd>+<kbd>V</kbd>; `PE01 2`, `2 x V31`, `LS01;4;not` de olur. Kütüphanede olmayan kodlar serbest kalem olur ya da atlanır |
| Şablon | Sol panel → Şablonlar: kayıtlı seti bölüme ya da yeni bölüm olarak ekleyin |
| Başka projeden | Sol panel → Başka projeden: benzer makinenin listesinden kalem işaretleyip alın, bölümleriyle birlikte de |
| Serbest kalem | Kütüphanede olmayan kalem (işçilik, nakliye, özel parça); isterseniz kütüphaneye de eklenir |

- **Bölümler** (alt montaj: Elektrik Panosu, Pnömatik, Mekanik…): alttaki sekmelerle gezilir (<kbd>PageUp</kbd> / <kbd>PageDown</kbd>), **+ Bölüm** ekler, çift tık adını değiştirir. Bölüm başlığına tıklamak eklenen komponentin gideceği bölümü seçer. Numaralar tek bölümde 1, 2, 3; çok bölümde 1.1, 1.2, 2.1 olur.
- **Tabloda düzenleme**: miktar, birim fiyat, iskonto, referans ve not hücreleri doğrudan yazılır; <kbd>Enter</kbd> alttaki satırın aynı hücresine geçer (Excel gibi), <kbd>Esc</kbd> vazgeçer. Sayılar Türkçe yazılır: `1.240,50`. Diğer alanlar sağ panelde.
- **Seçim**: tıklama, <kbd>Ctrl</kbd> ve <kbd>Shift</kbd> ile çoklu, <kbd>Ctrl</kbd>+<kbd>A</kbd> görünenler. Çoklu seçimde sağ panel bölüme taşıma, miktarı çarpma, iskonto ve tedarikçi yazma, birleştirme sunar.
- **Kısayollar**: <kbd>Delete</kbd> sil, <kbd>Ctrl</kbd>+<kbd>D</kbd> çoğalt, <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> taşı, <kbd>+</kbd>/<kbd>−</kbd> miktar, <kbd>Ctrl</kbd>+<kbd>C</kbd> kopyala (başka projeye ya da Excel'e yapıştırılır), <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> geri al / yinele, <kbd>Ctrl</kbd>+<kbd>F</kbd> listede ara, <kbd>Ctrl</kbd>+<kbd>S</kbd> kaydet, <kbd>Ctrl</kbd>+<kbd>P</kbd> belge önizleme. Satıra sağ tık menü açar; tablo başlığına sağ tık görünen sütunları seçtirir.
- **Kalem ve kütüphane**: kalem, eklendiği andaki kütüphane bilgisini taşır; projede değiştirilebilir (o projeye özel fiyat, üretici kodu). Kütüphanede fiyat ya da ad değişirse eski projeler kendiliğinden değişmez, **Kontrol** sekmesi farkı gösterir: **Kütüphaneden güncelle** ya da kalemdeki değeri **kütüphaneye yaz**.
- **Kontrol** sekmesi: girilmemiş miktar ve fiyat, eksik kur, kütüphaneden farklı alanlar, silinmiş ya da pasif komponent, aynı bölümde tekrar eden kalem (tek tıkla birleşir), iki kalemde geçen referans, miktarla uyuşmayan referans sayısı, boş bölüm, açıklamasız revizyon. Satıra tıklamak ilgili kalemleri seçer.
- **Alt panel**: **Özet** (kategoriye göre tutar ve pay, para birimi başına toplam ve kurlar), **Satın Alma** (aynı komponent bölümler arasında toplanır, tedarikçiye göre gruplanır; metin olarak e-postaya kopyalanır), **Revizyon Farkı**, **Referanslar** (P&ID kodu → kalem).

### 4. Para birimi ve kurlar

Fiyatlar kendi para biriminde girilir (TRY, EUR, USD…). Kurlar TL karşılığıdır (1 EUR = ? TRY) ve **Ayarlar** sekmesinde girilir; yeni proje o günkü kurları alır ve saklar, belge sonradan kendiliğinden değişmez. Projede kurlar sağ panelden değiştirilir ya da **Ayarlardaki kurları al** ile güncellenir. Toplam her para birimi için ayrı ve seçilen para birimine çevrilmiş olarak gösterilir; eksik kur Kontrol'de hata verir.

### 5. Revizyon

Yeni proje Rev. 00 (ilk yayın) ile başlar. Sağ paneldeki **+ Rev.** listenin o anki hâlini saklar (`revizyon/<rev>.json`), Rev. numarasını artırır, açıklamasını sorar; belge tarihi bugün olur. **Revizyon Farkı** sekmesi saklanan hâle göre eklenen, çıkarılan, miktarı ya da fiyatı değişen komponentleri gösterir. Revizyon tablosu PDF ve Excel'e girer.

### 6. Çıktılar

- **PDF İndir**: A4 yatay, P&PX antetiyle (DOLFIN, VICO, ENVA, K.SYSTEM). Proje bilgileri, bölümlü liste (her sayfada tablo başlığı, bölüm sayfaya taşınca "(devam)"), ara ve genel toplam, kur notu, notlar, revizyon tablosu; isteğe bağlı özet ve satın alma listesi sayfaları. Belge dili TR / EN / DE (program arayüzü Türkçe kalır; birimler çevrilir). Dosya doğrudan İndirilenler'e iner; sayfalar vektördür, metin seçilip aranır, yazı tipi gömülüdür. **Önizleme** aynı sayfaları gösterir, seçenekler projeyle saklanır.
- **Excel**: üç sayfa (Malzeme Listesi, Satın Alma, Özet). Tutarlar ve toplamlar formüldür (miktar ya da fiyat Excel'de değişince toplam da değişir), başlık satırı dondurulmuş ve her basılı sayfada yinelenir, yatay sayfaya sığdırılmış.
- **CSV**: noktalı virgüllü, ondalık virgüllü (Türkçe Excel doğrudan açar).

### 7. P&PX ile

P&PX aynı tarayıcıda (Chrome / Edge) kullanılıyorsa BOMX onun veritabanını yalnız okur, yazmaz:

- **Komponentler → İçe aktar → P&PX kod listesinden**: `kodlar.json`'daki kodlar (PE01 Ön Yıkama Pompa Motoru…) seriye göre kategoriyle (PE → Pompa, V → Vana, LS → Seviye Sensörü…) ve P&ID kod kataloğundaki açıklamayla kütüphaneye gelir.
- **Yeni Proje → P&PX makine kaydı**: makinedeki kodlar listeye eklenir.

P&PX bu tarayıcıda değilse P&PX projesindeki `P-IDX/ML/kayitlar/kodlar.json` ya da `ML/KODListesi.csv` dosyası **İçe aktar → Dosyadan** ile alınır.

## Kayıt nasıl çalışır

- Her değişiklik önce bu cihazın tarayıcı veritabanına yazılır (0,6 saniye içinde), internet kesilse de kaybolmaz.
- Değişenler en geç 1 dakikada bir, sayfadan çıkarken ve sayfa açılırken tek commit olarak depoya gönderilir. Veritabanı sekmesindeki **Şimdi eşitle** beklemeden gönderir.
- İki bilgisayar aynı anda çalışırsa kütüphane, projeler, şablonlar ve ayarlar **kayıt kayıt birleşir**: biri pompa eklerken öbürü notu değiştirirse ikisi de kalır; aynı kaydı ikisi değiştirdiyse en yeni olan kalır. Açık projeye başka cihazdan gelen değişiklik ekrana yansır; her kayıt da yazılmadan önce veritabanındaki hâlle birleşir, böylece ekranın henüz görmediği değişiklik ezilmez. Program tanımadığı bir dosyayı iki taraf değiştirirse yeni olan asıl dosya olur, eskisi `.catisma-<tarih>` adıyla saklanır (Veritabanı sekmesinde görünür).
- Aynı tarayıcıda iki sekmede açılan proje birbirinin değişikliğini anında alır.
- Silinen kaydın kimliği silinme zamanıyla tutulur: öbür cihazdaki eski kopya silinen kaydı geri getirmez; silmeden sonra yapılan düzenleme ise kaydı korur. Saati geri olan bilgisayarın yeni düzenlemesi de eski bir değere kaybetmez: her değişiklik, kaydın görülmüş en yeni zamanından sonra damgalanır.
- GitHub yanıt vermezse istek 45 saniyede kesilir; kayıt cihazda bekler, sonra kendiliğinden gönderilir.
- Eski bir sürüm GitHub'daki geçmişten alınabilir (**Kayıt geçmişi**). **Yedek indir** tüm veriyi tek JSON dosyasına alır, **Yedekten yükle** var olanı ezmeden ekler.

## Depo düzeni

| Yol | İçerik |
|---|---|
| `BOM/kutuphane/k0.json` … `kf.json` | Komponent kütüphanesi, kimliğe göre 16 parça (bir değişiklik tek parçayı yazar) |
| `BOM/fotograflar/f0.json` … `ff.json` | Komponent fotoğrafları (420 px JPEG), komponent kimliğine göre 16 parça; kütüphane dosyaları küçük kalır |
| `BOM/projeler/<proje>/proje.json` | Proje bilgileri, bölümler, kalemler, revizyon satırları |
| `BOM/projeler/<proje>/revizyon/<rev>.json` | Revizyon yükseltilirken listenin hâli (değişmez) |
| `BOM/sablonlar/<kimlik>.json` | Hazır setler |
| `BOM/ayarlar.json` | Kurlar, para birimleri, kategoriler, birimler, kişiler, varsayılan bölümler |

## Depo sınırları

İstek hızı en çok dakikada birkaç yazma isteğidir (GitHub sınırı dakikada 80, saatte 500); küçük metin dosyaları tek istekte gider. Sınıra takılan kayıt cihazda bekler, sonra kendiliğinden gönderilir. Tek dosya sınırı 100 MB.

## Sınırlar

- **Erişim anahtarı:** Yalnız bu tarayıcıda saklanır, ancak bilgisayarda açtığınız başka bir yerel HTML dosyası da onu okuyabilir. Bu yüzden anahtar yalnız `bomx-veri` deposuna izinli olmalıdır; bilinmeyen HTML dosyalarını bu tarayıcıda açmayın.
- **Özel depo zorunlu:** Herkese açık depoya bağlanılmaz, çünkü müşteri ve fiyat bilgisi içerir.
- **Kurlar** elle girilir (TCMB ya da bankanızın kuru); program internetten kur çekmez.
- **Excel:** eski ikili `.xls` biçimi okunmaz, `.xlsx` ya da CSV kullanın; ERP'lerin `.xls` adıyla verdiği HTML tablosu okunur.
- **HTML raporları ve ürün ağaçları:** tür, kategori, üretici ve üretici kodu addan tahmin edilir; önizlemede gözden geçirin. Aileden ya da üst kompleden alınan fotoğraf temsilidir.
- **Fotoğraf:** komponent başına bir fotoğraf; 300 komponentlik fotoğraflı kütüphane depoda ~6 MB tutar. Fotoğraf değişikliği yalnız ilgili parçayı (`f<hex>.json`) yeniden gönderir.
- Firefox desteklenmez; Chrome veya Edge kullanın. Gizli pencerede tarayıcı veritabanı kapandığı için çalışmaz.

## Klasörler

| Yol | İçerik |
|---|---|
| `index.html` | Program: kurulum, ana ekran, düzenleyici |
| `ortak/` | Veritabanı (`bomx-db.js`), GitHub bağlantısı (`bomx-github.js`), açılış (`bomx-boot.js`); P&PX ortak katmanından türetildi |
| `codes/model.js` | İş kuralları: toplam, kontrol, birleştirme, CSV (tarayıcıya bağlı değil) |
| `codes/store.js` | Depodaki dosya düzeni |
| `codes/xlsx.js` | Excel yazma ve okuma |
| `codes/reports.js` | HTML raporlarından ve ERP ürün ağacından komponent ve fotoğraf çıkarma, elektrik sınıflandırması (tarayıcıya bağlı değil) |
| `codes/ui/` | Ekranlar; `grid.js` kütüphane ve içe aktarma önizlemesindeki düzenlenebilir tablo |
| `codes/pdf/` | P&PX'in vektörel PDF motoru, gömülü yazı tipi ve logolar |
| `assets/` | Logolar, yazı tipleri (Selawik, SIL Open Font License) |
| `tools/build-assets.js` | `codes/pdf/fonts.js` ve `logos.js` dosyalarını üretir |
| `tools/rapor-aktar.js` | Raporlardan ve ürün ağaçlarından fotoğraflı komponent paketi üretir |
| `BOMX elektrik komponentleri.json` | Hazır komponent paketi: raporlardaki elektrikli parçalar, redüktörler ve elektrikli kompleler, fotoğraflarıyla (şirket verisi; Kütüphane → İçe aktar → Dosyadan) |
| `test/` | Testler |

Örnek alınan P&PX projesi BOMX'in yanındaki `P&PX/` klasöründedir (yalnız başvuru; program kullanmaz, PDF motoru testi onunla karşılaştırır).

## Test

Yalnız geliştirme için Node.js gerekir:

```
npm test
```

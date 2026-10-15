# Kalla Office denetçisi

Kalla Office'i yeni bir sürüm çıkmadan önce (ya da istediğiniz zaman) baştan sona denetler
ve sonucu bir rapora yazar. Tamamen bilgisayarınızda çalışır; kod incelemesi için yerel
yapay zekâ modeli (Ollama) kullanır, internete kod göndermez.

| Adım | Ne yapar | Yapay zekâ mı? |
|---|---|---|
| **Derleme** | `npm run build` çalışır mı, dört sayfa da derlemede var mı, boyut birden şişti mi | Hayır |
| **Uygulama testi** | Gerçek tarayıcıda Belge, Sunum, Notlar ve ana ekranı açar; yazar, biçimlendirir, geri alır, kaydeder, tekrar açar; sunumu başlatır; notun sayfa yenilenince durduğunu kontrol eder; masaüstü, tablet ve telefon boyutunda ekrana sığmayan öğe ve konsol hatası arar; 100 sayfalık belgede tuş gecikmesini ölçer | Hayır |
| **Word/PowerPoint uyumu** | `ornekler/` klasöründeki her .docx/.pptx dosyasını uygulamada açıp kaydeder, orijinaliyle karşılaştırır (metin, başlık, liste, tablo, resim, bağlantı, dipnot, sütun, kalın/italik, slayt, konuşmacı notu). İkinci kez açıp kaydederek kayma olup olmadığını da ölçer | Hayır |
| **Kod incelemesi** | Son sürümden beri değişen kodu yerel modele okutur; veri kaybı, yakalanmayan hata, güvenlik, sızıntı ve mantık hatası arar | Evet (Ollama) |
| **Sürüm kontrolleri** (`--surum`) | Sürüm numarası daha önce yayınlanmış mı, en yeniden büyük mü, commit edilmemiş/gönderilmemiş kod var mı, Android versionCode/versionName uygun mu, otomatik güncelleme yayın ayarı doğru depoyu gösteriyor mu | Hayır |

İlk dört adım kesin kontrollerdir: geçti/kaldı kararı bunlara dayanır. Yapay zekâ
bulguları **uyarıdır**; küçük yerel modeller yanılabilir. Uydurmayı azaltmak için model
her bulguda koddan alıntı yapmak zorundadır ve alıntı değişen satırlarda birebir
bulunamazsa bulgu atılır.

## Kurulum (bir kez)

1. Bu `denetim` klasörünü Kalla Office proje klasörünün köküne kopyalayın
   (`package.json`'ın yanına).
2. Proje klasöründe:

   ```powershell
   cd denetim
   npm install
   npx playwright install chromium
   ```

3. Kod incelemesi için [Ollama](https://ollama.com/download)'yı kurun ve modeli indirin
   (RTX 4060 / 8 GB için uygun):

   ```powershell
   ollama pull qwen2.5-coder:7b
   ```

   Ollama kurulu değilse kod incelemesi atlanır, diğer adımlar yine çalışır.

4. `denetim/` klasörünü git'e ekleyin. `raporlar/`, `.onbellek/` ve `node_modules/`
   kendi `.gitignore`'u sayesinde eklenmez.

5. electron-builder'ın `files` ayarı her şeyi (`**/*`) paketliyorsa `"!denetim/**"`
   ekleyin ki denetçi .exe'nin içine girmesin.

## Kullanım

Proje klasöründe:

```powershell
node denetim/denetle.mjs            # tam denetim
node denetim/denetle.mjs --surum    # sürüm öncesi kapı
```

Sürüm çıkarırken yayın komutunuzun önüne koyun; kapı kapalıysa yayın başlamaz:

```powershell
node denetim/denetle.mjs --surum && npm run <yayın-komutunuz>
```

Diğer seçenekler:

| Seçenek | Açıklama |
|---|---|
| `--sadece uygulama,office` | Yalnızca bu adımlar (`derleme`, `uygulama`, `office`, `inceleme`) |
| `--atla inceleme` | Bu adımları atla |
| `--dist KLASOR` | Derlemeyi atla, hazır derlenmiş klasörü denetle |
| `--temel HEAD~3` | Kod incelemesinde karşılaştırma noktası (varsayılan: son `v*` etiketi, yoksa son commit) |
| `--goster` | Tarayıcıyı görünür aç, testleri izle |

Rapor `denetim/raporlar/<tarih>/rapor.md` dosyasına yazılır (VS Code'da önizleme ile açın).
Yanında ekran görüntüleri (`ekran/`) ve testte kaydedilen Word/PowerPoint dosyaları
(`dosyalar/`) durur; bir uyum sorunu varsa bu dosyaları Word'de açıp bakabilirsiniz.

Çıkış kodu: `0` geçti, `1` kaldı (ya da sürüm kapısı kapalı), `2` denetçi çalışamadı.

## Kendi Word/PowerPoint dosyalarınız

`ornekler/` klasöründeki dosyalar bir kütüphaneyle üretildi (`node ornekler/olustur.mjs`).
Gerçek uyumu ölçmek için **Word ve PowerPoint'te hazırlanmış** dosyalarınızı (ödev,
tez, sunum...) bu klasöre koyun ya da `denetim.config.json`'daki `office.ekKlasorler`
listesine bir klasör ekleyin. Denetçi oradaki her dosyayı test eder.

## Ayarlar

`denetim.config.json` varsayılanları içerir. Yalnızca kendi bilgisayarınıza özel
değişiklikler için yanına `denetim.local.json` koyabilirsiniz (git'e eklenmez), ör.:

```json
{ "inceleme": { "model": "qwen2.5-coder:3b", "numCtx": 8192 } }
```

Önemli ayarlar:

- `derleme.komut` / `derleme.klasor`: derleme komutu ve çıktı klasörü (`npm run build`, `dist`)
- `uygulama.tusGecikmesiUyariMs`: büyük belgede tuş başına kabul edilen ek gecikme
- `office.esik`: metin benzerliği bunun altına düşerse hata (varsayılan %98)
- `inceleme.kritikHataSayilir`: `true` yapılırsa modelin "kritik" bulgusu sürümü durdurur
  (varsayılan `false`: model yanılabileceği için yalnızca uyarı)
- `inceleme.maxParca`: bir denetimde modele gönderilecek en fazla kod parçası
- `surum.uzakDepo`: yayınlanmış sürüm etiketlerinin okunduğu depo

## Sınırlar

- Testler uygulamanın web katmanını tarayıcıda çalıştırır. Electron'un ana süreci
  (pencere, yerel kaydet/aç pencereleri, otomatik güncelleme) ve Android'e özgü
  kısımlar (Capacitor eklentileri, dosya izinleri) bu testlerin dışında kalır.
- Testler uygulamanın `window.kallaEditor`, `window.kallaSunum`, `window.kallaNotes`
  erişim noktalarını ve `#file-menu-btn`, `#new-note` gibi kimlikleri kullanır. Bunlar
  değişirse ilgili test "yarıda kaldı" diye raporlanır; `lib/uygulama.mjs`'i güncelleyin.
- Hız ölçümleri makineye bağlıdır; ilk birkaç denetimin sonucuna göre eşikleri ayarlayın.

## Geliştirme

```powershell
cd denetim
npm test                      # denetçinin kendi testleri (Ollama gerekmez)
node ornekler/olustur.mjs     # örnek dosyaları yeniden üret
```

| Dosya | Görev |
|---|---|
| `denetle.mjs` | Komut satırı, adımların sırası, sürüm kapısı kararı |
| `lib/derleme.mjs` | Derleme ve boyut kontrolü |
| `lib/uygulama.mjs` | Tarayıcı senaryoları |
| `lib/office.mjs` | Aç-kaydet-karşılaştır döngüsü |
| `lib/ooxml.mjs` | .docx/.pptx özetleme ve karşılaştırma |
| `lib/inceleme.mjs` | git diff → Ollama → kanıt doğrulama → önbellek |
| `lib/surum.mjs` | Sürüm öncesi kontroller |
| `lib/rapor.mjs` | Markdown rapor ve konsol özeti |

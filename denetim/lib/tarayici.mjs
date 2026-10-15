// Tarayıcıyı açar, sayfalardaki hataları toplar. Uygulama ve Office adımları ortak kullanır.
import { chromium, devices } from 'playwright';

export const GORUNUMLER = {
  masaustu: { viewport: { width: 1400, height: 900 } },
  telefon: { ...devices['Pixel 7'] },
  tablet: { ...devices['Galaxy Tab S4'] },
};

export async function tarayiciAc({ goster = false } = {}) {
  try {
    return await chromium.launch({ headless: !goster });
  } catch (hata) {
    if (/Executable doesn't exist|playwright install/i.test(hata.message)) {
      throw new Error('Chromium kurulu değil. Bir kez şunu çalıştırın: npx playwright install chromium', {
        cause: hata,
      });
    }
    throw hata;
  }
}

/**
 * Yeni bir bağlam + sayfa açar. Uygulamanın dışına giden istekler (ör. GitHub güncelleme
 * kontrolü) engellenir ki test internete bağlı olmasın. Dönen `hatalar` dizisi sayfa
 * hatalarını, console.error'ları ve yüklenemeyen yerel dosyaları biriktirir.
 */
export async function sayfaAc(tarayici, adres, gorunum = 'masaustu', { yoksay = [] } = {}) {
  const baglam = await tarayici.newContext({ ...GORUNUMLER[gorunum], acceptDownloads: true, locale: 'tr-TR' });
  const yerel = new URL(adres).origin;
  await baglam.route(
    (url) => url.origin !== yerel && /^https?:$/.test(url.protocol),
    (route) => route.abort('blockedbyclient'),
  );
  const sayfa = await baglam.newPage();
  const hatalar = [];
  const yoksayRe = yoksay.map((d) => new RegExp(d, 'i'));
  const ekle = (tur, mesaj) => {
    if (!yoksayRe.some((re) => re.test(mesaj))) hatalar.push({ tur, mesaj: mesaj.slice(0, 500) });
  };
  sayfa.on('pageerror', (h) => ekle('sayfa hatası', `${h.message}${h.stack ? '\n' + h.stack.split('\n')[1] : ''}`));
  sayfa.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Engellediğimiz dış isteklerin hata mesajları beklenen durumdur.
    const kaynak = m.location()?.url || '';
    if (kaynak && !kaynak.startsWith(yerel)) return;
    if (/ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(m.text())) return;
    ekle('console.error', m.text());
  });
  sayfa.on('requestfailed', (r) => {
    if (r.url().startsWith(yerel)) ekle('yüklenemedi', `${r.url().slice(yerel.length)} (${r.failure()?.errorText})`);
  });
  sayfa.on('response', (r) => {
    if (r.url().startsWith(yerel) && r.status() >= 400) ekle('yüklenemedi', `${r.url().slice(yerel.length)} (${r.status()})`);
  });
  return { baglam, sayfa, hatalar };
}

/**
 * Uygulamanın hazır olmasını bekler. hedef: window'daki test erişim noktasının adı
 * (ör. "kallaEditor") ya da "#seçici"/".seçici". Uygulamanın CSP'si metin olarak verilen
 * ifadelerin çalıştırılmasını (eval) engellediği için koşul fonksiyon olarak gönderilir.
 */
export async function hazirBekle(sayfa, hedef, zamanAsimi = 15_000) {
  await sayfa.waitForFunction(
    (h) => (/^[#.]/.test(h) ? !!document.querySelector(h) : !!window[h]) && document.readyState === 'complete',
    hedef,
    { timeout: zamanAsimi },
  );
}

/**
 * Dosya seçiciyi açıp verilen dosyayı yükler. Önce Ctrl+O denenir; uygulama yoğunken
 * kısayollar sayfa açıldıktan biraz sonra bağlanabildiği için bir kez daha denenir,
 * yine olmazsa Dosya menüsündeki "Aç…" kullanılır. Hangi yolun işe yaradığını döndürür.
 */
export async function dosyaAc(sayfa, dosyaYolu) {
  const bekle = (ms) => sayfa.waitForEvent('filechooser', { timeout: ms }).catch(() => null);
  for (const ms of [4000, 4000]) {
    const secici = bekle(ms);
    await sayfa.keyboard.press('Control+o');
    const s = await secici;
    if (s) {
      await s.setFiles(dosyaYolu);
      return 'kisayol';
    }
  }
  const secici = bekle(10_000);
  await sayfa.click('#file-menu-btn');
  await sayfa.locator('#file-menu').getByText('Aç…', { exact: false }).first().click();
  const s = await secici;
  if (!s) throw new Error('Dosya seçici ne Ctrl+O ile ne de Dosya > Aç… ile açıldı');
  await s.setFiles(dosyaYolu);
  return 'menu';
}

/** Ctrl+S ile kaydeder; indirilen dosyanın baytlarını döndürür. */
export async function kaydetIndir(sayfa, hedefYol, tus = 'Control+s') {
  const indirme = sayfa.waitForEvent('download', { timeout: 20_000 });
  await sayfa.keyboard.press(tus);
  const d = await indirme;
  await d.saveAs(hedefYol);
  return { ad: d.suggestedFilename(), yol: hedefYol };
}

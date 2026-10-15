// 5. adım (yalnızca --surum ile): yeni .exe/.apk yayınlamadan önce son kontroller.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adimSonucu, git } from './ortak.mjs';

/** "0.4.2" → [0,4,2]; karşılaştırma için. Ön ek "v" atılır, ek kısım (-beta) yok sayılır. */
const parcala = (s) => s.replace(/^v/, '').split(/[-+]/)[0].split('.').map((x) => Number(x) || 0);
export function surumKarsilastir(a, b) {
  const x = parcala(a);
  const y = parcala(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const fark = (x[i] || 0) - (y[i] || 0);
    if (fark) return Math.sign(fark);
  }
  return 0;
}

export async function surumAdimi({ kok, ayar }) {
  const bulgular = [];
  let versionCode = null;
  const paketYolu = join(kok, 'package.json');
  if (!existsSync(paketYolu)) {
    bulgular.push({ onem: 'hata', mesaj: `package.json bulunamadı: ${paketYolu}` });
    return adimSonucu('surum', 'Sürüm öncesi kontroller', bulgular);
  }
  const paket = JSON.parse(await readFile(paketYolu, 'utf8'));
  const surum = paket.version;
  bulgular.push({ onem: 'bilgi', mesaj: `Yayınlanacak sürüm: ${surum}` });

  // Git: kaydedilmemiş değişiklik, gönderilmemiş commit
  const durum = await git(['status', '--porcelain'], kok);
  if (durum == null) {
    bulgular.push({ onem: 'uyari', mesaj: 'Proje bir git deposu değil; sürüm geçmişi kontrol edilemedi' });
  } else {
    const kirli = durum.split('\n').filter((s) => s.trim() && !/denetim\/(raporlar|\.onbellek)\//.test(s));
    if (kirli.length && ayar.surum.temizCalismaAgaci)
      bulgular.push({
        onem: 'hata',
        mesaj: `${kirli.length} dosyada commit edilmemiş değişiklik var; sürüm commit edilmiş koddan çıkmalı`,
        ayrinti: kirli.slice(0, 15).join('\n'),
      });
    const ileride = await git(['rev-list', '--count', '@{upstream}..HEAD'], kok);
    if (ileride && Number(ileride) > 0)
      bulgular.push({
        onem: 'uyari',
        mesaj: `${ileride} commit GitHub'a gönderilmemiş; bilgisayar bozulursa bu kod kaybolur (git push)`,
      });
    else if (ileride == null)
      bulgular.push({ onem: 'uyari', mesaj: 'Dalın GitHub karşılığı yok; kaynak kodun yedeği alınmıyor' });

    // Etiketler: yerel + (ulaşılabiliyorsa) uzak depo
    const yerel = ((await git(['tag', '--list', 'v*'], kok)) || '').split('\n').filter(Boolean);
    const uzakCikti = await git(['ls-remote', '--tags', '--refs', ayar.surum.uzakDepo], kok);
    const uzak = (uzakCikti || '')
      .split('\n')
      .map((s) => s.split('refs/tags/')[1])
      .filter((t) => t && t.startsWith('v'));
    if (uzakCikti == null)
      bulgular.push({ onem: 'uyari', mesaj: `Yayın deposuna (${ayar.surum.uzakDepo}) ulaşılamadı; etiketler yalnızca yerelde kontrol edildi` });
    const etiketler = [...new Set([...yerel, ...uzak])];
    if (etiketler.includes(`v${surum}`))
      bulgular.push({ onem: 'hata', mesaj: `v${surum} zaten yayınlanmış; package.json'daki sürümü artırın` });
    const enYeni = etiketler.sort(surumKarsilastir).at(-1);
    if (enYeni && surumKarsilastir(surum, enYeni) <= 0 && !etiketler.includes(`v${surum}`))
      bulgular.push({ onem: 'hata', mesaj: `Sürüm ${surum}, yayınlanmış en yeni sürümden (${enYeni}) büyük değil; güncelleme bulunamaz` });
    else if (enYeni) bulgular.push({ onem: 'bilgi', mesaj: `Son yayınlanan: ${enYeni}` });
  }

  // Android: versionName package.json ile aynı olmalı, versionCode artmalı.
  const gradle = join(kok, 'android', 'app', 'build.gradle');
  if (existsSync(gradle)) {
    const g = await readFile(gradle, 'utf8');
    const ad = g.match(/versionName\s+["']([^"']+)["']/)?.[1];
    const kod = g.match(/versionCode\s+(\d+)/)?.[1];
    if (ad && ad !== surum)
      bulgular.push({
        onem: 'uyari',
        mesaj: `Android versionName "${ad}", package.json "${surum}"; tablette Ayarlar > Uygulamalar'da eski sürüm görünür`,
      });
    if (kod) {
      versionCode = Number(kod);
      // Son başarılı sürüm denetiminde kaydedilen değer (aynı sürüm tekrar denetleniyorsa karşılaştırılmaz).
      let onceki = null;
      try {
        const kayit = JSON.parse(await readFile(ayar.durumDosyasi, 'utf8'));
        if (kayit.androidSurum !== surum) onceki = kayit.androidVersionCode ?? null;
      } catch {
        // ilk kayıt
      }
      if (onceki != null && versionCode < onceki)
        bulgular.push({
          onem: 'hata',
          mesaj: `Android versionCode ${kod}, önceki sürümdeki ${onceki} değerinden küçük; tablet APK'yı güncelleme olarak kurmaz`,
        });
      else if (onceki != null && versionCode === onceki)
        bulgular.push({ onem: 'uyari', mesaj: `Android versionCode ${kod} önceki sürümle aynı; artırmanız önerilir` });
      else bulgular.push({ onem: 'bilgi', mesaj: `Android versionCode ${kod}` });
    }
  } else {
    bulgular.push({ onem: 'bilgi', mesaj: 'android/app/build.gradle yok; Android sürüm kontrolü atlandı' });
  }

  // Otomatik güncelleme yayın ayarı (electron-builder)
  const yayin = JSON.stringify(paket.build?.publish ?? '');
  const ebYml = ['electron-builder.yml', 'electron-builder.yaml', 'electron-builder.json']
    .map((d) => join(kok, d))
    .find(existsSync);
  const ebMetni = ebYml ? await readFile(ebYml, 'utf8') : '';
  if (!(yayin + ebMetni).includes(ayar.surum.yayinDeposuAdi))
    bulgular.push({
      onem: 'uyari',
      mesaj: `electron-builder yayın ayarında "${ayar.surum.yayinDeposuAdi}" bulunamadı; masaüstü otomatik güncelleme yeni sürümü görmeyebilir`,
    });

  return adimSonucu('surum', 'Sürüm öncesi kontroller', bulgular, { surum, androidVersionCode: versionCode });
}

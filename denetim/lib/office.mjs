// 3. adım: Word/PowerPoint uyumu. Her örnek dosya uygulamada açılır, kaydedilir ve
// orijinaliyle karşılaştırılır. Kaydedilen dosya bir kez daha açılıp kaydedilerek
// tekrar tekrar kaydetmede bozulma (kayma) olup olmadığı da ölçülür.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { dosyaOzet, karsilastir } from './ooxml.mjs';
import { adimSonucu } from './ortak.mjs';
import { dosyaAc, hazirBekle, kaydetIndir, sayfaAc } from './tarayici.mjs';

const UYGULAMA = {
  docx: { yol: 'yazi.html?template=bos', hazir: 'kallaEditor' },
  pptx: { yol: 'sunum.html?new=1', hazir: 'kallaSunum' },
};

async function acKaydet(tarayici, adres, ayar, tur, dosyaYolu, hedefYol) {
  const { baglam, sayfa, hatalar } = await sayfaAc(tarayici, adres, 'masaustu', ayar.uygulama);
  try {
    await sayfa.goto(`${adres}/${UYGULAMA[tur].yol}`);
    await hazirBekle(sayfa, UYGULAMA[tur].hazir);
    await dosyaAc(sayfa, dosyaYolu);
    // Dosya adı başlığa yansıyınca açılmış demektir.
    const ad = basename(dosyaYolu).replace(/\.(docx|pptx)$/i, '');
    await sayfa
      .waitForFunction((a) => document.getElementById('doc-title')?.textContent.includes(a), ad, { timeout: 15_000 })
      .catch(() => {});
    await sayfa.waitForTimeout(500);
    await kaydetIndir(sayfa, hedefYol);
    return { hatalar };
  } finally {
    await baglam.close();
  }
}

async function ornekleriBul(klasorler) {
  const dosyalar = [];
  for (const klasor of klasorler) {
    if (!existsSync(klasor)) continue;
    for (const ad of (await readdir(klasor)).sort()) {
      if (/\.(docx|pptx)$/i.test(ad) && !ad.startsWith('~$')) dosyalar.push(join(klasor, ad));
    }
  }
  return dosyalar;
}

export async function officeAdimi({ tarayici, adres, ayar, ornekKlasorleri, gecici }) {
  const bulgular = [];
  const dosyalar = await ornekleriBul(ornekKlasorleri);
  if (!dosyalar.length) {
    bulgular.push({ onem: 'uyari', mesaj: `Örnek .docx/.pptx bulunamadı: ${ornekKlasorleri.join(', ')}` });
    return adimSonucu('office', 'Word/PowerPoint uyumu', bulgular);
  }
  const tablo = [];
  for (const [i, dosya] of dosyalar.entries()) {
    const ad = basename(dosya);
    const tur = ad.toLowerCase().endsWith('.pptx') ? 'pptx' : 'docx';
    const alt = [];
    let benzerlik = null;
    try {
      const once = await dosyaOzet(ad, await readFile(dosya));
      const kayit1 = join(gecici, `${i}-1.${tur}`);
      const kayit2 = join(gecici, `${i}-2.${tur}`);
      const ilk = await acKaydet(tarayici, adres, ayar, tur, dosya, kayit1);
      for (const h of ilk.hatalar) alt.push({ onem: 'hata', mesaj: `açarken ${h.tur}: ${h.mesaj}` });
      const sonra = await dosyaOzet(ad, await readFile(kayit1));
      const k1 = karsilastir(once, sonra, { esik: ayar.office.esik });
      benzerlik = k1.benzerlik;
      alt.push(...k1.sorunlar);

      // İkinci tur: kaydedileni yeniden aç-kaydet; ikisi arasında fark olmamalı.
      const ikinci = await acKaydet(tarayici, adres, ayar, tur, kayit1, kayit2);
      for (const h of ikinci.hatalar) alt.push({ onem: 'hata', mesaj: `2. açılışta ${h.tur}: ${h.mesaj}` });
      const sonra2 = await dosyaOzet(ad, await readFile(kayit2));
      const k2 = karsilastir(sonra, sonra2, { esik: 0.999 });
      for (const s of k2.sorunlar) alt.push({ onem: 'uyari', mesaj: `2. kaydetmede değişti: ${s.mesaj}` });
    } catch (h) {
      alt.push({ onem: 'hata', mesaj: `Test yapılamadı: ${h.message.split('\n')[0]}` });
    }
    const hataVar = alt.some((b) => b.onem === 'hata');
    tablo.push({ ad, benzerlik, durum: hataVar ? 'kaldi' : alt.length ? 'uyari' : 'gecti' });
    bulgular.push({
      onem: hataVar ? 'hata' : alt.length ? 'uyari' : 'bilgi',
      mesaj: `${hataVar ? 'KALDI' : 'geçti'}: ${ad}${benzerlik != null ? ` (metin %${(benzerlik * 100).toFixed(1)} aynı)` : ''}`,
      alt,
    });
  }
  return adimSonucu('office', 'Word/PowerPoint uyumu', bulgular, { tablo });
}

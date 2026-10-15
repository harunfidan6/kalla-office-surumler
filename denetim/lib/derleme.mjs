// 1. adım: uygulamayı derler, çıktının eksiksiz olduğunu ve boyutunu kontrol eder.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adimSonucu, komutCalistir, sonSatirlar } from './ortak.mjs';

async function klasorBoyutu(klasor) {
  let toplam = 0;
  for (const g of await readdir(klasor, { withFileTypes: true, recursive: true })) {
    if (g.isFile()) toplam += (await stat(join(g.parentPath ?? g.path, g.name))).size;
  }
  return toplam;
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

/**
 * ayar.derleme: { komut, klasor, sayfalar, boyutArtisUyari }
 * hazirDist verilirse derleme atlanır, o klasör denetlenir.
 */
export async function derlemeAdimi({ kok, ayar, hazirDist, durumDosyasi }) {
  const bulgular = [];
  const dist = hazirDist || join(kok, ayar.derleme.klasor);
  let sure = 0;

  if (hazirDist) {
    bulgular.push({ onem: 'bilgi', mesaj: `Derleme atlandı, hazır klasör kullanılıyor: ${hazirDist}` });
  } else {
    const basla = Date.now();
    const { kod, cikti } = await komutCalistir(ayar.derleme.komut, { cwd: kok });
    sure = Date.now() - basla;
    if (kod !== 0) {
      bulgular.push({
        onem: 'hata',
        mesaj: `"${ayar.derleme.komut}" başarısız oldu (çıkış kodu ${kod})`,
        ayrinti: sonSatirlar(cikti, 40),
      });
      return adimSonucu('derleme', 'Derleme', bulgular, { dist: null });
    }
    bulgular.push({ onem: 'bilgi', mesaj: `"${ayar.derleme.komut}" ${(sure / 1000).toFixed(1)} saniyede bitti` });
    if (/\bwarn(ing)?\b|uyarı|\(!\)/i.test(cikti)) {
      const uyarilar = cikti.split('\n').filter((s) => /\bwarn(ing)?\b|uyarı|\(!\)/i.test(s));
      bulgular.push({
        onem: 'uyari',
        mesaj: `Derleme ${uyarilar.length} uyarı satırı yazdı`,
        ayrinti: uyarilar.slice(0, 15).join('\n'),
      });
    }
  }

  if (!existsSync(dist)) {
    bulgular.push({ onem: 'hata', mesaj: `Derleme klasörü yok: ${dist}` });
    return adimSonucu('derleme', 'Derleme', bulgular, { dist: null });
  }
  for (const sayfa of ayar.derleme.sayfalar) {
    if (!existsSync(join(dist, sayfa))) bulgular.push({ onem: 'hata', mesaj: `Derlemede ${sayfa} eksik` });
  }

  // Boyut: bir önceki denetime göre ani büyüme, yanlışlıkla paketlenen büyük bir dosyanın işareti olabilir.
  const boyut = await klasorBoyutu(dist);
  let onceki = null;
  try {
    onceki = JSON.parse(await readFile(durumDosyasi, 'utf8')).distBoyutu ?? null;
  } catch {
    // ilk çalıştırma
  }
  const artis = onceki ? (boyut - onceki) / onceki : 0;
  if (onceki && artis > ayar.derleme.boyutArtisUyari) {
    bulgular.push({
      onem: 'uyari',
      mesaj: `Derleme boyutu ${mb(onceki)} → ${mb(boyut)} (%${(artis * 100).toFixed(0)} arttı)`,
    });
  } else {
    bulgular.push({ onem: 'bilgi', mesaj: `Derleme boyutu ${mb(boyut)}${onceki ? ` (önceki ${mb(onceki)})` : ''}` });
  }
  if (!hazirDist) {
    let durum = {};
    try {
      durum = JSON.parse(await readFile(durumDosyasi, 'utf8'));
    } catch {
      // yeni dosya
    }
    await writeFile(durumDosyasi, JSON.stringify({ ...durum, distBoyutu: boyut }, null, 2));
  }
  return adimSonucu('derleme', 'Derleme', bulgular, { dist });
}

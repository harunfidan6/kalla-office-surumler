#!/usr/bin/env node
// Kalla Office denetçisi. Kullanım için: node denetim/denetle.mjs --yardim
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { derlemeAdimi } from './lib/derleme.mjs';
import { incelemeAdimi } from './lib/inceleme.mjs';
import { officeAdimi } from './lib/office.mjs';
import { atlandi, git } from './lib/ortak.mjs';
import { genelSonuc, konsolOzet, raporYaz } from './lib/rapor.mjs';
import { sunucuBaslat } from './lib/sunucu.mjs';
import { surumAdimi } from './lib/surum.mjs';
import { tarayiciAc } from './lib/tarayici.mjs';
import { uygulamaAdimi } from './lib/uygulama.mjs';

const BURASI = dirname(fileURLToPath(import.meta.url));
const ADIMLAR = ['derleme', 'uygulama', 'office', 'inceleme'];

const YARDIM = `Kalla Office denetçisi

Kullanım:  node denetim/denetle.mjs [seçenekler]

  (seçeneksiz)        Derle, uygulamayı test et, Word/PowerPoint uyumunu ölç, kodu yerel modelle incele
  --surum             Sürüm öncesi kapı: her şey + sürüm kontrolleri; bir sorun varsa çıkış kodu 1
  --sadece a,b        Yalnızca bu adımlar (derleme, uygulama, office, inceleme)
  --atla a,b          Bu adımları atla
  --dist KLASOR       Derlemeyi atla, hazır derlenmiş klasörü denetle
  --temel REF         Kod incelemesinde karşılaştırma noktası (ör. HEAD~3, v0.4.2). Varsayılan: son sürüm etiketi
  --proje KLASOR      Kalla Office proje klasörü (varsayılan: denetim klasörünün bir üstü)
  --goster            Tarayıcıyı görünür aç (testleri izlemek için)
  --yardim            Bu yardım

Rapor: denetim/raporlar/<tarih>/rapor.md`;

function birlestir(hedef, kaynak) {
  for (const [k, v] of Object.entries(kaynak || {})) {
    hedef[k] = v && typeof v === 'object' && !Array.isArray(v) ? birlestir({ ...(hedef[k] || {}) }, v) : v;
  }
  return hedef;
}

const zaman = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

async function main() {
  const { values: secenek } = parseArgs({
    options: {
      surum: { type: 'boolean', default: false },
      sadece: { type: 'string' },
      atla: { type: 'string' },
      dist: { type: 'string' },
      temel: { type: 'string' },
      proje: { type: 'string' },
      goster: { type: 'boolean', default: false },
      yardim: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (secenek.yardim) {
    console.log(YARDIM);
    return 0;
  }

  const ayar = JSON.parse(await readFile(join(BURASI, 'denetim.config.json'), 'utf8'));
  const yerelAyar = join(BURASI, 'denetim.local.json');
  if (existsSync(yerelAyar)) birlestir(ayar, JSON.parse(await readFile(yerelAyar, 'utf8')));
  const kok = resolve(secenek.proje || resolve(BURASI, ayar.proje));
  const onbellek = join(BURASI, '.onbellek');
  const durumDosyasi = join(onbellek, 'durum.json');
  ayar.durumDosyasi = durumDosyasi;
  await mkdir(onbellek, { recursive: true });

  const liste = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);
  const bilinmeyen = [...(liste(secenek.sadece) || []), ...(liste(secenek.atla) || [])].filter((a) => !ADIMLAR.includes(a));
  if (bilinmeyen.length) {
    console.error(`Bilinmeyen adım: ${bilinmeyen.join(', ')}. Adımlar: ${ADIMLAR.join(', ')}`);
    return 2;
  }
  const secili = new Set(liste(secenek.sadece) || ADIMLAR);
  for (const a of liste(secenek.atla) || []) secili.delete(a);
  if (secenek.dist) secili.delete('derleme');

  const raporKlasoru = join(BURASI, 'raporlar', zaman());
  const ekranKlasoru = join(raporKlasoru, 'ekran');
  const gecici = join(raporKlasoru, 'dosyalar');
  await mkdir(ekranKlasoru, { recursive: true });
  await mkdir(gecici, { recursive: true });

  const basla = Date.now();
  const commit = (await git(['log', '-1', '--format=%h %s'], kok)) || '-';
  let surum = '-';
  try {
    surum = JSON.parse(await readFile(join(kok, 'package.json'), 'utf8')).version;
  } catch {
    // package.json yok
  }
  console.log(`Kalla Office denetimi${secenek.surum ? ' (SÜRÜM ÖNCESİ)' : ''} — proje: ${kok}\n`);

  const adimlar = [];
  const zamanla = async (ad, fn) => {
    console.log(`▶ ${ad}...`);
    const t = Date.now();
    const sonuc = await fn();
    sonuc.sure = ((Date.now() - t) / 1000).toFixed(1);
    adimlar.push(sonuc);
    return sonuc;
  };

  // 1. Derleme
  let dist = secenek.dist ? resolve(secenek.dist) : null;
  if (secili.has('derleme')) {
    const d = await zamanla('Derleme', () => derlemeAdimi({ kok, ayar, durumDosyasi }));
    dist = d.dist;
  } else if (!dist && (secili.has('uygulama') || secili.has('office'))) {
    dist = join(kok, ayar.derleme.klasor);
    if (!existsSync(dist)) dist = null;
  }

  // 2-3. Tarayıcı adımları
  const tarayiciGerek = secili.has('uygulama') || secili.has('office');
  if (tarayiciGerek && !dist) {
    const neden = 'Derlenmiş uygulama yok (derleme başarısız ya da dist klasörü bulunamadı)';
    if (secili.has('uygulama')) adimlar.push(atlandi('uygulama', 'Uygulamayı kullanarak test', neden));
    if (secili.has('office')) adimlar.push(atlandi('office', 'Word/PowerPoint uyumu', neden));
  } else if (tarayiciGerek) {
    const sunucu = await sunucuBaslat(dist);
    let tarayici;
    try {
      tarayici = await tarayiciAc({ goster: secenek.goster });
      if (secili.has('uygulama'))
        await zamanla('Uygulama testi', () => uygulamaAdimi({ tarayici, adres: sunucu.adres, ayar, ekranKlasoru, gecici }));
      if (secili.has('office')) {
        const ornekKlasorleri = [join(BURASI, 'ornekler'), ...ayar.office.ekKlasorler.map((k) => resolve(kok, k))];
        await zamanla('Word/PowerPoint uyumu', () =>
          officeAdimi({ tarayici, adres: sunucu.adres, ayar, ornekKlasorleri, gecici }),
        );
      }
    } catch (h) {
      adimlar.push({
        ad: 'tarayici',
        baslik: 'Tarayıcı',
        durum: 'kaldi',
        bulgular: [{ onem: 'hata', mesaj: h.message }],
      });
    } finally {
      await tarayici?.close();
      await sunucu.kapat();
    }
  }

  // 4. Kod incelemesi
  if (secili.has('inceleme')) {
    await zamanla('Kod incelemesi (yerel model)', () =>
      incelemeAdimi({
        kok,
        ayar,
        temelRef: secenek.temel,
        onbellekDosyasi: join(onbellek, 'inceleme.json'),
        ilerleme: (m) => console.log(m),
      }),
    );
  }

  // 5. Sürüm kapısı
  let kapi = null;
  if (secenek.surum) {
    const s = await zamanla('Sürüm kontrolleri', () => surumAdimi({ kok, ayar }));
    const eksik = ['derleme', 'uygulama', 'office'].filter(
      (a) => !adimlar.some((x) => x.ad === a && x.durum !== 'atlandi') && !(a === 'derleme' && secenek.dist),
    );
    const kalan = adimlar.filter((a) => a.durum === 'kaldi').map((a) => a.baslik);
    kapi = { acik: !kalan.length && !eksik.length, neden: '' };
    if (kalan.length) kapi.neden = `kalan adımlar: ${kalan.join(', ')}`;
    else if (eksik.length) kapi.neden = `sürüm öncesinde çalışması gereken adımlar atlandı: ${eksik.join(', ')}`;
    if (kapi.acik && s.androidVersionCode != null) {
      let durum = {};
      try {
        durum = JSON.parse(await readFile(durumDosyasi, 'utf8'));
      } catch {
        // yeni
      }
      await writeFile(
        durumDosyasi,
        JSON.stringify({ ...durum, androidVersionCode: s.androidVersionCode, androidSurum: s.surum }, null, 2),
      );
    }
  }

  const bilgi = {
    Tarih: new Date().toLocaleString('tr-TR'),
    Mod: secenek.surum ? 'Sürüm öncesi kapı' : 'Elle denetim',
    Sürüm: surum,
    Commit: commit.replace(/\|/g, '/'),
    Proje: kok,
    'Toplam süre': `${((Date.now() - basla) / 1000).toFixed(0)} sn`,
  };
  const { yol, sonuc } = await raporYaz({ klasor: raporKlasoru, adimlar, bilgi, kapi });

  console.log('\n──────── Özet ────────');
  konsolOzet(adimlar);
  console.log(`\nSonuç: ${{ gecti: 'GEÇTİ', uyari: 'UYARILARLA GEÇTİ', kaldi: 'KALDI' }[sonuc]}`);
  if (kapi) console.log(kapi.acik ? 'Sürüm kapısı AÇIK: yayınlayabilirsiniz.' : `Sürüm kapısı KAPALI: ${kapi.neden}`);
  console.log(`Rapor: ${yol}`);

  if (kapi) return kapi.acik ? 0 : 1;
  return genelSonuc(adimlar) === 'kaldi' ? 1 : 0;
}

main().then(
  (kod) => {
    process.exitCode = kod;
  },
  (h) => {
    console.error('Denetim çalışamadı:', h);
    process.exitCode = 2;
  },
);

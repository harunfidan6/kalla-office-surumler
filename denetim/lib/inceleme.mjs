// 4. adım: yerel model (Ollama) ile kod incelemesi.
//
// Küçük yerel modeller olmayan hatalar uydurabilir. Bu yüzden:
//  - Model yalnızca değişen kodu (git diff) görür, satır numaralarıyla.
//  - Her bulgu "kanıt" olarak koddan bir parça alıntılamak zorunda; alıntı değişen
//    satırlarda birebir bulunamazsa bulgu atılır.
//  - Sonuçlar önbelleğe alınır; değişmeyen kod parçası tekrar incelenmez.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { adimSonucu, atlandi, git } from './ortak.mjs';

const ISTEM_SURUMU = 3;
const BOS_AGAC = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const SISTEM_ISTEMI = `Sen Kalla Office için kod denetçisisin. Kalla Office; Electron (Windows) ve Capacitor (Android) ile paketlenen, Vite ile derlenen, TipTap/ProseMirror tabanlı bir ofis uygulamasıdır (Belge, Sunum, Notlar). Word (.docx) ve PowerPoint (.pptx) dosyalarını açıp kaydeder.

Sana bir değişikliğin (git diff) bir parçası verilecek. Her satırın başında dosyadaki yeni satır numarası var. "+" eklenen, "-" silinen, boşluk değişmeyen satırdır.

YALNIZCA eklenen ("+") satırlardaki GERÇEK hataları bildir. Şunları BİLDİRME: stil, isimlendirme, yorum eksikliği, "daha iyi olabilir" önerileri, test eksikliği, emin olmadığın tahminler. Sorun yoksa boş liste döndür; boş liste iyi bir sonuçtur.

Öncelikle şunlara bak:
1. Veri kaybı: kaydetme ya da otomatik kaydetmede hata yutulması, kaydedilmemiş değişiklik uyarısının atlanması, dosyanın yarım yazılması.
2. Yakalanmayan hata: await edilmeyen promise, dosya/ağ işleminde hata yönetimi olmaması, null/undefined erişimi.
3. Word/PowerPoint içe-dışa aktarmada içerik kaybı ya da bozuk XML (& < > " kaçışı yapılmamış metin).
4. Güvenlik: dosya ya da kullanıcı içeriğinin innerHTML ile eklenmesi, Electron'da nodeIntegration açık ya da contextIsolation kapalı, IPC'de doğrulanmayan dosya yolu.
5. Sızıntı: kaldırılmayan olay dinleyicisi, temizlenmeyen zamanlayıcı, revokeObjectURL edilmeyen URL.
6. Mantık hatası: ters koşul, yanlış karşılaştırma, sınır hatası.

Her bulguda:
- satir: sorunlu satırın numarası
- onem: "kritik" (veri kaybı, çökme, güvenlik açığı), "orta" (yanlış davranış), "dusuk" (nadir durum)
- kanit: o satırdaki kodu AYNEN kopyala (en az birkaç sözcük)
- baslik, aciklama, oneri: Türkçe ve kısa`;

const SEMA = {
  type: 'object',
  properties: {
    bulgular: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          satir: { type: 'integer' },
          onem: { type: 'string', enum: ['kritik', 'orta', 'dusuk'] },
          kategori: { type: 'string' },
          baslik: { type: 'string' },
          aciklama: { type: 'string' },
          kanit: { type: 'string' },
          oneri: { type: 'string' },
        },
        required: ['satir', 'onem', 'baslik', 'aciklama', 'kanit'],
      },
    },
  },
  required: ['bulgular'],
};

/** Birleşik diff çıktısını dosya ve parçalara (hunk) ayırır. */
export function diffAyristir(diff) {
  const dosyalar = [];
  let dosya = null;
  let parca = null;
  let yeniNo = 0;
  for (const satir of diff.split('\n')) {
    if (satir.startsWith('diff --git ')) {
      dosya = { yol: null, parcalar: [], silindi: false };
      dosyalar.push(dosya);
      parca = null;
    } else if (!dosya) {
      continue;
    } else if (!parca && satir.startsWith('+++ ')) {
      // Başlık satırları yalnızca dosyanın ilk @@ satırından önce olur.
      const yol = satir.slice(4).trim();
      if (yol === '/dev/null') dosya.silindi = true;
      else dosya.yol = yol.replace(/^b\//, '');
    } else if (satir.startsWith('@@')) {
      const m = satir.match(/\+(\d+)/);
      yeniNo = m ? Number(m[1]) : 1;
      parca = { satirlar: [] };
      dosya.parcalar.push(parca);
    } else if (parca && /^[ +-]/.test(satir)) {
      const tur = satir[0];
      parca.satirlar.push({ tur, metin: satir.slice(1).replace(/\r$/, ''), no: tur === '-' ? null : yeniNo });
      if (tur !== '-') yeniNo++;
    }
  }
  return dosyalar.filter((d) => d.yol && !d.silindi && d.parcalar.length);
}

/** Yeni (izlenmeyen) bir dosyayı tamamen eklenmiş gibi gösterir. */
export function yeniDosyaParcasi(yol, icerik) {
  return {
    yol,
    parcalar: [{ satirlar: icerik.split('\n').map((metin, i) => ({ tur: '+', metin, no: i + 1 })) }],
  };
}

const parcaMetni = (satirlar) =>
  satirlar.map((s) => `${s.no == null ? '     ' : String(s.no).padStart(5)}${s.tur}| ${s.metin}`).join('\n');

/** Dosyanın parçalarını modele sığacak büyüklükte gruplara böler. */
export function incelemeParcalari(dosya, maxKarakter) {
  const gruplar = [];
  let grup = [];
  let boy = 0;
  const bitir = () => {
    if (grup.length && grup.some((s) => s.tur === '+')) gruplar.push(grup);
    grup = [];
    boy = 0;
  };
  for (const parca of dosya.parcalar) {
    if (grup.length) {
      grup.push({ tur: ' ', metin: '...', no: null });
      boy += 12;
    }
    for (const s of parca.satirlar) {
      const uzunluk = s.metin.length + 9;
      if (boy + uzunluk > maxKarakter && grup.length) bitir();
      grup.push(s);
      boy += uzunluk;
    }
  }
  bitir();
  return gruplar.map((satirlar) => ({ yol: dosya.yol, satirlar, metin: parcaMetni(satirlar) }));
}

const sade = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Model bulgusunu değişen satırlarla doğrular. Kanıt eklenen satırlarda geçmiyorsa null döner.
 * Satır numarası, kanıtın gerçekten bulunduğu satıra düzeltilir.
 */
export function bulguDogrula(bulgu, parca) {
  const kanit = sade(String(bulgu.kanit || '').replace(/^\s*\d+\s*[+ ]?\|\s?/gm, ''));
  if (kanit.length < 6) return null;
  const eklenen = parca.satirlar.filter((s) => s.tur === '+');
  const adaylar = [];
  // Tek satırlık kanıt
  for (const s of eklenen) if (sade(s.metin).includes(kanit)) adaylar.push(s.no);
  // Birden çok satıra yayılan kanıt
  if (!adaylar.length) {
    const birlesik = sade(eklenen.map((s) => s.metin).join(' '));
    if (!birlesik.includes(kanit)) return null;
    const bas = kanit.split(' ').slice(0, 3).join(' ');
    adaylar.push((eklenen.find((x) => sade(x.metin).includes(bas)) || eklenen[0]).no);
  }
  const hedef = Number(bulgu.satir) || 0;
  const satir = adaylar.reduce((en, no) => (Math.abs(no - hedef) < Math.abs(en - hedef) ? no : en), adaylar[0]);
  return {
    dosya: parca.yol,
    satir,
    onem: ['kritik', 'orta', 'dusuk'].includes(bulgu.onem) ? bulgu.onem : 'orta',
    kategori: bulgu.kategori || '',
    baslik: sade(bulgu.baslik || ''),
    aciklama: sade(bulgu.aciklama || ''),
    oneri: sade(bulgu.oneri || ''),
    kanit,
  };
}

async function ollamaDurumu(ayar) {
  try {
    const yanit = await fetch(`${ayar.ollama}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!yanit.ok) return { hata: `Ollama yanıt vermedi (${yanit.status})` };
    const { models = [] } = await yanit.json();
    const adlar = models.map((m) => m.name);
    const var_ = adlar.some((a) => a === ayar.model || a === `${ayar.model}:latest` || a.replace(/:latest$/, '') === ayar.model);
    return var_ ? {} : { hata: `"${ayar.model}" modeli indirilmemiş. Şunu çalıştırın: ollama pull ${ayar.model}` };
  } catch {
    return {
      hata: `Ollama'ya ulaşılamadı (${ayar.ollama}). Ollama'yı kurup çalıştırın: https://ollama.com/download, sonra: ollama pull ${ayar.model}`,
    };
  }
}

async function modeleSor(ayar, parca) {
  const yanit = await fetch(`${ayar.ollama}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(ayar.zamanAsimiSn * 1000),
    body: JSON.stringify({
      model: ayar.model,
      stream: false,
      format: SEMA,
      keep_alive: '10m',
      options: { temperature: 0, seed: 42, num_ctx: ayar.numCtx },
      messages: [
        { role: 'system', content: SISTEM_ISTEMI },
        { role: 'user', content: `Dosya: ${parca.yol}\n\n${parca.metin}` },
      ],
    }),
  });
  if (!yanit.ok) throw new Error(`Ollama ${yanit.status}: ${(await yanit.text()).slice(0, 200)}`);
  const veri = await yanit.json();
  const icerik = veri.message?.content || '';
  try {
    const json = JSON.parse(icerik);
    return Array.isArray(json.bulgular) ? json.bulgular : [];
  } catch {
    throw new Error(`Model geçerli JSON döndürmedi: ${icerik.slice(0, 120)}`);
  }
}

async function temelBul(kok, istenen) {
  if (istenen) return { temel: istenen, aciklama: istenen };
  const etiket = await git(['describe', '--tags', '--abbrev=0', '--match', 'v*'], kok);
  if (etiket) return { temel: etiket, aciklama: `son sürüm etiketi ${etiket}` };
  if (await git(['rev-parse', '--verify', '--quiet', 'HEAD~1'], kok)) return { temel: 'HEAD~1', aciklama: 'son commit' };
  return { temel: BOS_AGAC, aciklama: 'tüm proje (henüz geçmiş yok)' };
}

/** ayar.inceleme: { model, ollama, numCtx, maxKarakter, maxParca, zamanAsimiSn, uzantilar, haric } */
export async function incelemeAdimi({ kok, ayar, temelRef, onbellekDosyasi, ilerleme = () => {} }) {
  const baslik = 'Kod incelemesi (yerel model)';
  const ia = ayar.inceleme;
  if (!(await git(['rev-parse', '--is-inside-work-tree'], kok)))
    return atlandi('inceleme', baslik, `${kok} bir git deposu değil`);
  const durum = await ollamaDurumu(ia);
  if (durum.hata) return atlandi('inceleme', baslik, durum.hata);

  const { temel, aciklama } = await temelBul(kok, temelRef);
  const diff = await git(['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--unified=6', temel, '--', '.'], kok);
  if (diff == null) return atlandi('inceleme', baslik, `git diff ${temel} çalışmadı`);
  const dosyalar = diffAyristir(diff);
  const izlenmeyen = (await git(['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard'], kok)) || '';
  for (const yol of izlenmeyen.split('\n').filter(Boolean)) {
    const icerik = await readFile(join(kok, yol), 'utf8').catch(() => null);
    if (icerik != null && icerik.length < 300_000) dosyalar.push(yeniDosyaParcasi(yol, icerik));
  }

  const uygun = (yol) =>
    ia.uzantilar.includes(extname(yol).toLowerCase()) &&
    !ia.haric.some((h) => yol === h || yol.startsWith(h.endsWith('/') ? h : `${h}/`) || yol.endsWith(`/${h}`));
  const parcalar = dosyalar.filter((d) => uygun(d.yol)).flatMap((d) => incelemeParcalari(d, ia.maxKarakter));
  const bulgular = [{ onem: 'bilgi', mesaj: `Karşılaştırma: ${aciklama}; ${parcalar.length} kod parçası, model ${ia.model}` }];
  if (!parcalar.length) {
    bulgular.push({ onem: 'bilgi', mesaj: 'İncelenecek kod değişikliği yok' });
    return adimSonucu('inceleme', baslik, bulgular, { modelBulgulari: [] });
  }
  if (parcalar.length > ia.maxParca)
    bulgular.push({
      onem: 'uyari',
      mesaj: `${parcalar.length} parça var, ilk ${ia.maxParca} tanesi incelendi (maxParca ayarı). Daha dar bir aralık için --temel kullanın.`,
    });

  let onbellek = {};
  try {
    onbellek = JSON.parse(await readFile(onbellekDosyasi, 'utf8'));
  } catch {
    // ilk çalıştırma
  }
  const modelBulgulari = [];
  let atilan = 0;
  let basarisiz = 0;
  const secilen = parcalar.slice(0, ia.maxParca);
  for (const [i, parca] of secilen.entries()) {
    const anahtar = createHash('sha256')
      .update(`${ISTEM_SURUMU}\0${ia.model}\0${ia.numCtx}\0${parca.yol}\0${parca.metin}`)
      .digest('hex');
    ilerleme(`  [${i + 1}/${secilen.length}] ${parca.yol}${onbellek[anahtar] ? ' (önbellekten)' : ''}`);
    let ham = onbellek[anahtar];
    if (!ham) {
      try {
        ham = await modeleSor(ia, parca);
        onbellek[anahtar] = ham;
      } catch (h) {
        basarisiz++;
        bulgular.push({ onem: 'uyari', mesaj: `${parca.yol} incelenemedi: ${h.message}` });
        continue;
      }
    }
    for (const b of ham) {
      const d = bulguDogrula(b, parca);
      if (d) modelBulgulari.push(d);
      else atilan++;
    }
  }
  await mkdir(dirname(onbellekDosyasi), { recursive: true });
  await writeFile(onbellekDosyasi, JSON.stringify(onbellek));

  // Aynı yerde aynı başlıkla tekrarlananları birleştir.
  const gorulen = new Set();
  const tekil = modelBulgulari.filter((b) => {
    const a = `${b.dosya}:${b.satir}:${b.baslik.toLocaleLowerCase('tr')}`;
    if (gorulen.has(a)) return false;
    gorulen.add(a);
    return true;
  });
  const sira = { kritik: 0, orta: 1, dusuk: 2 };
  tekil.sort((a, b) => sira[a.onem] - sira[b.onem] || a.dosya.localeCompare(b.dosya) || a.satir - b.satir);

  for (const b of tekil) {
    bulgular.push({
      onem: b.onem === 'dusuk' ? 'bilgi' : ia.kritikHataSayilir && b.onem === 'kritik' ? 'hata' : 'uyari',
      mesaj: `[${b.onem}] ${b.dosya}:${b.satir} ${b.baslik}`,
      ayrinti: `${b.aciklama}${b.oneri ? `\nÖneri: ${b.oneri}` : ''}\nKod: ${b.kanit}`,
    });
  }
  if (atilan)
    bulgular.push({ onem: 'bilgi', mesaj: `Kanıtı kodda bulunamayan ${atilan} model bulgusu atıldı (uydurma olabilir)` });
  if (basarisiz === secilen.length)
    bulgular.push({ onem: 'uyari', mesaj: 'Hiçbir parça incelenemedi; Ollama çalışıyor mu kontrol edin' });
  if (!tekil.length && basarisiz < secilen.length) bulgular.push({ onem: 'bilgi', mesaj: 'Model doğrulanabilir bir sorun bulmadı' });
  return adimSonucu('inceleme', baslik, bulgular, { modelBulgulari: tekil });
}

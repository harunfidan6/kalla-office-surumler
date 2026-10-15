// .docx ve .pptx dosyalarının içeriğini özetler ve iki özeti karşılaştırır.
// Amaç: uygulamada açılıp kaydedilen dosyada neyin kaybolduğunu ölçmek.
import JSZip from 'jszip';

const coz = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const say = (xml, re) => (xml.match(re) || []).length;
const sadelestir = (s) => s.replace(/\s+/g, ' ').trim();

/** Bir XML parçasındaki <ön:t> metinlerini birleştirir. */
function metinler(xml, on) {
  const re = new RegExp(`<${on}:t(?:\\s[^>]*)?>([^<]*)</${on}:t>`, 'g');
  let sonuc = '';
  for (const m of xml.matchAll(re)) sonuc += coz(m[1]);
  return sonuc;
}

/** Açık bir biçim özelliği (w:b, w:i...) "kapalı" değeriyle mi verilmiş? */
const acik = (rPr, ad) => {
  const m = rPr.match(new RegExp(`<w:${ad}(?:\\s+w:val="([^"]*)")?\\s*/>`));
  return !!m && !['0', 'false', 'none'].includes(m[1] ?? '');
};

export async function docxOzet(veri) {
  const zip = await JSZip.loadAsync(veri);
  const govde = await zip.file('word/document.xml')?.async('string');
  if (!govde) throw new Error('word/document.xml bulunamadı; geçerli bir .docx değil');
  const dipnotXml = (await zip.file('word/footnotes.xml')?.async('string')) || '';

  const paragraflar = [];
  for (const m of govde.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const metin = sadelestir(metinler(m[0], 'w'));
    if (metin) paragraflar.push(metin);
  }

  // Biçimli karakter sayısı: run'ların sayısı kaydetmede değişebilir, karakter sayısı değişmemeli.
  const bicim = { kalin: 0, italik: 0, altiCizili: 0 };
  for (const m of govde.matchAll(/<w:r[\s>][\s\S]*?<\/w:r>/g)) {
    const rPr = m[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const uzunluk = metinler(m[0], 'w').replace(/\s/g, '').length;
    if (!uzunluk || !rPr) continue;
    if (acik(rPr, 'b')) bicim.kalin += uzunluk;
    if (acik(rPr, 'i')) bicim.italik += uzunluk;
    if (acik(rPr, 'u')) bicim.altiCizili += uzunluk;
  }

  const sutunlar = [...govde.matchAll(/<w:cols\b[^>]*w:num="(\d+)"/g)].map((m) => Number(m[1]));
  const resimDosyalari = Object.keys(zip.files).filter((ad) => /^word\/media\/[^/]+$/.test(ad)).length;

  return {
    tur: 'docx',
    paragraflar,
    sayilar: {
      paragraf: paragraflar.length,
      baslik: say(govde, /<w:pStyle w:val="(?:Heading\d|Title|Baslik\d?|Başlık\d?)"/gi),
      liste: say(govde, /<w:numPr>/g),
      tablo: say(govde, /<w:tbl>/g),
      tabloHucresi: say(govde, /<w:tc>/g),
      resim: Math.max(say(govde, /<w:drawing>/g) + say(govde, /<w:pict>/g), 0),
      resimDosyasi: resimDosyalari,
      baglanti: say(govde, /<w:hyperlink\b/g),
      dipnot: say(govde, /<w:footnoteReference\b/g),
      sayfaSonu: say(govde, /<w:br\b[^>]*w:type="page"/g) + say(govde, /<w:pageBreakBefore\s*\/>/g),
      enCokSutun: sutunlar.length ? Math.max(...sutunlar) : 1,
      kalinKarakter: bicim.kalin,
      italikKarakter: bicim.italik,
      altiCiziliKarakter: bicim.altiCizili,
    },
    dipnotMetni: sadelestir(metinler(dipnotXml, 'w')),
  };
}

export async function pptxOzet(veri) {
  const zip = await JSZip.loadAsync(veri);
  const sunumXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!sunumXml) throw new Error('ppt/presentation.xml bulunamadı; geçerli bir .pptx değil');
  const iliskiler = (await zip.file('ppt/_rels/presentation.xml.rels')?.async('string')) || '';
  const hedef = Object.fromEntries(
    [...iliskiler.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      m[0].match(/Id="([^"]+)"/)?.[1],
      m[0].match(/Target="([^"]+)"/)?.[1],
    ]),
  );
  const sira = [...sunumXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => hedef[m[1]]);

  const slaytlar = [];
  for (const yol of sira) {
    if (!yol) continue;
    const tam = 'ppt/' + yol.replace(/^\/?ppt\//, '').replace(/^\.\//, '');
    const xml = (await zip.file(tam)?.async('string')) || '';
    const ad = tam.split('/').pop();
    const rels = (await zip.file(tam.replace(ad, `_rels/${ad}.rels`))?.async('string')) || '';
    const notYolu = rels.match(/Target="([^"]*notesSlide[^"]*)"/)?.[1];
    let notlar = '';
    if (notYolu) {
      const notXml = (await zip.file('ppt/' + notYolu.replace(/^\.\.\//, ''))?.async('string')) || '';
      // Not sayfasındaki slayt numarası yer tutucusunu (sldNum) sayma.
      notlar = sadelestir(metinler(notXml.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, ''), 'a'));
    }
    const paragraflar = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
      .map((m) => sadelestir(metinler(m[0], 'a')))
      .filter(Boolean);
    slaytlar.push({
      metin: paragraflar.join(' | '),
      paragraflar,
      notlar,
      sayilar: {
        resim: say(xml, /<p:pic>/g),
        tablo: say(xml, /<a:tbl>/g),
        grafik: say(xml, /<c:chart\b/g),
        sekil: say(xml, /<p:sp>/g),
        madde: say(xml, /<a:buChar\b/g) + say(xml, /<a:buAutoNum\b/g),
      },
    });
  }
  const toplam = (alan) => slaytlar.reduce((t, s) => t + s.sayilar[alan], 0);
  return {
    tur: 'pptx',
    slaytlar,
    paragraflar: slaytlar.flatMap((s) => s.paragraflar),
    sayilar: {
      slayt: slaytlar.length,
      resim: toplam('resim'),
      tablo: toplam('tablo'),
      grafik: toplam('grafik'),
      madde: toplam('madde'),
      notluSlayt: slaytlar.filter((s) => s.notlar).length,
    },
  };
}

export const dosyaOzet = (ad, veri) => (ad.toLowerCase().endsWith('.pptx') ? pptxOzet(veri) : docxOzet(veri));

/** Sözcük torbası benzerliği (0-1). Sıra değil içerik kaybını ölçer. */
export function metinBenzerligi(a, b) {
  const torba = (s) => {
    const m = new Map();
    for (const k of s.toLocaleLowerCase('tr').split(/[\s|]+/).filter(Boolean)) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const ta = torba(a);
  const tb = torba(b);
  let ortak = 0;
  let na = 0;
  let nb = 0;
  for (const [k, n] of ta) {
    na += n;
    ortak += Math.min(n, tb.get(k) || 0);
  }
  for (const n of tb.values()) nb += n;
  return na + nb === 0 ? 1 : (2 * ortak) / (na + nb);
}

/** a'da olup b'de karşılığı olmayan paragraflar (sıralı LCS ile). */
export function kayipParagraflar(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    const kume = new Set(b);
    return a.filter((p) => !kume.has(p));
  }
  const tablo = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      tablo[i][j] = a[i] === b[j] ? tablo[i + 1][j + 1] + 1 : Math.max(tablo[i + 1][j], tablo[i][j + 1]);
  const kayip = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && tablo[i][j + 1] >= tablo[i + 1][j]) j++;
    else kayip.push(a[i++]);
  }
  return kayip;
}

// Kaybı hata sayılan yapılar; diğer sayılardaki düşüş uyarıdır.
const KRITIK = new Set([
  'slayt',
  'paragraf',
  'baslik',
  'liste',
  'tablo',
  'tabloHucresi',
  'resim',
  'resimDosyasi',
  'baglanti',
  'dipnot',
  'grafik',
  'notluSlayt',
]);

const ETIKET = {
  slayt: 'slayt',
  paragraf: 'paragraf',
  baslik: 'başlık',
  liste: 'liste öğesi',
  tablo: 'tablo',
  tabloHucresi: 'tablo hücresi',
  resim: 'resim',
  resimDosyasi: 'resim dosyası',
  baglanti: 'bağlantı',
  dipnot: 'dipnot',
  sayfaSonu: 'sayfa sonu',
  enCokSutun: 'sütun sayısı',
  kalinKarakter: 'kalın karakter',
  italikKarakter: 'italik karakter',
  altiCiziliKarakter: 'altı çizili karakter',
  grafik: 'grafik',
  madde: 'madde işareti',
  notluSlayt: 'notlu slayt',
};

/**
 * İki özeti karşılaştırır. Dönen sorunların `onem` alanı "hata" ya da "uyari".
 * esik: metin benzerliği bunun altına düşerse hata.
 */
export function karsilastir(once, sonra, { esik = 0.98 } = {}) {
  const sorunlar = [];
  const benzerlik = metinBenzerligi(once.paragraflar.join(' '), sonra.paragraflar.join(' '));
  if (benzerlik < esik)
    sorunlar.push({ onem: 'hata', mesaj: `Metin benzerliği %${(benzerlik * 100).toFixed(1)} (eşik %${esik * 100})` });

  const kayip = kayipParagraflar(once.paragraflar, sonra.paragraflar);
  if (kayip.length) {
    const ornek = kayip
      .slice(0, 3)
      .map((p) => `"${p.length > 70 ? p.slice(0, 70) + '…' : p}"`)
      .join(', ');
    sorunlar.push({
      onem: benzerlik < esik ? 'hata' : 'uyari',
      mesaj: `${kayip.length} paragraf aynı haliyle bulunamadı: ${ornek}`,
    });
  }

  for (const [alan, deger] of Object.entries(once.sayilar)) {
    const yeni = sonra.sayilar[alan] ?? 0;
    if (yeni >= deger) continue;
    sorunlar.push({
      onem: KRITIK.has(alan) ? 'hata' : 'uyari',
      mesaj: `${ETIKET[alan] || alan}: ${deger} → ${yeni}`,
    });
  }

  if (once.tur === 'docx' && once.dipnotMetni && metinBenzerligi(once.dipnotMetni, sonra.dipnotMetni) < esik)
    sorunlar.push({ onem: 'hata', mesaj: 'Dipnot metni değişti ya da kayboldu' });

  if (once.tur === 'pptx') {
    once.slaytlar.forEach((s, i) => {
      const k = sonra.slaytlar[i];
      if (!k) return;
      const b = metinBenzerligi(s.metin, k.metin);
      if (b < esik) sorunlar.push({ onem: 'hata', mesaj: `Slayt ${i + 1} metni %${(b * 100).toFixed(0)} benzer` });
      if (s.notlar && metinBenzerligi(s.notlar, k.notlar) < esik)
        sorunlar.push({ onem: 'hata', mesaj: `Slayt ${i + 1} konuşmacı notu kayboldu ya da değişti` });
    });
  }
  return { benzerlik, sorunlar };
}

// Word/PowerPoint karşılaştırıcısının testleri: kayıpları yakalıyor mu, aynı dosyada sessiz mi?
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { docxOzet, karsilastir, kayipParagraflar, metinBenzerligi, pptxOzet } from '../lib/ooxml.mjs';

const ORNEK = join(dirname(fileURLToPath(import.meta.url)), '..', 'ornekler');
const belge = await readFile(join(ORNEK, 'ornek-belge.docx'));
const sunum = await readFile(join(ORNEK, 'ornek-sunum.pptx'));

/** Zip içindeki bir XML dosyasını değiştirip yeni bayt dizisi döndürür. */
async function bozulmus(veri, dosya, degistir) {
  const zip = await JSZip.loadAsync(veri);
  const xml = await zip.file(dosya).async('string');
  const yeni = degistir(xml);
  assert.notEqual(yeni, xml, `${dosya} değişmedi; test hatalı`);
  zip.file(dosya, yeni);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const mesajlar = (k) => k.sorunlar.map((s) => `${s.onem}: ${s.mesaj}`).join('\n');

test('örnek belgenin özeti', async () => {
  const o = await docxOzet(belge);
  assert.equal(o.sayilar.tablo, 1);
  assert.equal(o.sayilar.tabloHucresi, 9);
  assert.equal(o.sayilar.resim, 1);
  assert.equal(o.sayilar.dipnot, 1);
  assert.equal(o.sayilar.baglanti, 1);
  assert.equal(o.sayilar.liste, 4);
  assert.equal(o.sayilar.enCokSutun, 2);
  assert.equal(o.sayilar.kalinKarakter, 'kalın'.length);
  assert.ok(o.paragraflar.includes('Ortalanmış paragraf.'));
  assert.match(o.dipnotMetni, /Dipnot metni/);
});

test('aynı belge karşılaştırılınca sorun yok', async () => {
  const k = karsilastir(await docxOzet(belge), await docxOzet(belge));
  assert.equal(k.benzerlik, 1);
  assert.deepEqual(k.sorunlar, []);
});

const DOCX_BOZMALAR = [
  ['tablo silinmiş', (x) => x.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/, ''), /tablo: 1 → 0/],
  ['resim silinmiş', (x) => x.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/, ''), /resim: 1 → 0/],
  ['dipnot silinmiş', (x) => x.replace(/<w:footnoteReference\b[^>]*\/>/, ''), /dipnot: 1 → 0/],
  ['bağlantı düz metne dönmüş', (x) => x.replace(/<w:hyperlink\b[^>]*>/, '').replace('</w:hyperlink>', ''), /bağlantı: 1 → 0/],
  ['iki sütun teke inmiş', (x) => x.replace(/w:num="2"/, 'w:num="1"'), /uyari: sütun sayısı: 2 → 1/],
  ['kalın biçim kaybolmuş', (x) => x.replace(/<w:b\/>/g, '').replace(/<w:b w:val="true"\/>/g, ''), /uyari: kalın karakter/],
  ['paragraf kaybolmuş', (x) => x.replace(/<w:p>(?:(?!<w:p>)[\s\S])*?Ortalanmış paragraf\.[\s\S]*?<\/w:p>/, ''), /paragraf.*"Ortalanmış paragraf\."/],
  ['Türkçe karakter bozulmuş', (x) => x.replace(/çğıöşü ÇĞİÖŞÜ/, 'cgiosu CGIOSU'), /paragraf aynı haliyle bulunamadı/],
];

for (const [ad, bozma, beklenen] of DOCX_BOZMALAR) {
  test(`docx: ${ad} → yakalanır`, async () => {
    const k = karsilastir(await docxOzet(belge), await docxOzet(await bozulmus(belge, 'word/document.xml', bozma)));
    assert.match(mesajlar(k), beklenen);
  });
}

test('docx: dipnot metni değişirse yakalanır', async () => {
  const b = await bozulmus(belge, 'word/footnotes.xml', (x) => x.replace('Dipnot metni: kaynak 2026.', 'Başka bir şey'));
  assert.match(mesajlar(karsilastir(await docxOzet(belge), await docxOzet(b))), /Dipnot metni/);
});

test('örnek sunumun özeti', async () => {
  const o = await pptxOzet(sunum);
  assert.equal(o.sayilar.slayt, 3);
  assert.equal(o.sayilar.resim, 1);
  assert.equal(o.sayilar.tablo, 1);
  assert.equal(o.sayilar.notluSlayt, 2);
  assert.match(o.slaytlar[0].notlar, /Birinci slaydın konuşmacı notu/);
  assert.match(o.slaytlar[2].metin, /Şekil içi metin/);
  assert.deepEqual(karsilastir(o, o).sorunlar, []);
});

test('pptx: slayt silinirse, not ve metin kaybolursa yakalanır', async () => {
  const once = await pptxOzet(sunum);
  const slaytSilinmis = await bozulmus(sunum, 'ppt/presentation.xml', (x) => x.replace(/<p:sldId\b[^>]*\/>(?![\s\S]*<p:sldId\b)/, ''));
  assert.match(mesajlar(karsilastir(once, await pptxOzet(slaytSilinmis))), /slayt: 3 → 2/);

  const zip = await JSZip.loadAsync(sunum);
  const notDosyasi = Object.keys(zip.files).find((d) => /notesSlides\/notesSlide\d+\.xml$/.test(d));
  const notSilinmis = await bozulmus(sunum, notDosyasi, (x) => x.replace(/konuşmacı notu/, 'xyz'));
  assert.match(mesajlar(karsilastir(once, await pptxOzet(notSilinmis))), /konuşmacı notu kayboldu/);

  const resimSilinmis = await bozulmus(sunum, 'ppt/slides/slide2.xml', (x) => x.replace(/<p:pic>[\s\S]*?<\/p:pic>/, ''));
  assert.match(mesajlar(karsilastir(once, await pptxOzet(resimSilinmis))), /resim: 1 → 0/);
});

test('metin benzerliği ve kayıp paragraflar', () => {
  assert.equal(metinBenzerligi('a b c', 'a b c'), 1);
  assert.ok(metinBenzerligi('bir iki üç dört', 'bir iki') < 0.7);
  assert.deepEqual(kayipParagraflar(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'e']), ['b']);
  assert.equal(kayipParagraflar(['a', 'b'], ['b', 'a']).length, 1, 'sıra değişince biri kayıp sayılır');
});

test('geçersiz dosya anlaşılır hata verir', async () => {
  const zip = new JSZip();
  zip.file('x.txt', 'merhaba');
  const bos = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(docxOzet(bos), /geçerli bir \.docx değil/);
  await assert.rejects(pptxOzet(bos), /geçerli bir \.pptx değil/);
});

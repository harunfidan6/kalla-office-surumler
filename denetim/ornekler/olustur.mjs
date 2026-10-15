// Uyum testi için örnek .docx ve .pptx dosyalarını üretir.
// Çalıştırma: node ornekler/olustur.mjs  (devDependencies gerekir: npm install)
//
// Not: Bu dosyalar Word/PowerPoint'in kendisiyle değil kütüphaneyle üretilir.
// Gerçek dünyadaki uyumu ölçmek için Word ve PowerPoint'te hazırlanmış kendi
// dosyalarınızı da bu klasöre koyun; denetçi klasördeki her dosyayı test eder.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';

const klasor = dirname(fileURLToPath(import.meta.url));
const resim = await readFile(join(klasor, 'resim.png'));

const p = (metin, ek = {}) => new Paragraph({ children: [new TextRun(metin)], ...ek });

async function belge() {
  const doc = new Document({
    creator: 'Kalla denetim',
    title: 'Uyum testi',
    numbering: {
      config: [
        {
          reference: 'sirali',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    footnotes: { 1: { children: [p('Dipnot metni: kaynak 2026.')] } },
    sections: [
      {
        children: [
          new Paragraph({ text: 'Uyum Testi Belgesi', heading: HeadingLevel.TITLE }),
          new Paragraph({ text: 'Birinci Bölüm', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun('Bu paragrafta '),
              new TextRun({ text: 'kalın', bold: true }),
              new TextRun(', '),
              new TextRun({ text: 'italik', italics: true }),
              new TextRun(' ve '),
              new TextRun({ text: 'altı çizili', underline: {} }),
              new TextRun(' sözcükler var. Türkçe karakterler: çğıöşü ÇĞİÖŞÜ.'),
              new FootnoteReferenceRun(1),
            ],
          }),
          new Paragraph({ text: 'Alt başlık', heading: HeadingLevel.HEADING_2 }),
          p('Madde işaretli birinci öğe', { bullet: { level: 0 } }),
          p('Madde işaretli ikinci öğe', { bullet: { level: 0 } }),
          p('Numaralı birinci öğe', { numbering: { reference: 'sirali', level: 0 } }),
          p('Numaralı ikinci öğe', { numbering: { reference: 'sirali', level: 0 } }),
          new Paragraph({
            children: [
              new TextRun('Bağlantı: '),
              new ExternalHyperlink({
                link: 'https://example.com/kalla',
                children: [new TextRun({ text: 'örnek site', style: 'Hyperlink' })],
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              ['Ürün', 'Adet', 'Fiyat'],
              ['Kalem', '3', '45 TL'],
              ['Defter', '2', '120 TL'],
            ].map(
              (satir) => new TableRow({ children: satir.map((hucre) => new TableCell({ children: [p(hucre)] })) }),
            ),
          }),
          new Paragraph({
            children: [new ImageRun({ type: 'png', data: resim, transformation: { width: 120, height: 80 } })],
          }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('Ortalanmış paragraf.')] }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ text: 'İkinci Bölüm', heading: HeadingLevel.HEADING_1 }),
          p('Sayfa sonundan sonraki paragraf.'),
        ],
      },
      {
        properties: { type: SectionType.CONTINUOUS, column: { count: 2, space: 720, separate: true } },
        children: [
          p('İki sütunlu bölümün ilk paragrafı. '.repeat(6)),
          p('İki sütunlu bölümün ikinci paragrafı. '.repeat(6)),
        ],
      },
    ],
  });
  await writeFile(join(klasor, 'ornek-belge.docx'), await Packer.toBuffer(doc));
}

async function sunum() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Uyum testi';

  const s1 = pptx.addSlide();
  s1.addText('Uyum Testi Sunumu', { x: 0.6, y: 2.2, w: 12, h: 1.2, fontSize: 40, bold: true });
  s1.addText('Türkçe karakterler: çğıöşü ÇĞİÖŞÜ', { x: 0.6, y: 3.6, w: 12, h: 0.8, fontSize: 20 });
  s1.addNotes('Birinci slaydın konuşmacı notu.');

  const s2 = pptx.addSlide();
  s2.addText('Maddeler', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 30, bold: true });
  s2.addText(
    [
      { text: 'Birinci madde', options: { bullet: true } },
      { text: 'İkinci madde', options: { bullet: true } },
      { text: 'Üçüncü madde', options: { bullet: true } },
    ],
    { x: 0.6, y: 1.4, w: 7, h: 3, fontSize: 20 },
  );
  s2.addImage({ data: `image/png;base64,${resim.toString('base64')}`, x: 8.5, y: 1.6, w: 3, h: 2 });
  s2.addNotes('İkinci slaydın konuşmacı notu.');

  const s3 = pptx.addSlide();
  s3.addText('Tablo ve şekil', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 30, bold: true });
  s3.addTable(
    [
      ['Çeyrek', 'Gelir'],
      ['Q1', '120'],
      ['Q2', '180'],
    ],
    { x: 0.6, y: 1.5, w: 6, fontSize: 16, border: { type: 'solid', pt: 1, color: '999999' } },
  );
  s3.addShape(pptx.ShapeType.roundRect, { x: 8, y: 1.5, w: 3.5, h: 2, fill: { color: 'F0603C' } });
  s3.addText('Şekil içi metin', { x: 8, y: 1.5, w: 3.5, h: 2, align: 'center', color: 'FFFFFF', fontSize: 18 });

  await writeFile(join(klasor, 'ornek-sunum.pptx'), await pptx.write({ outputType: 'nodebuffer' }));
}

await belge();
await sunum();
console.log('Örnek dosyalar üretildi: ornek-belge.docx, ornek-sunum.pptx');

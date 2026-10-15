// Kod incelemesi adımının testleri. Gerçek model yerine sahte bir Ollama sunucusu kullanılır.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { bulguDogrula, diffAyristir, incelemeAdimi, incelemeParcalari } from '../lib/inceleme.mjs';

const ORNEK_DIFF = `diff --git a/src/kaydet.js b/src/kaydet.js
index 1111111..2222222 100644
--- a/src/kaydet.js
+++ b/src/kaydet.js
@@ -10,4 +10,6 @@ export function kaydet(belge) {
   const veri = belge.disaAktar();
-  await dosyaYaz(veri);
+  dosyaYaz(veri);
+  ++sayac;
+  durum.innerHTML = belge.ad;
   return true;
 }
diff --git a/eski.js b/eski.js
deleted file mode 100644
--- a/eski.js
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
`;

test('diff ayrıştırma: satır numaraları ve silinen dosyalar', () => {
  const dosyalar = diffAyristir(ORNEK_DIFF);
  assert.equal(dosyalar.length, 1, 'silinen dosya incelenmemeli');
  const [d] = dosyalar;
  assert.equal(d.yol, 'src/kaydet.js');
  const eklenen = d.parcalar[0].satirlar.filter((s) => s.tur === '+');
  assert.deepEqual(
    eklenen.map((s) => [s.no, s.metin.trim()]),
    [
      [11, 'dosyaYaz(veri);'],
      [12, '++sayac;'],
      [13, 'durum.innerHTML = belge.ad;'],
    ],
  );
});

test('büyük dosya modele sığacak parçalara bölünür', () => {
  const satirlar = Array.from({ length: 400 }, (_, i) => ({ tur: '+', metin: `const x${i} = ${i};`, no: i + 1 }));
  const parcalar = incelemeParcalari({ yol: 'a.js', parcalar: [{ satirlar }] }, 2000);
  assert.ok(parcalar.length > 1);
  assert.ok(parcalar.every((p) => p.metin.length <= 2300));
  assert.equal(parcalar.reduce((t, p) => t + p.satirlar.length, 0), 400);
});

test('bulgu doğrulama: kanıtı olmayan uydurma bulgu atılır, satır düzeltilir', () => {
  const [parca] = incelemeParcalari(diffAyristir(ORNEK_DIFF)[0], 10_000);
  const gercek = bulguDogrula(
    { satir: 99, onem: 'kritik', baslik: 'await eksik', aciklama: 'Kayıt hatası yutulur', kanit: '  11+| dosyaYaz(veri);' },
    parca,
  );
  assert.equal(gercek.satir, 11, 'satır numarası kanıtın bulunduğu satıra düzeltilmeli');
  assert.equal(gercek.kanit, 'dosyaYaz(veri);');

  const uydurma = bulguDogrula(
    { satir: 12, onem: 'kritik', baslik: 'SQL enjeksiyonu', aciklama: '...', kanit: 'db.query("SELECT * " + girdi)' },
    parca,
  );
  assert.equal(uydurma, null);

  const silinenSatir = bulguDogrula(
    { satir: 11, onem: 'orta', baslik: 'x', aciklama: 'y', kanit: 'await dosyaYaz(veri);' },
    parca,
  );
  assert.equal(silinenSatir, null, 'silinen satıra dayanan bulgu kabul edilmemeli');

  assert.equal(bulguDogrula({ satir: 12, onem: 'dusuk', baslik: 'x', aciklama: 'y', kanit: '++' }, parca), null, 'çok kısa kanıt');
});

// --- Uçtan uca: geçici git deposu + sahte Ollama ---
let sunucu;
let adres;
let istekSayisi = 0;
let sonIstek = null;

before(async () => {
  sunucu = createServer((istek, yanit) => {
    let govde = '';
    istek.on('data', (d) => (govde += d));
    istek.on('end', () => {
      if (istek.url === '/api/tags') {
        yanit.end(JSON.stringify({ models: [{ name: 'test-model:latest' }] }));
        return;
      }
      istekSayisi++;
      sonIstek = JSON.parse(govde);
      const bulgular = [
        { satir: 3, onem: 'kritik', baslik: 'Kaydetme hatası yutuluyor', aciklama: 'Promise beklenmiyor', kanit: 'dosyaYaz(veri);', oneri: 'await ekleyin' },
        { satir: 4, onem: 'orta', baslik: 'Uydurma bulgu', aciklama: 'Kodda olmayan satır', kanit: 'eval(kullaniciGirdisi)' },
      ];
      yanit.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify({ bulgular }) } }));
    });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  adres = `http://127.0.0.1:${sunucu.address().port}`;
});
after(() => sunucu.close());

async function depoHazirla() {
  const kok = await mkdtemp(join(tmpdir(), 'denetim-inceleme-'));
  const g = (...a) => execFileSync('git', a, { cwd: kok, stdio: 'pipe' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  await writeFile(join(kok, 'kaydet.js'), 'export async function kaydet(veri) {\n  await dosyaYaz(veri);\n}\n');
  g('add', '.');
  g('commit', '-qm', 'ilk');
  g('tag', 'v0.1.0');
  await writeFile(join(kok, 'kaydet.js'), 'export async function kaydet(veri) {\n  const x = 1;\n  dosyaYaz(veri);\n}\n');
  await writeFile(join(kok, 'yeni.js'), 'export const yeni = () => 42;\n');
  await writeFile(join(kok, 'notlar.md'), 'incelenmemeli\n');
  return kok;
}

const ayar = () => ({
  inceleme: {
    model: 'test-model',
    ollama: adres,
    numCtx: 4096,
    maxKarakter: 8000,
    maxParca: 10,
    zamanAsimiSn: 10,
    kritikHataSayilir: false,
    uzantilar: ['.js'],
    haric: ['dist/'],
  },
});

test('uçtan uca: son sürüm etiketinden beri değişen kod incelenir, uydurma bulgu atılır, önbellek çalışır', async () => {
  const kok = await depoHazirla();
  const onbellekDosyasi = join(kok, '.onbellek', 'inceleme.json');
  istekSayisi = 0;
  const sonuc = await incelemeAdimi({ kok, ayar: ayar(), onbellekDosyasi });

  assert.equal(sonuc.durum, 'uyari');
  assert.equal(istekSayisi, 2, 'değişen kaydet.js + izlenmeyen yeni.js; .md incelenmez');
  assert.match(sonIstek.messages[1].content, /^Dosya: /);
  assert.equal(sonIstek.options.temperature, 0);
  assert.ok(sonIstek.format?.properties?.bulgular, 'JSON şeması gönderilmeli');

  assert.equal(sonuc.modelBulgulari.length, 1);
  const [b] = sonuc.modelBulgulari;
  assert.equal(b.dosya, 'kaydet.js');
  assert.equal(b.satir, 3);
  assert.equal(b.onem, 'kritik');
  const mesajlar = sonuc.bulgular.map((x) => x.mesaj).join('\n');
  assert.match(mesajlar, /son sürüm etiketi v0\.1\.0/);
  assert.match(mesajlar, /\[kritik\] kaydet\.js:3 Kaydetme hatası yutuluyor/);
  assert.match(mesajlar, /3 model bulgusu atıldı/, 'iki parçadaki uydurmalar + yeni.js için kanıtsız bulgu');

  istekSayisi = 0;
  const ikinci = await incelemeAdimi({ kok, ayar: ayar(), onbellekDosyasi });
  assert.equal(istekSayisi, 0, 'değişmeyen kod tekrar modele gönderilmemeli');
  assert.equal(ikinci.modelBulgulari.length, 1);
  assert.ok(JSON.parse(await readFile(onbellekDosyasi, 'utf8')));
});

test('kritik bulgu ayarla hata sayılabilir', async () => {
  const kok = await depoHazirla();
  const a = ayar();
  a.inceleme.kritikHataSayilir = true;
  const sonuc = await incelemeAdimi({ kok, ayar: a, onbellekDosyasi: join(kok, 'o.json') });
  assert.equal(sonuc.durum, 'kaldi');
});

test('Ollama yoksa ya da model indirilmemişse adım atlanır ve ne yapılacağı söylenir', async () => {
  const kok = await depoHazirla();
  const a = ayar();
  a.inceleme.ollama = 'http://127.0.0.1:9';
  let sonuc = await incelemeAdimi({ kok, ayar: a, onbellekDosyasi: join(kok, 'o.json') });
  assert.equal(sonuc.durum, 'atlandi');
  assert.match(sonuc.bulgular[0].mesaj, /Ollama'ya ulaşılamadı.*ollama pull test-model/s);

  a.inceleme.ollama = adres;
  a.inceleme.model = 'qwen2.5-coder:7b';
  sonuc = await incelemeAdimi({ kok, ayar: a, onbellekDosyasi: join(kok, 'o.json') });
  assert.equal(sonuc.durum, 'atlandi');
  assert.match(sonuc.bulgular[0].mesaj, /ollama pull qwen2\.5-coder:7b/);
});

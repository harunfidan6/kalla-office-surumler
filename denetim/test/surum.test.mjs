// Sürüm öncesi kontrollerin testleri (geçici git depolarıyla).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { surumAdimi, surumKarsilastir } from '../lib/surum.mjs';

test('sürüm karşılaştırma', () => {
  assert.equal(surumKarsilastir('0.4.10', '0.4.9'), 1);
  assert.equal(surumKarsilastir('v0.4.2', '0.4.2'), 0);
  assert.equal(surumKarsilastir('0.4.2', '1.0.0'), -1);
  assert.deepEqual(['v0.3.0', 'v0.4.10', 'v0.4.2'].sort(surumKarsilastir), ['v0.3.0', 'v0.4.2', 'v0.4.10']);
});

async function proje({ surum = '0.4.3', etiketler = ['v0.4.2'], gradle, kirli = false, yayin = true } = {}) {
  const kok = await mkdtemp(join(tmpdir(), 'denetim-surum-'));
  const g = (...a) => execFileSync('git', a, { cwd: kok, stdio: 'pipe' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  const paket = { name: 'kalla-office', version: surum };
  if (yayin) paket.build = { publish: { provider: 'github', owner: 'harunfidan6', repo: 'kalla-office-surumler' } };
  await writeFile(join(kok, 'package.json'), JSON.stringify(paket));
  if (gradle) {
    await mkdir(join(kok, 'android', 'app'), { recursive: true });
    await writeFile(join(kok, 'android', 'app', 'build.gradle'), gradle);
  }
  g('add', '.');
  g('commit', '-qm', 'ilk');
  for (const e of etiketler) g('tag', e);
  if (kirli) await writeFile(join(kok, 'yeni.js'), 'x');
  return kok;
}

// Durum dosyası depo dışında durur; depoda olsaydı çalışma ağacını kirletirdi.
const durumKlasoru = await mkdtemp(join(tmpdir(), 'denetim-durum-'));
let sayac = 0;
const ayar = (kok) => ({
  surum: { temizCalismaAgaci: true, uzakDepo: join(kok, 'yok'), yayinDeposuAdi: 'kalla-office-surumler' },
  durumDosyasi: join(durumKlasoru, `durum-${++sayac}.json`),
});
const hatalar = (s) => s.bulgular.filter((b) => b.onem === 'hata').map((b) => b.mesaj);

test('her şey yolundaysa hata yok', async () => {
  const kok = await proje({ gradle: 'versionCode 12\nversionName "0.4.3"' });
  const s = await surumAdimi({ kok, ayar: ayar(kok) });
  assert.deepEqual(hatalar(s), []);
  assert.equal(s.androidVersionCode, 12);
});

test('zaten yayınlanmış sürüm durdurulur', async () => {
  const kok = await proje({ surum: '0.4.2' });
  assert.match(hatalar(await surumAdimi({ kok, ayar: ayar(kok) })).join('\n'), /v0\.4\.2 zaten yayınlanmış/);
});

test('eski sürüm numarası durdurulur', async () => {
  const kok = await proje({ surum: '0.4.1' });
  assert.match(hatalar(await surumAdimi({ kok, ayar: ayar(kok) })).join('\n'), /en yeni sürümden \(v0\.4\.2\) büyük değil/);
});

test('commit edilmemiş değişiklik durdurulur', async () => {
  const kok = await proje({ kirli: true });
  assert.match(hatalar(await surumAdimi({ kok, ayar: ayar(kok) })).join('\n'), /commit edilmemiş/);
});

test('Android versionCode geriye giderse durdurulur, aynı kalırsa uyarı', async () => {
  const kok = await proje({ gradle: 'versionCode 11\nversionName "0.4.3"' });
  const a = ayar(kok);
  await writeFile(a.durumDosyasi, JSON.stringify({ androidVersionCode: 12, androidSurum: '0.4.2' }));
  assert.match(hatalar(await surumAdimi({ kok, ayar: a })).join('\n'), /versionCode 11.*12/);

  await writeFile(a.durumDosyasi, JSON.stringify({ androidVersionCode: 11, androidSurum: '0.4.2' }));
  const s = await surumAdimi({ kok, ayar: a });
  assert.deepEqual(hatalar(s), []);
  assert.ok(s.bulgular.some((b) => b.onem === 'uyari' && /önceki sürümle aynı/.test(b.mesaj)));
});

test('versionName farklıysa ve yayın ayarı yoksa uyarı', async () => {
  const kok = await proje({ gradle: 'versionCode 12\nversionName "1.0"', yayin: false });
  const s = await surumAdimi({ kok, ayar: ayar(kok) });
  const uyarilar = s.bulgular.filter((b) => b.onem === 'uyari').map((b) => b.mesaj).join('\n');
  assert.match(uyarilar, /versionName "1\.0"/);
  assert.match(uyarilar, /yayın ayarında "kalla-office-surumler" bulunamadı/);
});

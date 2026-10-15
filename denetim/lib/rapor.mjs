// Denetim sonuçlarını Markdown rapora ve konsola yazar.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SIMGE = { hata: '❌', uyari: '⚠️', bilgi: 'ℹ️' };
const DURUM = { gecti: '✅ Geçti', uyari: '⚠️ Uyarı', kaldi: '❌ Kaldı', atlandi: '⏭️ Atlandı' };

// Alt bulguları olan satır (senaryo özeti) sayılmaz, yalnızca alt bulguları sayılır.
const say = (bulgular, onem) =>
  bulgular.reduce((t, b) => t + (b.alt?.length ? say(b.alt, onem) : b.onem === onem ? 1 : 0), 0);

export function genelSonuc(adimlar) {
  if (adimlar.some((a) => a.durum === 'kaldi')) return 'kaldi';
  if (adimlar.some((a) => a.durum === 'uyari' || a.durum === 'atlandi')) return 'uyari';
  return 'gecti';
}

function bulguMd(b, girinti = '') {
  let md = `${girinti}- ${SIMGE[b.onem] || ''} ${b.mesaj}\n`;
  if (b.ayrinti) {
    const blok = b.ayrinti.replace(/```/g, "'''");
    md += `${girinti}  <details><summary>ayrıntı</summary>\n\n${girinti}  \`\`\`\n${blok
      .split('\n')
      .map((s) => `${girinti}  ${s}`)
      .join('\n')}\n${girinti}  \`\`\`\n\n${girinti}  </details>\n`;
  }
  for (const a of b.alt || []) md += bulguMd(a, girinti + '  ');
  return md;
}

export async function raporYaz({ klasor, adimlar, bilgi, kapi }) {
  const sonuc = genelSonuc(adimlar);
  const baslik = {
    gecti: '✅ GEÇTİ',
    uyari: '⚠️ UYARILARLA GEÇTİ',
    kaldi: '❌ KALDI',
  }[sonuc];
  let md = `# Kalla Office denetim raporu\n\n`;
  md += `| | |\n|---|---|\n`;
  for (const [k, v] of Object.entries(bilgi)) md += `| ${k} | ${v} |\n`;
  md += `\n## Sonuç: ${baslik}\n\n`;
  if (kapi) md += `**Sürüm kapısı:** ${kapi.acik ? '🟢 açık, sürüm yayınlanabilir' : `🔴 kapalı — ${kapi.neden}`}\n\n`;
  md += `| Adım | Durum | Hata | Uyarı | Süre |\n|---|---|---|---|---|\n`;
  for (const a of adimlar)
    md += `| ${a.baslik} | ${DURUM[a.durum]} | ${say(a.bulgular, 'hata')} | ${say(a.bulgular, 'uyari')} | ${a.sure ?? '-'} sn |\n`;

  for (const a of adimlar) {
    md += `\n## ${a.baslik} — ${DURUM[a.durum]}\n\n`;
    for (const b of a.bulgular) md += bulguMd(b);
    if (a.ekranGoruntusu?.length) {
      md += `\n<details><summary>Ekran görüntüleri (${a.ekranGoruntusu.length})</summary>\n\n`;
      for (const d of a.ekranGoruntusu) md += `**${d}**\n\n![${d}](ekran/${d})\n\n`;
      md += `</details>\n`;
    }
  }
  const yol = join(klasor, 'rapor.md');
  await writeFile(yol, md);
  await writeFile(join(klasor, 'sonuc.json'), JSON.stringify({ sonuc, kapi, bilgi, adimlar }, null, 2));
  return { yol, sonuc };
}

const renk = (kod, s) => (process.stdout.isTTY ? `\x1b[${kod}m${s}\x1b[0m` : s);
const RENK = { gecti: 32, uyari: 33, kaldi: 31, atlandi: 90 };

export function konsolOzet(adimlar) {
  for (const a of adimlar) {
    const h = say(a.bulgular, 'hata');
    const u = say(a.bulgular, 'uyari');
    console.log(`${renk(RENK[a.durum], DURUM[a.durum].padEnd(12))} ${a.baslik}${h || u ? `  (${h} hata, ${u} uyarı)` : ''}`);
    const yazdir = (b, girinti) => {
      if (b.onem === 'hata' || b.onem === 'uyari' || a.durum === 'atlandi')
        console.log(`${girinti}${SIMGE[b.onem] || ''} ${b.mesaj}`);
      for (const alt of b.alt || []) yazdir(alt, girinti + '   ');
    };
    for (const b of a.bulgular) yazdir(b, '   ');
  }
}

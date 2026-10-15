// Adımların ortak yardımcıları.
import { spawn } from 'node:child_process';

/**
 * Her denetim adımı bu biçimde sonuç döndürür:
 *   { ad, baslik, durum: 'gecti'|'uyari'|'kaldi'|'atlandi', bulgular: [{ onem, mesaj, ayrinti? }], ek? }
 * onem: 'hata' (adımı düşürür), 'uyari', 'bilgi'.
 */
export function adimSonucu(ad, baslik, bulgular = [], ek = {}) {
  const durum = bulgular.some((b) => b.onem === 'hata')
    ? 'kaldi'
    : bulgular.some((b) => b.onem === 'uyari')
      ? 'uyari'
      : 'gecti';
  return { ad, baslik, durum, bulgular, ...ek };
}

export const atlandi = (ad, baslik, neden) => ({
  ad,
  baslik,
  durum: 'atlandi',
  bulgular: [{ onem: 'bilgi', mesaj: neden }],
});

/**
 * Komutu çalıştırır; çıktıyı toplar. Hata fırlatmaz.
 * Metin verilirse kabukta, dizi verilirse ([program, ...argümanlar]) kabuksuz çalışır.
 */
export function komutCalistir(komut, { cwd, zamanAsimiMs = 15 * 60_000, ortam } = {}) {
  return new Promise((tamam) => {
    const env = { ...process.env, ...ortam };
    const surec = Array.isArray(komut)
      ? spawn(komut[0], komut.slice(1), { cwd, env })
      : spawn(komut, { cwd, shell: true, env });
    // Parça sınırında bölünen Türkçe karakterler bozulmasın diye akışlar metin olarak okunur.
    surec.stdout.setEncoding('utf8');
    surec.stderr.setEncoding('utf8');
    let cikti = '';
    let stdout = '';
    const ekle = (veri) => {
      cikti += veri;
      if (cikti.length > 400_000) cikti = cikti.slice(-200_000);
    };
    surec.stdout.on('data', (veri) => {
      stdout += veri;
      ekle(veri);
    });
    surec.stderr.on('data', ekle);
    const zamanlayici = setTimeout(() => {
      ekle(`\n[denetim] ${zamanAsimiMs / 1000} saniyede bitmediği için durduruldu`);
      surec.kill();
    }, zamanAsimiMs);
    surec.on('close', (kod) => {
      clearTimeout(zamanlayici);
      tamam({ kod: kod ?? 1, cikti, stdout });
    });
    surec.on('error', (hata) => {
      clearTimeout(zamanlayici);
      tamam({ kod: 1, cikti: String(hata), stdout: '' });
    });
  });
}

/** git'i argüman dizisiyle çalıştırır; başarılıysa çıktıyı (sonundaki boşluk atılmış), değilse null döndürür. */
export async function git(args, cwd) {
  const { kod, stdout } = await komutCalistir(['git', ...args], { cwd, zamanAsimiMs: 60_000 });
  return kod === 0 ? stdout.trimEnd() : null;
}

export const sonSatirlar = (metin, n = 25) => metin.trimEnd().split('\n').slice(-n).join('\n');

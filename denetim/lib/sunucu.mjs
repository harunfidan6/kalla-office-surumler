// Derlenmiş uygulamayı (dist) tarayıcıya sunan küçük statik sunucu.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TURLER = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

/** dist klasörünü rastgele bir portta sunar. Dönen nesnenin `adres` ve `kapat` alanları var. */
export async function sunucuBaslat(kok) {
  const kokYol = resolve(kok);
  const sunucu = createServer(async (istek, yanit) => {
    try {
      const yol = decodeURIComponent(new URL(istek.url, 'http://x').pathname);
      let dosya = normalize(join(kokYol, yol));
      if (dosya !== kokYol && !dosya.startsWith(kokYol + sep)) {
        yanit.writeHead(403).end();
        return;
      }
      if ((await stat(dosya).catch(() => null))?.isDirectory()) dosya = join(dosya, 'index.html');
      const icerik = await readFile(dosya);
      yanit.writeHead(200, {
        'content-type': TURLER[extname(dosya).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      yanit.end(icerik);
    } catch {
      yanit.writeHead(404).end('Bulunamadı');
    }
  });
  await new Promise((tamam) => sunucu.listen(0, '127.0.0.1', tamam));
  const { port } = sunucu.address();
  return {
    adres: `http://127.0.0.1:${port}`,
    kapat: () => new Promise((tamam) => sunucu.close(tamam)),
  };
}

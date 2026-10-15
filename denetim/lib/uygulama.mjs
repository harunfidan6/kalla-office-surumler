// 2. adım: uygulamayı gerçek bir tarayıcıda kullanarak test eder.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pptxOzet } from './ooxml.mjs';
import { adimSonucu } from './ortak.mjs';
import { dosyaAc, hazirBekle, kaydetIndir, sayfaAc } from './tarayici.mjs';

const BEKLE = {
  'index.html': '.home-main',
  'yazi.html': 'kallaEditor',
  'sunum.html': 'kallaSunum',
  'notlar.html': 'kallaNotes',
};
const sayfaAdi = (yol) => yol.split('?')[0];

/**
 * Tarayıcıda çalışır. Ekranın sağına taşan görünür öğeleri bulur. Yalnızca taşmanın
 * başladığı öğe raporlanır (çocukları değil). Kaydırılabilir kutuların (ör. yatay şablon
 * şeridi) içindekiler, gizli paneller ve aria-hidden süs öğeleri sayılmaz.
 * ekran: cihazın gerçek genişliği. Telefon tarayıcısı taşan sayfayı uzaklaştırıp
 * innerWidth'i büyüttüğü için innerWidth'e güvenilmez.
 */
export function tasanOgeler(ekran) {
  const kaydirilabilir = (e) => /(auto|scroll)/.test(getComputedStyle(e).overflowX);
  const gorunur = (e) => {
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      const st = getComputedStyle(x);
      if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0 || x.hidden || x.inert) return false;
      if (x.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };
  const tasiyor = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > ekran + 2 && r.left < ekran - 1;
  };
  const ogeler = [];
  for (const e of document.body.querySelectorAll('*')) {
    if (!tasiyor(e) || !gorunur(e)) continue;
    let ata = e.parentElement;
    let atla = false;
    for (let x = ata; x && x !== document.documentElement; x = x.parentElement) {
      if (kaydirilabilir(x) && x !== document.body) {
        atla = true;
        break;
      }
    }
    if (atla || (ata && ata !== document.body && tasiyor(ata))) continue;
    const ad = e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`;
    ogeler.push(`${ad} (${Math.round(e.getBoundingClientRect().right)}px)`);
  }
  const kaydirma = document.scrollingElement || document.documentElement;
  return { genislik: Math.max(kaydirma.scrollWidth, document.body.scrollWidth, window.innerWidth), ekran, ogeler };
}

/** Her senaryo bir sayfa açar, sonunda o sayfanın hatalarını da bulgu olarak ekler. */
const SENARYOLAR = [
  {
    ad: 'Sayfalar açılıyor (masaüstü, tablet, telefon)',
    async calistir({ tarayici, adres, ayar, ekranKlasoru, ekranGoruntusu }) {
      const bulgular = [];
      for (const gorunum of ['masaustu', 'tablet', 'telefon']) {
        for (const yol of ayar.uygulama.sayfalar) {
          const { baglam, sayfa, hatalar } = await sayfaAc(tarayici, adres, gorunum, ayar.uygulama);
          try {
            const basla = Date.now();
            await sayfa.goto(`${adres}/${yol}`);
            await hazirBekle(sayfa, BEKLE[sayfaAdi(yol)] || 'body');
            const sure = Date.now() - basla;
            await sayfa.waitForTimeout(400);
            if (sure > ayar.uygulama.acilisUyariMs)
              bulgular.push({ onem: 'uyari', mesaj: `${gorunum}: ${yol} ${sure} ms'de açıldı` });
            const tasma = await sayfa.evaluate(tasanOgeler, sayfa.viewportSize().width);
            if (tasma.genislik > tasma.ekran + 1)
              bulgular.push({
                onem: 'hata',
                mesaj: `${gorunum}: ${yol} yana kayıyor (sayfa ${tasma.genislik}px, ekran ${tasma.ekran}px)`,
              });
            if (tasma.ogeler.length)
              bulgular.push({
                onem: 'hata',
                mesaj: `${gorunum}: ${yol} ekrana sığmıyor, ${tasma.ogeler.length} öğe kesiliyor: ${tasma.ogeler.slice(0, 4).join(', ')}`,
              });
            const dosya = `${gorunum}-${sayfaAdi(yol).replace('.html', '')}.png`;
            await sayfa.screenshot({ path: join(ekranKlasoru, dosya) });
            ekranGoruntusu.push(dosya);
          } catch (h) {
            bulgular.push({ onem: 'hata', mesaj: `${gorunum}: ${yol} açılamadı: ${h.message.split('\n')[0]}` });
          } finally {
            for (const h of hatalar) bulgular.push({ onem: 'hata', mesaj: `${gorunum}: ${yol} → ${h.tur}: ${h.mesaj}` });
            await baglam.close();
          }
        }
      }
      return bulgular;
    },
  },
  {
    ad: 'Belge: yaz, biçimlendir, geri al, kaydet, tekrar aç',
    sayfa: 'yazi.html?template=bos',
    async calistir({ sayfa, gecici }) {
      const bulgular = [];
      await sayfa.locator('.ProseMirror').first().click();
      const metin = 'Denetim satırı: çğıöşü ÇĞİÖŞÜ 12345';
      await sayfa.keyboard.type(metin);
      let icerik = await sayfa.evaluate(() => window.kallaEditor.getText());
      if (!icerik.includes(metin)) bulgular.push({ onem: 'hata', mesaj: `Yazılan metin editörde yok: "${icerik}"` });

      await sayfa.keyboard.press('Control+a');
      await sayfa.keyboard.press('Control+b');
      const html = () => sayfa.evaluate(() => window.kallaEditor.getHTML());
      if (!(await html()).includes('<strong>')) bulgular.push({ onem: 'hata', mesaj: 'Ctrl+A, Ctrl+B metni kalın yapmadı' });
      await sayfa.keyboard.press('Control+z');
      if ((await html()).includes('<strong>')) bulgular.push({ onem: 'hata', mesaj: 'Ctrl+Z kalın biçimi geri almadı' });
      await sayfa.keyboard.press('Control+y');
      if (!(await html()).includes('<strong>')) bulgular.push({ onem: 'hata', mesaj: 'Ctrl+Y geri alınan kalın biçimi yinelemedi' });
      await sayfa.evaluate(() => window.kallaEditor.commands.focus('end'));
      await sayfa.keyboard.press('Enter');
      await sayfa.keyboard.press('Control+b');
      await sayfa.keyboard.type('İkinci paragraf');
      const kalinVardi = (await html()).includes('<strong>');
      const metinOnce = await sayfa.evaluate(() => window.kallaEditor.getText());

      const kayit = await kaydetIndir(sayfa, join(gecici, 'belge-testi.docx'));
      if (!kayit.ad.endsWith('.docx')) bulgular.push({ onem: 'hata', mesaj: `Kaydedilen dosya .docx değil: ${kayit.ad}` });
      const durum = (await sayfa.textContent('#save-state'))?.trim();
      if (/kaydedilmedi/i.test(durum || ''))
        bulgular.push({ onem: 'uyari', mesaj: `Kaydettikten sonra durum hâlâ "${durum}"` });

      await sayfa.goto(sayfa.url().replace(/\?.*$/, '?template=bos'));
      await hazirBekle(sayfa, 'kallaEditor');
      if ((await dosyaAc(sayfa, kayit.yol)) === 'menu')
        bulgular.push({ onem: 'uyari', mesaj: 'Ctrl+O iki denemede de dosya seçiciyi açmadı (Dosya > Aç… çalıştı)' });
      await sayfa.waitForFunction((m) => window.kallaEditor.getText().includes(m), metin, { timeout: 10_000 }).catch(() => {});
      icerik = await sayfa.evaluate(() => ({ metin: window.kallaEditor.getText(), html: window.kallaEditor.getHTML() }));
      if (!icerik.metin.includes(metin) || !icerik.metin.includes('İkinci paragraf'))
        bulgular.push({ onem: 'hata', mesaj: `Kaydedip tekrar açınca metin kayboldu: "${icerik.metin.slice(0, 200)}"` });
      else if (kalinVardi && !icerik.html.includes('<strong>'))
        bulgular.push({ onem: 'hata', mesaj: 'Kaydedip tekrar açınca kalın biçim kayboldu' });
      else if (icerik.metin.replace(/\s+/g, ' ').trim() !== metinOnce.replace(/\s+/g, ' ').trim())
        bulgular.push({
          onem: 'uyari',
          mesaj: 'Kaydedip tekrar açınca metin birebir aynı değil',
          ayrinti: `Önce: ${metinOnce}\nSonra: ${icerik.metin}`,
        });
      return bulgular;
    },
  },
  {
    ad: 'Belge: büyük belgede hız (yaklaşık 100 sayfa)',
    sayfa: 'yazi.html?template=bos',
    async calistir({ sayfa, ayar }) {
      const bulgular = [];
      // Tuş gecikmesi: test aracının kendi gecikmesini ayıklamak için önce boş belgede ölçülür.
      const tusGecikmesi = async () => {
        await sayfa.evaluate(() => window.kallaEditor.commands.focus('end'));
        const sureler = [];
        for (let i = 0; i < 15; i++) {
          const basla = Date.now();
          await sayfa.keyboard.type('a');
          await sayfa.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          sureler.push(Date.now() - basla);
        }
        sureler.sort((a, b) => a - b);
        return sureler[Math.floor(sureler.length / 2)];
      };
      const bos = await tusGecikmesi();
      const yukleme = await sayfa.evaluate((adet) => {
        const paragraf = (i) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `Paragraf ${i}: ` + 'Kalla Office büyük belge testi. '.repeat(8) }],
        });
        const icerik = [];
        for (let i = 0; i < adet; i++) {
          if (i % 40 === 0)
            icerik.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Bölüm ${i / 40 + 1}` }] });
          icerik.push(paragraf(i));
        }
        const basla = performance.now();
        window.kallaEditor.commands.setContent({ type: 'doc', content: icerik });
        return performance.now() - basla;
      }, ayar.uygulama.buyukBelgeParagraf);
      await sayfa.waitForTimeout(1500);
      const buyuk = await tusGecikmesi();
      const fark = buyuk - bos;
      const mesaj = `${ayar.uygulama.buyukBelgeParagraf} paragraf ${Math.round(yukleme)} ms'de yüklendi; tuş başına ${buyuk} ms (boş belgede ${bos} ms, fark ${fark} ms)`;
      if (yukleme > ayar.uygulama.buyukBelgeYuklemeUyariMs || fark > ayar.uygulama.tusGecikmesiUyariMs)
        bulgular.push({ onem: 'uyari', mesaj: `Yavaş: ${mesaj}` });
      else bulgular.push({ onem: 'bilgi', mesaj });
      return bulgular;
    },
  },
  {
    ad: 'Sunum: slayt ekle, yaz, sun, kaydet, tekrar aç',
    sayfa: 'sunum.html?new=1',
    async calistir({ sayfa, gecici }) {
      const bulgular = [];
      const slaytSayisi = () => sayfa.evaluate(() => window.kallaSunum.state.deck.slides.length);
      const ilk = await slaytSayisi();
      await sayfa.keyboard.press('Control+m');
      await sayfa.keyboard.press('Control+m');
      if ((await slaytSayisi()) !== ilk + 2) bulgular.push({ onem: 'hata', mesaj: 'Ctrl+M yeni slayt eklemedi' });

      // Metin içeren bir slayt ekle (arayüzün içeriği nasıl ürettiğinden bağımsız olsun diye model ile).
      const metin = 'Denetim slaytı çğıöşü';
      await sayfa.evaluate(async (m) => {
        const s = window.kallaSunum;
        await s.fromText(`# ${m}\n- Birinci madde\n- İkinci madde`);
      }, metin);
      await sayfa.waitForTimeout(300);

      await sayfa.keyboard.press('F5');
      await sayfa.waitForTimeout(600);
      const acik = await sayfa.evaluate(() => {
        const e = document.getElementById('present');
        return !!e && !e.hidden && getComputedStyle(e).display !== 'none';
      });
      if (!acik) bulgular.push({ onem: 'hata', mesaj: 'F5 sunum modunu açmadı' });
      await sayfa.keyboard.press('ArrowRight');
      await sayfa.keyboard.press('Escape');
      await sayfa.waitForTimeout(400);
      const kapali = await sayfa.evaluate(() => {
        const e = document.getElementById('present');
        return !e || e.hidden || getComputedStyle(e).display === 'none';
      });
      if (!kapali) bulgular.push({ onem: 'hata', mesaj: 'Escape sunum modunu kapatmadı' });

      const once = await sayfa.evaluate(() => window.kallaSunum.state.deck.slides.length);
      const kayit = await kaydetIndir(sayfa, join(gecici, 'sunum-testi.pptx'));
      await sayfa.goto(sayfa.url().replace(/\?.*$/, '?new=1'));
      await hazirBekle(sayfa, 'kallaSunum');
      await dosyaAc(sayfa, kayit.yol);
      await sayfa
        .waitForFunction((n) => window.kallaSunum.state.deck.slides.length === n, once, { timeout: 10_000 })
        .catch(() => {});
      const sonra = await sayfa.evaluate(() => window.kallaSunum.state.deck.slides.length);
      if (sonra !== once) bulgular.push({ onem: 'hata', mesaj: `Kaydedip açınca slayt sayısı ${once} → ${sonra}` });
      const ozet = await pptxOzet(await readFile(kayit.yol));
      if (!ozet.paragraflar.some((p) => p.includes(metin)))
        bulgular.push({ onem: 'hata', mesaj: 'Kaydedilen .pptx yazılan slayt metnini içermiyor' });
      return bulgular;
    },
  },
  {
    ad: 'Notlar: not yaz, sayfayı yenile, not duruyor mu',
    sayfa: 'notlar.html',
    async calistir({ sayfa }) {
      const bulgular = [];
      await sayfa.click('#new-note');
      await sayfa.waitForTimeout(300);
      const metin = `Denetim notu ${Date.now()}`;
      await sayfa.keyboard.type(metin);
      await sayfa.waitForTimeout(2000);
      await sayfa.reload();
      await hazirBekle(sayfa, 'kallaNotes');
      await sayfa.waitForTimeout(800);
      const var_ = await sayfa
        .waitForFunction((m) => document.body.innerText.includes(m), metin, { timeout: 5000 })
        .then(
          () => true,
          () => false,
        );
      if (!var_) bulgular.push({ onem: 'hata', mesaj: 'Yazılan not sayfa yenilenince kayboldu' });
      return bulgular;
    },
  },
  {
    ad: 'Ana ekran: uygulamalara geçiş',
    sayfa: 'index.html',
    async calistir({ sayfa }) {
      const bulgular = [];
      for (const [secici, bekle] of [
        ['a.rail-app[href*="yazi.html"]', BEKLE['yazi.html']],
        ['a.rail-app[href*="sunum.html"]', BEKLE['sunum.html']],
        ['a.rail-app[href*="notlar.html"]', BEKLE['notlar.html']],
      ]) {
        try {
          await sayfa.click(secici, { timeout: 5000 });
          await hazirBekle(sayfa, bekle);
        } catch (h) {
          bulgular.push({ onem: 'hata', mesaj: `Ana ekrandan ${secici} açılamadı: ${h.message.split('\n')[0]}` });
        }
        await sayfa.goBack();
        await hazirBekle(sayfa, BEKLE['index.html']).catch(() => {});
      }
      return bulgular;
    },
  },
];

export async function uygulamaAdimi({ tarayici, adres, ayar, ekranKlasoru, gecici }) {
  const bulgular = [];
  const ekranGoruntusu = [];
  for (const senaryo of SENARYOLAR) {
    const basla = Date.now();
    let sonuc = [];
    let ac = null;
    try {
      if (senaryo.sayfa) {
        ac = await sayfaAc(tarayici, adres, 'masaustu', ayar.uygulama);
        await ac.sayfa.goto(`${adres}/${senaryo.sayfa}`);
        await hazirBekle(ac.sayfa, BEKLE[sayfaAdi(senaryo.sayfa)] || 'body');
      }
      sonuc = await senaryo.calistir({ tarayici, adres, ayar, sayfa: ac?.sayfa, gecici, ekranKlasoru, ekranGoruntusu });
    } catch (h) {
      sonuc.push({ onem: 'hata', mesaj: `Senaryo yarıda kaldı: ${h.message.split('\n')[0]}` });
    }
    if (ac) {
      for (const h of ac.hatalar) sonuc.push({ onem: 'hata', mesaj: `${h.tur}: ${h.mesaj}` });
      if (sonuc.some((b) => b.onem === 'hata')) {
        const dosya = `hata-${bulgular.length + 1}.png`;
        await ac.sayfa.screenshot({ path: join(ekranKlasoru, dosya) }).catch(() => {});
        ekranGoruntusu.push(dosya);
      }
      await ac.baglam.close();
    }
    const sure = ((Date.now() - basla) / 1000).toFixed(1);
    const hataVar = sonuc.some((b) => b.onem === 'hata');
    bulgular.push({
      onem: hataVar ? 'hata' : sonuc.some((b) => b.onem === 'uyari') ? 'uyari' : 'bilgi',
      mesaj: `${hataVar ? 'KALDI' : 'geçti'}: ${senaryo.ad} (${sure} sn)`,
      alt: sonuc,
    });
  }
  return adimSonucu('uygulama', 'Uygulamayı kullanarak test', bulgular, { ekranGoruntusu });
}

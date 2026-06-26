const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DEALER_URL = 'https://www.willhaben.at/iad/haendler/noetstaller-autos-kfz-ersatzteile/auto?orgId=1004316';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'vehicles.json');
const MAX_VEHICLES = 3;
const TIMEOUT = 45000;

async function scrapeWillhaben() {
  console.log('🚗 Starting Willhaben scraper...');
  console.log(`📍 Dealer URL: ${DEALER_URL}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'de-AT',
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    // Navigate to dealer page
    console.log('🌐 Navigating to Willhaben...');
    await page.goto(DEALER_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Handle cookie consent
    try {
      const cookieBtn = page.locator('button:has-text("Alle akzeptieren"), button:has-text("Akzeptieren"), #didomi-notice-agree-button');
      await cookieBtn.first().click({ timeout: 5000 });
      console.log('🍪 Cookie banner accepted');
      await page.waitForTimeout(2000);
    } catch {
      console.log('🍪 No cookie banner found (ok)');
    }

    // Scroll down slowly to trigger lazy-loaded images
    console.log('📜 Scrolling page to load all images...');
    await autoScroll(page);
    await page.waitForTimeout(2000);

    // Take a screenshot for debugging
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    await page.screenshot({ path: path.join(dataDir, 'page-screenshot.png'), fullPage: true });
    console.log('📸 Full-page screenshot saved');

    // Extract vehicle data from search result cards
    const vehicles = await page.evaluate((maxVehicles) => {
      const results = [];

      // Try multiple selectors to find listing cards
      const selectors = [
        '[data-testid="search-result-entry"]',
        '[data-testid="ad-list-item"]',
        'article[data-testid]',
        '[class*="SearchResult"]',
        'article[class*="search"]',
        '[class*="listing"]',
        '.search-result-entry',
      ];

      let cards = [];
      for (const selector of selectors) {
        cards = Array.from(document.querySelectorAll(selector));
        if (cards.length > 0) {
          console.log(`Found ${cards.length} cards with selector: ${selector}`);
          break;
        }
      }

      // Broader fallback: find links to individual car listings
      if (cards.length === 0) {
        const allLinks = Array.from(document.querySelectorAll('a[href*="/iad/gebrauchtwagen/"], a[href*="/iad/auto/"]'));
        const seenHrefs = new Set();
        for (const link of allLinks) {
          const href = link.href;
          if (seenHrefs.has(href)) continue;
          seenHrefs.add(href);
          const container = link.closest('article, [class*="result"], [class*="listing"], [class*="item"], li, div[class*="Ad"]');
          if (container) {
            cards.push(container);
          } else if (link.querySelector('img')) {
            cards.push(link);
          }
        }
        if (cards.length > 0) console.log(`Found ${cards.length} cards via link fallback`);
      }

      // Ultra-fallback: just find the biggest container elements that have both text and images
      if (cards.length === 0) {
        const allImgs = Array.from(document.querySelectorAll('img[src*="cache.willhaben"], img[src*="mmo"], img[data-src*="cache.willhaben"]'));
        for (const img of allImgs) {
          const container = img.closest('a, article, div[class], li');
          if (container && container.innerText.includes('€')) {
            cards.push(container);
          }
        }
        if (cards.length > 0) console.log(`Found ${cards.length} cards via image fallback`);
      }

      console.log(`Total cards found: ${cards.length}`);

      for (let i = 0; i < Math.min(cards.length, maxVehicles); i++) {
        const card = cards[i];
        const text = card.innerText || '';
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

        // === Extract link ===
        let link = '';
        const anchor = card.tagName === 'A' ? card : card.querySelector('a[href*="/iad/"]');
        if (anchor) {
          link = anchor.href;
        }

        // === Extract image (comprehensive) ===
        let image = '';
        // Try multiple image selectors in order of specificity
        const imgSelectors = [
          'img[src*="cache.willhaben.at"]',
          'img[src*="mmo"]',
          'img[data-src*="cache.willhaben"]',
          'img[data-src*="mmo"]',
          'img[srcset*="cache.willhaben"]',
          'img[loading="lazy"]',
          'picture source[srcset*="cache.willhaben"]',
          'img',
        ];

        for (const imgSel of imgSelectors) {
          const imgEl = card.querySelector(imgSel);
          if (imgEl) {
            // Try src first, then data-src, then srcset
            const src = imgEl.src || imgEl.dataset?.src || '';
            const srcset = imgEl.srcset || imgEl.dataset?.srcset || '';

            if (src && src.startsWith('http') && !src.includes('svg') && !src.includes('placeholder') && !src.includes('data:')) {
              image = src;
              break;
            }
            // Parse srcset for best quality image
            if (srcset) {
              const srcsetParts = srcset.split(',').map(s => s.trim().split(' ')[0]);
              const best = srcsetParts.find(s => s.includes('cache.willhaben')) || srcsetParts[srcsetParts.length - 1];
              if (best && best.startsWith('http')) {
                image = best;
                break;
              }
            }
          }
        }

        // Also check for background-image in style
        if (!image) {
          const divWithBg = card.querySelector('[style*="background-image"]');
          if (divWithBg) {
            const bgMatch = divWithBg.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
            if (bgMatch) image = bgMatch[1];
          }
        }

        // === Extract price ===
        let price = '';
        const priceMatch = text.match(/€\s*([\d.,]+)/);
        if (priceMatch) {
          price = '€ ' + priceMatch[1];
        }

        // === Extract title ===
        let title = '';
        for (const line of lines) {
          if (
            line.length > 10 &&
            !line.includes('€') &&
            !line.match(/^\d+[\s.,]*km$/i) &&
            !line.startsWith('Merken') &&
            !line.startsWith('Gesponser') &&
            !line.startsWith('Standort') &&
            !line.match(/^\d{4}$/)
          ) {
            title = line;
            break;
          }
        }

        // === Extract year (EZ) ===
        let year = '';
        const yearMatch = text.match(/(?:EZ|Erstzulassung)[:\s]*(\d{1,2}\/)?(\d{4})/i);
        if (yearMatch) {
          year = yearMatch[2];
        } else {
          const simpleYearMatch = text.match(/\b(20[12]\d)\b/);
          if (simpleYearMatch) year = simpleYearMatch[1];
        }

        // === Extract mileage ===
        let mileage = '';
        const kmMatch = text.match(/([\d.,]+)\s*km/i);
        if (kmMatch) {
          mileage = kmMatch[1] + ' km';
        }

        // === Extract fuel type ===
        let fuel = '';
        if (/diesel/i.test(text)) fuel = 'Diesel';
        else if (/benzin/i.test(text)) fuel = 'Benzin';
        else if (/elektro/i.test(text)) fuel = 'Elektro';
        else if (/hybrid/i.test(text)) fuel = 'Hybrid';
        else if (/cng|erdgas/i.test(text)) fuel = 'CNG';
        else fuel = 'Diesel'; // default for this dealer

        // === Extract transmission ===
        let transmission = '';
        if (/DSG|automatik|automatic|tiptronic/i.test(text)) transmission = 'Automatik';
        else if (/schalt|manuell|manual/i.test(text)) transmission = 'Schaltgetriebe';

        // === Extract PS/kW ===
        let power = '';
        const psMatch = text.match(/(\d+)\s*PS/i);
        const kwMatch = text.match(/(\d+)\s*kW/i);
        if (psMatch) power = psMatch[1] + ' PS';
        else if (kwMatch) power = Math.round(parseInt(kwMatch[1]) * 1.36) + ' PS';

        if (title || price) {
          results.push({
            title: title || 'Fahrzeug',
            price: price || 'Preis auf Anfrage',
            year: year || '',
            mileage: mileage || '',
            fuel: fuel,
            transmission: transmission || '',
            power: power || '',
            link: link || '',
            image: image || '',
          });
        }
      }

      return results;
    }, MAX_VEHICLES);

    // If images are missing from the card view, try clicking into each listing
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.image && v.link) {
        console.log(`🔍 No image for "${v.title}" – opening detail page...`);
        try {
          await page.goto(v.link, { waitUntil: 'networkidle', timeout: TIMEOUT });
          await page.waitForTimeout(2000);

          // Extract the main image from the detail page
          const detailImage = await page.evaluate(() => {
            const imgSelectors = [
              'img[src*="cache.willhaben.at"]',
              'img[src*="mmo"]',
              '[data-testid="image-gallery"] img',
              '.gallery img',
              'picture source[srcset*="cache.willhaben"]',
            ];
            for (const sel of imgSelectors) {
              const img = document.querySelector(sel);
              if (img) {
                const src = img.src || img.dataset?.src || '';
                if (src.startsWith('http') && !src.includes('svg') && !src.includes('placeholder')) {
                  return src;
                }
                const srcset = img.srcset || '';
                if (srcset) {
                  const parts = srcset.split(',').map(s => s.trim().split(' ')[0]);
                  const best = parts.find(s => s.includes('cache.willhaben')) || parts[parts.length - 1];
                  if (best && best.startsWith('http')) return best;
                }
              }
            }
            return '';
          });

          if (detailImage) {
            vehicles[i].image = detailImage;
            console.log(`   ✅ Found image: ${detailImage.substring(0, 80)}...`);
          }

          // Also extract any missing data from detail page
          if (!v.power || !v.transmission) {
            const detailData = await page.evaluate(() => {
              const text = document.body.innerText;
              let power = '', transmission = '';
              const psMatch = text.match(/(\d+)\s*PS/i);
              const kwMatch = text.match(/(\d+)\s*kW/i);
              if (psMatch) power = psMatch[1] + ' PS';
              else if (kwMatch) power = Math.round(parseInt(kwMatch[1]) * 1.36) + ' PS';
              if (/DSG|automatik|automatic|tiptronic/i.test(text)) transmission = 'Automatik';
              else if (/schalt|manuell|manual/i.test(text)) transmission = 'Schaltgetriebe';
              return { power, transmission };
            });
            if (!vehicles[i].power && detailData.power) vehicles[i].power = detailData.power;
            if (!vehicles[i].transmission && detailData.transmission) vehicles[i].transmission = detailData.transmission;
          }
        } catch (err) {
          console.log(`   ⚠️ Could not load detail page: ${err.message}`);
        }
      }
    }

    console.log(`\n✅ Final extracted ${vehicles.length} vehicles:`);
    vehicles.forEach((v, i) => {
      console.log(`   ${i + 1}. ${v.title}`);
      console.log(`      Price: ${v.price} | Year: ${v.year} | Mileage: ${v.mileage} | Fuel: ${v.fuel}`);
      console.log(`      Power: ${v.power} | Transmission: ${v.transmission}`);
      console.log(`      Image: ${v.image ? v.image.substring(0, 80) + '...' : '❌ NONE'}`);
      console.log(`      Link: ${v.link || '❌ NONE'}`);
    });

    if (vehicles.length === 0) {
      console.error('❌ No vehicles found! Page structure may have changed.');
      console.log('📸 Saving debug screenshot...');
      await page.screenshot({ path: path.join(dataDir, 'debug-screenshot.png'), fullPage: true });
      const html = await page.content();
      fs.writeFileSync(path.join(dataDir, 'debug-page.html'), html);
      console.log('📄 Debug page HTML saved');
      process.exit(1);
    }

    // Save vehicle data
    const output = {
      scraped_at: new Date().toISOString(),
      dealer_url: DEALER_URL,
      vehicles: vehicles,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n💾 Saved to ${OUTPUT_FILE}`);

    return vehicles;
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);

    // Save debug info
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    try {
      await page.screenshot({ path: path.join(dataDir, 'debug-screenshot.png'), fullPage: true });
      const html = await page.content();
      fs.writeFileSync(path.join(dataDir, 'debug-page.html'), html);
    } catch {}

    process.exit(1);
  } finally {
    await browser.close();
    console.log('🔒 Browser closed');
  }
}

// Helper: scroll down page slowly to trigger lazy-loaded images
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          // Scroll back to top
          window.scrollTo(0, 0);
          resolve();
        }
      }, 200);
    });
  });
}

// Run scraper, then update HTML
scrapeWillhaben().then(() => {
  console.log('\n📝 Updating HTML...');
  require('./update-html.js');
});

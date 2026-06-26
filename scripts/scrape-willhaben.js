const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DEALER_URL = 'https://www.willhaben.at/iad/haendler/noetstaller-autos-kfz-ersatzteile/auto?orgId=1004316';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'vehicles.json');
const MAX_VEHICLES = 3;
const TIMEOUT = 30000;

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
    await page.goto(DEALER_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // Handle cookie consent
    try {
      const cookieBtn = page.locator('button:has-text("Alle akzeptieren"), button:has-text("Akzeptieren"), #didomi-notice-agree-button');
      await cookieBtn.first().click({ timeout: 5000 });
      console.log('🍪 Cookie banner accepted');
      await page.waitForTimeout(1000);
    } catch {
      console.log('🍪 No cookie banner found (ok)');
    }

    // Wait for listings to load
    console.log('⏳ Waiting for listings...');
    await page.waitForTimeout(3000);

    // Extract vehicle data from search result cards
    const vehicles = await page.evaluate((maxVehicles) => {
      const results = [];

      // Willhaben uses search result list items with article data
      // Try multiple selectors to find listing cards
      const selectors = [
        '[data-testid="search-result-entry"]',
        '[class*="SearchResult"]',
        'article[class*="search"]',
        'a[href*="/iad/gebrauchtwagen/"]',
        '[class*="listing"]',
        '.search-result-entry',
      ];

      let cards = [];
      for (const selector of selectors) {
        cards = document.querySelectorAll(selector);
        if (cards.length > 0) {
          console.log(`Found ${cards.length} cards with selector: ${selector}`);
          break;
        }
      }

      // If no cards found with specific selectors, try a broader approach
      if (cards.length === 0) {
        // Look for links that contain vehicle-related URLs
        const allLinks = document.querySelectorAll('a[href*="/iad/"]');
        const vehicleLinks = Array.from(allLinks).filter(
          (a) =>
            a.href.includes('/gebrauchtwagen/') || a.href.includes('/auto/')
        );
        // Group by unique hrefs to get distinct listings
        const seenHrefs = new Set();
        for (const link of vehicleLinks) {
          if (!seenHrefs.has(link.href) && link.closest('article, [class*="result"], [class*="listing"], li')) {
            seenHrefs.add(link.href);
            cards = [...cards, link.closest('article, [class*="result"], [class*="listing"], li') || link];
          }
        }
      }

      for (let i = 0; i < Math.min(cards.length, maxVehicles); i++) {
        const card = cards[i];
        const text = card.innerText || '';
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

        // Extract link
        let link = '';
        const anchor = card.tagName === 'A' ? card : card.querySelector('a[href*="/iad/"]');
        if (anchor) {
          link = anchor.href;
        }

        // Extract image
        let image = '';
        const img = card.querySelector('img[src*="willhaben"], img[data-src*="willhaben"], img');
        if (img) {
          image = img.src || img.dataset.src || '';
        }

        // Extract price - look for € symbol
        let price = '';
        const priceMatch = text.match(/€\s*([\d.,]+)/);
        if (priceMatch) {
          price = '€ ' + priceMatch[1];
        }

        // Extract title - usually the first meaningful line
        let title = '';
        for (const line of lines) {
          if (
            line.length > 10 &&
            !line.includes('€') &&
            !line.includes('km') &&
            !line.startsWith('Merken') &&
            !line.startsWith('Gesponser')
          ) {
            title = line;
            break;
          }
        }

        // Extract year (EZ)
        let year = '';
        const yearMatch = text.match(/(?:EZ|Erstzulassung)[:\s]*(\d{1,2}\/)?(\d{4})/i);
        if (yearMatch) {
          year = yearMatch[2];
        } else {
          const simpleYearMatch = text.match(/\b(20[012]\d)\b/);
          if (simpleYearMatch) year = simpleYearMatch[1];
        }

        // Extract mileage
        let mileage = '';
        const kmMatch = text.match(/([\d.,]+)\s*km/i);
        if (kmMatch) {
          mileage = kmMatch[1] + ' km';
        }

        // Extract fuel type
        let fuel = 'Diesel';
        if (/benzin/i.test(text)) fuel = 'Benzin';
        else if (/elektro/i.test(text)) fuel = 'Elektro';
        else if (/hybrid/i.test(text)) fuel = 'Hybrid';
        else if (/cng|erdgas/i.test(text)) fuel = 'CNG';

        // Extract transmission
        let transmission = '';
        if (/DSG|automatik|automatic|tiptronic/i.test(text)) transmission = 'Automatik';
        else if (/schalt|manuell|manual/i.test(text)) transmission = 'Schaltgetriebe';

        // Extract PS/kW
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

    console.log(`✅ Extracted ${vehicles.length} vehicles:`);
    vehicles.forEach((v, i) => {
      console.log(`   ${i + 1}. ${v.title} | ${v.price} | ${v.year} | ${v.mileage} | ${v.fuel}`);
    });

    if (vehicles.length === 0) {
      console.error('❌ No vehicles found! Page structure may have changed.');
      console.log('📸 Saving debug screenshot...');
      await page.screenshot({ path: path.join(__dirname, '..', 'data', 'debug-screenshot.png'), fullPage: true });

      // Save page HTML for debugging
      const html = await page.content();
      fs.writeFileSync(path.join(__dirname, '..', 'data', 'debug-page.html'), html);
      console.log('📄 Debug page HTML saved');

      process.exit(1);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save vehicle data
    const output = {
      scraped_at: new Date().toISOString(),
      dealer_url: DEALER_URL,
      vehicles: vehicles,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`💾 Saved to ${OUTPUT_FILE}`);

    return vehicles;
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
    console.log('🔒 Browser closed');
  }
}

// Run scraper, then update HTML
scrapeWillhaben().then(() => {
  console.log('\n📝 Updating HTML...');
  require('./update-html.js');
});

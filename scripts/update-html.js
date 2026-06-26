const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'vehicles.json');
const HTML_FILE = path.join(__dirname, '..', 'index.html');
const DEALER_URL = 'https://www.willhaben.at/iad/haendler/noetstaller-autos-kfz-ersatzteile/auto?orgId=1004316';

const START_MARKER = '<!-- VEHICLES-START -->';
const END_MARKER = '<!-- VEHICLES-END -->';

function generateVehicleCard(vehicle, index) {
  const delay = index > 0 ? ` style="animation-delay:${index * 0.15}s"` : '';

  // Badge: show power if available, otherwise fuel type
  const badge = vehicle.power || vehicle.fuel || '';

  // Build detail tags
  const tags = [];
  if (vehicle.year) tags.push(`EZ ${vehicle.year}`);
  if (vehicle.mileage) tags.push(vehicle.mileage);
  if (vehicle.fuel) tags.push(vehicle.fuel);
  if (vehicle.transmission) tags.push(vehicle.transmission);

  const tagsHtml = tags
    .map(
      (tag) =>
        `                            <span class="text-xs bg-slate-200/80 text-slate-600 px-3 py-1 rounded-full font-medium">${tag}</span>`
    )
    .join('\n');

  // Vehicle link – use direct link if available, otherwise dealer page
  const vehicleLink = vehicle.link || DEALER_URL;

  // Image section – use real image if available, otherwise SVG placeholder
  let imageHtml;
  const imageSrc = vehicle.localImage || vehicle.image;
  if (imageSrc && (imageSrc.startsWith('http') || imageSrc.startsWith('assets/'))) {
    // Add cache busting query parameter for local images so they update when the image is redownloaded
    const cacheBuster = imageSrc.startsWith('assets/') ? `?v=${Date.now()}` : '';
    const finalSrc = imageSrc + cacheBuster;
    
    imageHtml = `                    <div class="h-48 overflow-hidden relative bg-gradient-to-br from-slate-100 to-slate-200">
                        <img src="${finalSrc}" alt="${vehicle.title}" class="w-full h-full object-cover object-center" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
                        <div class="absolute inset-0 flex items-center justify-center -z-10">
                            <svg class="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 17a2 2 0 11-4 0 2 2 0 014 0zM20 17a2 2 0 11-4 0 2 2 0 014 0zM2 11l2-5h7l2 5M2 11h17m-17 0v5a1 1 0 001 1h1m15-6h1a2 2 0 012 2v3a1 1 0 01-1 1h-1"/></svg>
                        </div>
                        <span class="absolute top-3 right-3 bg-gold text-slate-900 text-xs font-bold px-3 py-1 rounded-full z-10">${badge}</span>
                    </div>`;
  } else {
    imageHtml = `                    <div class="vehicle-img h-48 flex items-center justify-center relative">
                        <svg class="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 17a2 2 0 11-4 0 2 2 0 014 0zM20 17a2 2 0 11-4 0 2 2 0 014 0zM2 11l2-5h7l2 5M2 11h17m-17 0v5a1 1 0 001 1h1m15-6h1a2 2 0 012 2v3a1 1 0 01-1 1h-1"/></svg>
                        <span class="absolute top-3 right-3 bg-gold text-slate-900 text-xs font-bold px-3 py-1 rounded-full">${badge}</span>
                    </div>`;
  }

  return `                <!-- Vehicle ${index + 1}: ${vehicle.title} -->
                <div class="card-hover bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 animate-on-scroll"${delay}>
${imageHtml}
                    <div class="p-6">
                        <h3 class="text-lg font-bold text-slate-900 mb-3">${vehicle.title}</h3>
                        <div class="flex flex-wrap gap-2 mb-4">
${tagsHtml}
                        </div>
                        <p class="text-2xl font-bold text-gold mb-4">${vehicle.price}</p>
                        <a href="${vehicleLink}" target="_blank" rel="noopener" class="block text-center bg-slate-900 hover:bg-gold text-white hover:text-slate-900 font-semibold py-3 rounded-lg transition-all duration-300 text-sm uppercase tracking-wide">Details auf Willhaben</a>
                    </div>
                </div>`;
}

function updateHtml() {
  // Read vehicle data
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ Data file not found: ${DATA_FILE}`);
    console.log('   Run "npm run scrape" first to generate vehicle data.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const vehicles = data.vehicles;

  if (!vehicles || vehicles.length === 0) {
    console.error('❌ No vehicles in data file');
    process.exit(1);
  }

  console.log(`📊 Found ${vehicles.length} vehicles in data file`);
  console.log(`⏰ Scraped at: ${data.scraped_at}`);

  // Read current HTML
  if (!fs.existsSync(HTML_FILE)) {
    console.error(`❌ HTML file not found: ${HTML_FILE}`);
    process.exit(1);
  }

  let html = fs.readFileSync(HTML_FILE, 'utf-8');

  // Find markers
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    console.error('❌ Markers not found in HTML file!');
    console.error(`   Looking for: ${START_MARKER} and ${END_MARKER}`);
    process.exit(1);
  }

  // Generate vehicle cards HTML
  const vehicleCards = vehicles
    .map((v, i) => generateVehicleCard(v, i))
    .join('\n');

  const newSection = `${START_MARKER}
            <div class="grid md:grid-cols-3 gap-8 mb-12">
${vehicleCards}
            </div>
            ${END_MARKER}`;

  // Replace the section between markers
  const before = html.substring(0, startIdx);
  const after = html.substring(endIdx + END_MARKER.length);

  html = before + newSection + after;

  // Write updated HTML
  fs.writeFileSync(HTML_FILE, html);
  console.log(`✅ Updated ${HTML_FILE}`);
  console.log('   Vehicles embedded:');
  vehicles.forEach((v, i) => {
    console.log(`   ${i + 1}. ${v.title} — ${v.price}`);
  });
}

updateHtml();

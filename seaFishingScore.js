// seaFishingScore.js

// ─── Storage Helpers & Global State ────────────────────────────────────
const STORAGE_KEY = 'fishingAnglers';

function loadProfiles() {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  return raw.map(p => ({
    ...p,
    xp:                typeof p.xp === 'number' ? p.xp : 0,
    level:             typeof p.level === 'number' ? p.level : 1,
    badges:            Array.isArray(p.badges) ? p.badges : [],
    legendaryLog:      Array.isArray(p.legendaryLog) ? p.legendaryLog : [],
    history:           Array.isArray(p.history) ? p.history : [],
    totalFishingTime:  typeof p.totalFishingTime === 'number' ? p.totalFishingTime : 0
  }));
}

function saveProfiles(profiles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

let profiles = loadProfiles();
window.profiles = profiles;

let selectedProfiles = [];
window.selectedProfiles = selectedProfiles;

let sessionStart = null;
let sessionElapsed = 0; // seconds
let spec = null;
let weight = 0;
let finalScore = 0;
let xpGain = 0;
let tierObj = null;
let legendaryName = null;
// ─── Config: API Keys & Endpoints ────────────────────────────────────
const OPENWEATHER_KEY   = 'db9cf85d3abdce5fee3889985b255b75';
const WORLDTIDES_KEY    = '7bf3d990-c06d-44dc-ad1c-908562b5164c';
const WORLDTIDES_BASE   = 'https://www.worldtides.info/api/v3';

// ─── Helper: Map OpenWeather codes → emoji ─────────────────────────────
function mapWeatherToEmoji(code) {
  if (code >= 200 && code < 300) return '⛈️';
  if (code >= 300 && code < 500) return '🌦️';
  if (code >= 500 && code < 600) return '🌧️';
  if (code >= 600 && code < 700) return '❄️';
  if (code >= 700 && code < 800) return '🌫️';
  if (code === 800)             return '☀️';
  if (code > 800 && code < 900) return '⛅️';
  return '❓';
}

// ─── Helper: Fetch current weather ────────────────────────────────────
async function fetchWeather(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/onecall`
            + `?lat=${lat}&lon=${lon}`
            + `&units=metric`
            + `&exclude=minutely,hourly,daily,alerts`
            + `&appid=${OPENWEATHER_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OpenWeather error ${res.status}: ${res.statusText}`);
  }

  const { current } = await res.json();
  const kn     = Math.round(current.wind_speed * 1.94384);
  const dirs   = ['N','NE','E','SE','S','SW','W','NW'];
  const idx    = Math.floor((current.wind_deg + 22.5) / 45) % 8;
  const arrows = ['↑','↗','→','↘','↓','↙','←','↖'];

  return {
    temp:        Math.round(current.temp),
    emoji:       mapWeatherToEmoji(current.weather[0].id),
    description: current.weather[0].description,
    wind: {
      speed: kn,
      unit:  'kn',
      dir:   dirs[idx],
      arrow: arrows[idx]
    }
  };
}

// ─── Helper: Fetch tide heights & next extremes ───────────────────────
async function fetchTide(lat, lon) {
  const url = `${WORLDTIDES_BASE}?heights&extremes`
            + `&lat=${lat}&lon=${lon}`
            + `&date=today&datum=CD`
            + `&key=${WORLDTIDES_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`WorldTides error ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const now  = Date.now();

  // Find the height record closest to now
  const heights = Array.isArray(data.heights) ? data.heights : [];
  const nearest = heights.reduce((a, b) =>
    Math.abs(new Date(a.dt * 1000) - now) < Math.abs(new Date(b.dt * 1000) - now) ? a : b
  , heights[0] || { height: 0, dt: now / 1000 });

  // Extract next high/low from extremes
  const extremes = Array.isArray(data.extremes) ? data.extremes : [];
  const nextHigh = extremes.find(e =>
    e.type === 'High' && new Date(e.date).getTime() > now
  )?.date;
  const nextLow  = extremes.find(e =>
    e.type === 'Low' && new Date(e.date).getTime() > now
  )?.date;

  // Determine current tide state & icon
  const stateMap  = { High:'High', Low:'Low', Rising:'Rising', Falling:'Falling' };
  const iconMap   = { High:'🔺', Low:'🔻', Rising:'🌊↑', Falling:'🌊↓' };
  const firstType = extremes[0]?.type || 'Rising';
  const state     = stateMap[firstType] || 'Rising';

  return {
    height:   parseFloat(nearest.height.toFixed(2)),
    unit:     'm',
    state,
    marker:   iconMap[state],
    nextHigh,
    nextLow
  };
}

// Ensure each profile has a history array
profiles.forEach(p => {
  if (!Array.isArray(p.history)) p.history = [];
});

// UI & session state
let editingId            = null;
let selectedMode         = null;
let sessionTimerInterval = null;

let currentAngler  = null;
let currentFish    = null;
let currentLength  = null;
let currentMethod  = null;
let currentNotes   = '';
let logEntries     = [];

// ─── App Initialization ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // …your event listeners, renderers, and catch‐record logic go here…
});

  const AVATARS = [
    'anglerOne.png','anglerTwo.png','anglerThree.png','anglerFour.png',
    'anglerFive.png','anglerSix.png','anglerSeven.png','anglerEight.png'
  ];

    // -- Fish species data: weightPerCm (w), score multiplier (m)
  const fishData = {
    "Blue shark":               { w:0.59,  m:12,   img: 'blue-shark.png',            category: "Shark" },
    "Porbeagle shark":          { w:1.10,  m:15,   img: 'porbeagle-shark.png',       category: "Shark" },
    "Thresher shark":           { w:1.00,  m:20,   img: 'thresher-shark.png',       category: "Shark" },
    "Tope":                     { w:0.31,  m:10,   img: 'tope.png',                 category: "Shark" },
    "Smoothhound":              { w:0.15,  m:6,    img: 'smoothhound.png',          category: "Shark" },
    "Spurdog":                  { w:0.15,  m:8,    img: 'spurdog.png',              category: "Shark" },
    "Bull huss":                { w:0.16,  m:5,    img: 'bull-huss.png',            category: "Shark" },
    "Lesser spotted dogfish":   { w:0.043, m:2,    img: 'lesser-spotted-dogfish.png', category: "Shark" },
    "Thornback ray":            { w:0.25,  m:5,    img: 'thornback-ray.png',       category: "Ray" },
    "Blonde ray":               { w:0.37,  m:6,    img: 'blonde-ray.png',          category: "Ray" },
    "Small-eyed ray":           { w:0.23,  m:7,    img: 'small-eyed-ray.png',     category: "Ray" },
    "Spotted ray":              { w:0.13,  m:4,    img: 'spotted-ray.png',        category: "Ray" },
    "Undulate ray":             { w:0.30,  m:9,    img: 'undulate-ray.png',       category: "Ray" },
    "Cuckoo ray":               { w:0.10,  m:11,   img: 'cuckoo-ray.png',         category: "Ray" },
    "Plaice":                   { w:0.049, m:4,    img: 'plaice.png',            category: "Flatfish" },
    "Dab":                      { w:0.033, m:2,    img: 'dab.png',               category: "Flatfish" },
    "Flounder":                 { w:0.056, m:3,    img: 'flounder.png',          category: "Flatfish" },
    "Sole (common/Dover)":      { w:0.056, m:6,    img: 'sole.png',              category: "Flatfish" },
    "Turbot":                   { w:0.21,  m:9,    img: 'turbot.png',           category: "Flatfish" },
    "Brill":                    { w:0.17,  m:8,    img: 'brill.png',            category: "Flatfish" },
    "Conger eel":               { w:0.27,  m:7,    img: 'conger-eel.png',      category: "Eel" },
    "Silver eel":               { w:0.035, m:10,   img: 'silver-eel.png',      category: "Eel" },
    "Cod":                      { w:0.125, m:6,    img: 'cod.png',              category: "Roundfish" },
    "Pollack":                  { w:0.11,  m:4,    img: 'pollack.png',         category: "Roundfish" },
    "Coalfish":                 { w:0.083, m:3,    img: 'coalfish.png',       category: "Roundfish" },
    "Bass":                     { w:0.10,  m:8,    img: 'bass.png',           category: "Roundfish" },
    "Mackerel":                 { w:0.023, m:1,    img: 'mackerel.png',      category: "Roundfish" },
    "Scad (horse mackerel)":    { w:0.017, m:1.5,  img: 'scad.png',          category: "Roundfish" },
    "Garfish":                  { w:0.025, m:5,    img: 'garfish.png',       category: "Roundfish" },
    "Whiting":                  { w:0.030, m:2,    img: 'whiting.png',       category: "Roundfish" },
    "Pouting":                  { w:0.029, m:1.5,  img: 'pouting.png',       category: "Roundfish" },
    "Poor cod":                 { w:0.020, m:1.2,  img: 'poor-cod.png',      category: "Roundfish" },
    "Launce (greater sand eel)":{ w:0.007, m:1.3,  img: 'launce.png',       category: "Eel" },
    "Red gurnard":              { w:0.056, m:3,    img: 'red-gurnard.png',   category: "Gurnards and Oddities" },
    "Grey gurnard":             { w:0.043, m:2.5,  img: 'grey-gurnard.png',  category: "Gurnards and Oddities" },
    "Tub gurnard":              { w:0.083, m:4,    img: 'tub-gurnard.png',   category: "Gurnards and Oddities" },
    "John Dory":                { w:0.080, m:12,   img: 'john-dory.png',     category: "Gurnards and Oddities" },
    "Ballan wrasse":            { w:0.080, m:3,    img: 'ballan-wrasse.png', category: "Wrasse" },
    "Cuckoo wrasse":            { w:0.029, m:4,    img: 'cuckoo-wrasse.png', category: "Wrasse" },
    "Ling":                     { w:0.27,  m:9,    img: 'ling.png',         category: "Roundfish" },
    "Haddock":                  { w:0.083, m:3.5,  img: 'haddock.png',      category: "Roundfish" },
    "Black bream":              { w:0.075, m:5,    img: 'black-bream.png',  category: "Bream" },
    "Gilthead bream":           { w:0.10,  m:8,    img: 'gilthead-bream.png',category: "Bream" }
  };

const fishBio = {
  "Blue shark": `
    <h2>📸 Identification</h2>
    <p>Slender, torpedo-shaped pelagic shark with deep blue back, lighter flanks, and white underside.</p>
    <p>Long pointed pectoral fins and crescent-shaped tailfin.</p>
    <p>Large black eyes, pointed snout, and serrated teeth in multiple rows.</p>
    <p>UK size: 5–8 ft (up to ~150 lbs); global max: 12–13 ft, ~400 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Highly migratory, open-ocean species.</p>
    <p>Found in deep offshore waters (≥60 m), often hundreds of feet down.</p>
    <p>UK presence: summer to early autumn, especially off SW England, Wales, and Ireland.</p>
    <p>Follows major currents like the Gulf Stream; rarely near shore.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>UK season: June–October, peaking in late summer.</p>
    <p>Nomadic hunter, active day and night.</p>
    <p>Feeds on shoaling fish (mackerel, herring) and squid.</p>
    <p>Cruises mid-water, but will scavenge surface or depths.</p>
    <p>Attracted by chumming (rubby-dubby); drawn to oily fish slicks.</p>
    <p>Known for sudden bursts of speed and acrobatic leaps.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Heavy boat rod (30–50 lb class) + strong multiplier reel.</p>
    <p>Wire line or heavy mono; 8/0–10/0 hook on multi-strand wire trace.</p>
    <p>Float rig (balloon or large float) suspends bait at 10–30 m.</p>
    <p>Rubbing leader: 5–6 m of ~200 lb mono to resist tail abrasion.</p>
    <p>Use harness or fighting belt; sharks pull hard.</p>
    <p>Set drag carefully — allow for “runs” before hook sets.</p>
    <p>Gloves essential; sharks roll on the line when hooked.</p>
    <h2>🐟 Best Baits</h2>
    <p>Whole mackerel, mackerel flappers, herring, garfish, small tuna.</p>
    <p>Big squid or cuttlefish also effective.</p>
    <p>Fresh oily fish preferred: mackerel head + fillet, chunky flappers.</p>
    <p>Sewn strips of fish for fluttering presentation.</p>
    <p>Baits suspended mid-water or freelined in chum slick.</p>
    <p><strong>Tip:</strong> Minimize resistance — blue sharks are sensitive to unnatural drag.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Use 10/0–12/0 forged hooks + 150–250 lb wire leaders (3–5 ft).</p>
    <p>Rubbing leader: 200 lb+ mono for abrasion resistance.</p>
    <p>Drag: firm enough to set hook, light enough to allow runs (50–100 m bursts).</p>
    <p>Fighting harness recommended for larger specimens.</p>
    <p>Practice catch-and-release; handle with care or not at all.</p>
    <p>Use wire cutters for deep hooks; gloves to avoid injury.</p>
    <p>Keep shark’s head pointed away during release.</p>
  `,
  "Porbeagle shark": `
    <h2>📸 Identification</h2>
    <p>Stocky, powerfully built shark with slate-grey back, white belly, and a white patch on the rear of the dorsal fin. Crescent-shaped tail, prominent angular fins, conical snout, large black eyes.</p>
    <p>UK size: up to 8–10 ft (200–300 lbs typical).</p>
    <h2>🌊 Habitat</h2>
    <p>Pelagic predator found in cool-temperate deep offshore waters, especially SW UK, West Wales, and Ireland. Favors shelf edges, deep basins, and underwater banks.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Summer visitor (May–September). Migrates long distances. Hunts schooling fish and squid, sometimes near seabed. Active day and night.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Heavy big-game rod/reel, 10/0–12/0 hook, 400–600 lb wire leader, 200 lb mono trace. Use floats/balloons to suspend baits. Harness and butt pad recommended.</p>
    <h2>🐟 Best Baits</h2>
    <p>Whole mackerel, herring, pollack flappers, garfish, big squid/cuttlefish. Chum heavily with mashed fish.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Protected species—release required. Use gloves and long de-hooking tongs. Swivel between wire and mono to prevent line twist.</p>
  `,
  "Thresher shark": `
    <h2>📸 Identification</h2>
    <p>Distinctive long upper tail fin (as long as body), streamlined body, pointed snout, large eyes. Grey to brown back, white underside.</p>
    <p>UK size: up to 15 ft (half is tail), 300–400 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Deep offshore waters, shelf edges, sometimes near surface. Rare in UK, mostly SW and southern coasts.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Summer visitor. Hunts mackerel, herring, squid. Uses tail to stun prey. Often solitary.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Big-game rod/reel, 12/0 hook, 600 lb wire, 200 lb mono trace. Large floats to suspend bait.</p>
    <h2>🐟 Best Baits</h2>
    <p>Whole mackerel, herring, squid. Chum slick essential.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Long fights; use harness. Handle with care—powerful tail.</p>
  `,
  "Tope": `
    <h2>📸 Identification</h2>
    <p>Slender shark, grey back, white belly, long pointed snout, large eyes, two dorsal fins (first much larger).</p>
    <p>UK size: up to 6 ft, 80 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Coastal and offshore, sandy or mixed ground, estuaries. Common around UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Hunts shoaling fish, crabs, squid. Often in packs.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Strong surf/boat rod, 6/0–8/0 hook, wire trace, 80 lb mono.</p>
    <h2>🐟 Best Baits</h2>
    <p>Whole mackerel, herring, squid, crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Catch-and-release encouraged. Use gloves for handling.</p>
  `,
  "Smoothhound": `
    <h2>📸 Identification</h2>
    <p>Slender, smooth-skinned shark, grey-brown back, white belly, blunt snout, small mouth.</p>
    <p>UK size: up to 4 ft, 20 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Shallow sandy and mixed ground, estuaries, inshore waters.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on crabs, shellfish, worms. Often in groups.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Surf rod, 3/0–5/0 hook, wire or heavy mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Peeler crab, hermit crab, squid, ragworm.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently; smoothhounds are delicate.</p>
  `,
  "Spurdog": `
    <h2>📸 Identification</h2>
    <p>Slender shark, grey back with white spots, two dorsal fins with spines, pointed snout.</p>
    <p>UK size: up to 3 ft, 15 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Deep water, rocky ground, offshore banks.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Winter to spring. Feeds on fish, squid, crustaceans. Often in packs.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Boat rod, 4/0–6/0 hook, wire trace, 60 lb mono.</p>
    <h2>🐟 Best Baits</h2>
    <p>Mackerel, squid, herring.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Beware dorsal spines—venomous.</p>
  `,
  "Bull huss": `
    <h2>📸 Identification</h2>
    <p>Robust, broad-headed shark, brown with large dark spots, thick skin, wide mouth.</p>
    <p>UK size: up to 4 ft, 20 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Rocky ground, kelp beds, wrecks, inshore reefs.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round. Feeds on crabs, fish, shellfish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Strong rod, 4/0–6/0 hook, wire trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Mackerel, squid, crab, cuttlefish.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle with care—abrasive skin.</p>
  `,
  "Lesser spotted dogfish": `
    <h2>📸 Identification</h2>
    <p>Small shark, brown with dark spots, slender body, cat-like eyes.</p>
    <p>UK size: up to 2.5 ft, 3 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy, muddy, and rocky ground, inshore and estuaries.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round. Feeds on worms, crabs, small fish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, 1/0–2/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Worms, squid, mackerel strip.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Common bycatch; handle gently.</p>
  `,
  "Thornback ray": `
    <h2>📸 Identification</h2>
    <p>Diamond-shaped ray, brown/grey with thorny spines on back and tail, pale underside.</p>
    <p>UK size: up to 3 ft, 20 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy, muddy, and mixed ground, estuaries, inshore.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on crabs, shrimps, small fish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Surf/boat rod, 3/0–5/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Peeler crab, sandeel, squid, worm.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Beware tail spines.</p>
  `,
  "Blonde ray": `
    <h2>📸 Identification</h2>
    <p>Large, pale yellow ray with dark spots, rounded wings, long tail.</p>
    <p>UK size: up to 4 ft, 30 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Deep sandy and muddy ground, offshore banks.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on fish, crabs, shrimps.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Boat rod, 4/0–6/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Sandeel, squid, crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently; large rays are powerful.</p>
  `,
  "Small-eyed ray": `
    <h2>📸 Identification</h2>
    <p>Diamond-shaped, pale brown ray with small eyes, short tail, smooth skin.</p>
    <p>UK size: up to 2.5 ft, 15 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and muddy ground, Bristol Channel, SW UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on crabs, worms, small fish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Surf rod, 3/0–4/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Sandeel, crab, worm.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently; avoid eyes.</p>
  `,
  "Spotted ray": `
    <h2>📸 Identification</h2>
    <p>Small ray, pale brown with dark spots, rounded wings, short tail.</p>
    <p>UK size: up to 2 ft, 8 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and muddy ground, estuaries, inshore.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on worms, crabs, shrimps.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, 2/0–3/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Worms, sandeel, crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently.</p>
  `,
  "Undulate ray": `
    <h2>📸 Identification</h2>
    <p>Wavy pattern on back, yellow/brown, diamond-shaped, long tail.</p>
    <p>UK size: up to 2.5 ft, 15 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>South coast, sandy and mixed ground.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on crabs, worms, small fish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Surf rod, 3/0–4/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Sandeel, crab, worm.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Protected in some areas—check local rules.</p>
  `,
  "Cuckoo ray": `
    <h2>📸 Identification</h2>
    <p>Small ray, blue spots, long tail, translucent wings.</p>
    <p>UK size: up to 1.5 ft, 5 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Deep offshore banks, SW UK, Ireland.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on worms, shrimps, small fish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light boat rod, 2/0–3/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Worms, sandeel, crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Rare catch; handle gently.</p>
  `,
  "Plaice": `
    <h2>📸 Identification</h2>
    <p>Flatfish, orange spots on brown back, white underside, right-eyed.</p>
    <p>UK size: up to 2 ft, 6 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and muddy ground, estuaries, inshore.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on worms, shellfish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, 1/0–2/0 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, lugworm, peeler crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Use beads/spoons for attraction.</p>
  `,
  "Dab": `
    <h2>📸 Identification</h2>
    <p>Small flatfish, brown back, curved lateral line, translucent fins.</p>
    <p>UK size: up to 1 ft, 1.5 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and muddy ground, estuaries.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round. Feeds on worms, small shellfish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 2–4 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, lugworm, small crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Small hooks and baits best.</p>
  `,
  "Flounder": `
    <h2>📸 Identification</h2>
    <p>Flatfish, olive-brown back, rough skin, diamond shape, left or right-eyed.</p>
    <p>UK size: up to 1.5 ft, 3 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Estuaries, tidal rivers, sandy/muddy ground.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Autumn to spring. Feeds on worms, shrimps, small crabs.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 2–4 hook, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, lugworm, peeler crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Cast near margins and creek mouths.</p>
  `,
    "Sole (common/Dover)": `
    <h2>📸 Identification</h2>
    <p>Small, elongated flatfish with a rounded snout and a curved mouth. Upper side is sandy-brown to grey, often with darker blotches; underside is white. Eyes are on the right side. Distinctive long pectoral fin with a black edge. UK size: up to 1.5 ft, 3 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Prefers shallow sandy and muddy seabeds, estuaries, and tidal rivers. Most common along southern and eastern UK coasts.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Active spring to autumn, especially at night. Feeds on worms, small crustaceans, and shellfish. Often buries itself in sand during the day.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 2–4 hooks, long snood, mono trace. Use beads or small spoons for attraction.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, lugworm, small peeler crab, maddies (harbour rag).</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Fish at night or dusk for best results. Cast close to sandbanks or estuary channels.</p>
  `,
  "Turbot": `
    <h2>📸 Identification</h2>
    <p>Large, diamond-shaped flatfish with a broad body and rough, knobbly skin. Upper side is pale brown or grey with darker spots; underside is white. Eyes on the left side. UK size: up to 2.5 ft, 20 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Prefers offshore sandy banks, gravel beds, and open coasts. Found in deeper water, especially southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Ambush predator feeding on small fish and sandeels. Often lies buried in sand.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Strong surf or boat rod, 3/0–5/0 hooks, long trace, mono or fluorocarbon. Use attractor beads or spoons.</p>
    <h2>🐟 Best Baits</h2>
    <p>Whole sandeel, mackerel strip, small whiting, launce.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Drift fishing over sandbanks is productive. Use large, lively baits for bigger turbot.</p>
  `,
  "Brill": `
    <h2>📸 Identification</h2>
    <p>Oval-shaped flatfish, slimmer than turbot, with smooth skin and small scales. Upper side is pale brown with darker flecks; underside is white. Eyes on the left side. UK size: up to 2 ft, 10 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Prefers sandy and gravel seabeds, offshore banks, and open coasts. Found in similar areas to turbot but often in slightly shallower water.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on small fish, sandeels, and shrimps. Often lies camouflaged on the seabed.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light to medium surf or boat rod, 2/0–4/0 hooks, long snood, mono trace. Use beads or spoons for attraction.</p>
    <h2>🐟 Best Baits</h2>
    <p>Sandeel, mackerel strip, ragworm, small fish.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Drift fishing and casting over sandbanks or gravel beds is effective. Use small, lively baits for best results.</p>
  `,
   "Conger eel": `
    <h2>📸 Identification</h2>
    <p>Large, muscular eel with a long, snake-like body. Slate-grey to black back, pale belly, and a broad, flattened head with large jaws. Small pectoral fins and a continuous dorsal/anal fin running to the tail. UK size: up to 6 ft, 100 lbs (shore fish usually smaller).</p>
    <h2>🌊 Habitat</h2>
    <p>Prefers rocky ground, wrecks, harbours, and deep offshore reefs. Common around the UK, especially SW and west coasts. Often found in holes, crevices, and under structures.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Active year-round, especially at night. Ambush predator feeding on fish, crabs, and squid. Spends daylight hours hidden; emerges to hunt after dark. Large congers are solitary and territorial.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Heavy shore or boat rod, 6/0–10/0 hook, strong mono or wire trace (80–150 lb). Use rotten-bottom rig for snags. Short, tough trace to resist abrasion.</p>
    <h2>🐟 Best Baits</h2>
    <p>Whole mackerel, squid, cuttlefish, large fish heads, crab. Use large, oily baits for big congers.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Strike hard and keep pressure to avoid snags. Use gloves—congers bite and twist. Handle with care; release at water’s edge if possible.</p>
  `,
  "Silver eel": `
    <h2>📸 Identification</h2>
    <p>Slender, snake-like eel with a silvery belly and dark olive or brown back. Small pointed head, large eyes, and a continuous dorsal/anal fin. UK size: up to 3 ft, 6 lbs (most are smaller).</p>
    <h2>🌊 Habitat</h2>
    <p>Found in estuaries, tidal rivers, harbours, and coastal shallows. Migrates between freshwater and sea; most common in autumn when migrating to spawn.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Active spring to autumn, especially at night. Feeds on worms, small fish, crustaceans. Silver eels are mature, migratory phase of the European eel, heading to the Sargasso Sea to spawn.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light to medium rod, size 2–4 hooks, mono trace. Use simple ledger or float rig. Avoid wire traces—mono preferred for natural presentation.</p>
    <h2>🐟 Best Baits</h2>
    <p>Lugworm, ragworm, small fish strips, prawn, maggots.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently—eels twist and slime. Use wet hands or cloth. Release quickly; protected in many areas.</p>
  `,
    "Pollack": `
    <h2>📸 Identification</h2>
    <p>Streamlined, deep-bodied fish with a pointed snout, large eyes, and a protruding lower jaw. Olive-green to brown back, pale flanks, and white belly. Distinct pale lateral line curves upward behind the pectoral fin. UK size: up to 1 m, 15 lbs (shore fish usually smaller).</p>
    <h2>🌊 Habitat</h2>
    <p>Rocky coasts, deep reefs, wrecks, and kelp beds. Common around SW England, Wales, Ireland, and Scotland. Prefers rough ground and structure.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Active spring to autumn. Hunts small fish, sandeels, and crustaceans. Aggressive predator, often found mid-water or near the bottom.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Boat: long flowing trace, 4/0–6/0 hook, mono or fluorocarbon. Shore: strong spinning rod, lures, or float rigs. Use shads, jellyworms, or baited feathers.</p>
    <h2>🐟 Best Baits</h2>
    <p>Live sandeel, mackerel strip, artificial lures, ragworm.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Fish close to structure. Fast retrieve for lures. Pollack fight hard—set drag accordingly.</p>
  `,
  "Coalfish": `
    <h2>📸 Identification</h2>
    <p>Slender, dark-backed fish with pale belly and straight white lateral line. Forked tail, large eyes, and protruding lower jaw. UK size: up to 80 cm, 10 lbs (most are smaller).</p>
    <h2>🌊 Habitat</h2>
    <p>Deep rocky coasts, piers, harbours, and offshore wrecks. Common in northern UK, Scotland, and Ireland.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round, peak in autumn/winter. Feeds on small fish, sandeels, and crustaceans. Often in shoals.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Feathers, baited hokkai, small lures, or float rigs. Use light to medium rod, size 2–4 hooks.</p>
    <h2>🐟 Best Baits</h2>
    <p>Mackerel strip, sandeel, ragworm, small fish.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Fast retrieve for lures. Fish at dusk or night for bigger coalfish.</p>
  `,
  "Bass": `
    <h2>📸 Identification</h2>
    <p>Robust, silver fish with dark back, spiny dorsal fin, and large mouth. Distinct lateral line and forked tail. UK size: up to 80 cm, 15 lbs (shore fish usually 2–6 lbs).</p>
    <h2>🌊 Habitat</h2>
    <p>Surf beaches, rocky shores, estuaries, piers, and harbours. Widespread around southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on small fish, crabs, sandeels, and shrimps. Active in surf and shallow water, especially at dawn/dusk.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Surf rod, 3/0–5/0 hook, running ledger, or livebait float rig. Spinning rod for lures and plugs.</p>
    <h2>🐟 Best Baits</h2>
    <p>Peeler crab, live sandeel, mackerel strip, ragworm, soft plastic lures.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Fish at dawn/dusk or after storms. Bass are wary—use light tackle and stealth.</p>
  `,
  "Mackerel": `
    <h2>📸 Identification</h2>
    <p>Small, streamlined fish with blue-green back, wavy black stripes, and silvery belly. Forked tail, large eyes, and pointed snout. UK size: up to 45 cm, 2 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Open coasts, piers, harbours, and offshore. Forms large shoals in summer, especially southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Fast-swimming shoal fish, feeds on plankton, small fish, and crustaceans. Often near surface.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Feathers, hokkai, sabiki rigs, small spinners. Light rod, size 2–4 hooks.</p>
    <h2>🐟 Best Baits</h2>
    <p>Small strips of fish, artificial lures, sabiki rigs.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Cast into shoals for best results. Fast retrieve. Excellent bait for other species.</p>
  `,
  "Scad (horse mackerel)": `
    <h2>📸 Identification</h2>
    <p>Small, slender fish with large eyes, silver flanks, and a dark spot on the gill cover. Prominent lateral line and forked tail. UK size: up to 40 cm, 1.5 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Open coasts, piers, harbours, and offshore. Often in shoals, especially at night.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Summer to autumn. Feeds on plankton, small fish, and crustaceans. Nocturnal, often caught after dark.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Sabiki, small feathers, light float rigs. Use small hooks (size 4–8).</p>
    <h2>🐟 Best Baits</h2>
    <p>Small strips of fish, ragworm, maggots.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Fish at night for best results. Scad are lively and make good bait for predators.</p>
  `,
  "Garfish": `
    <h2>📸 Identification</h2>
    <p>Long, slender fish with green bones, pointed beak full of sharp teeth, and silvery flanks. UK size: up to 80 cm, 2 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Surface waters, piers, harbours, and open coasts. Often seen leaping or skipping across the surface.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on small fish and sandeels. Hunts near surface, especially in calm weather.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light float rig, long trace, small hook (size 6–2). Spinning rod for small lures.</p>
    <h2>🐟 Best Baits</h2>
    <p>Small strips of mackerel, sandeel, ragworm.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Strike quickly—garfish drop bait fast. Handle gently; bones are green but edible.</p>
  `,
    "Whiting": `
    <h2>📸 Identification</h2>
    <p>Slender, silver fish with three dorsal fins, pointed snout, and a small chin barbel. Pale brown back, silver flanks, and white belly. UK size: up to 45 cm, 2 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and muddy seabeds, estuaries, and inshore waters. Common around UK coasts, especially in winter.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Most abundant autumn to spring. Feeds on worms, small fish, and crustaceans. Often in shoals.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 2–4 hooks, flapper or two-hook rig. Use small beads for attraction.</p>
    <h2>🐟 Best Baits</h2>
    <p>Lugworm, ragworm, mackerel strip, squid.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Small hooks and baits best. Good target for beginners.</p>
  `,
  "Pouting": `
    <h2>📸 Identification</h2>
    <p>Small, deep-bodied fish with a blunt head, large eyes, and a pronounced chin barbel. Bronze-brown back, pinkish flanks, and white belly. UK size: up to 35 cm, 2 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Rocky ground, wrecks, piers, and harbours. Common in southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round, peak in autumn/winter. Feeds on worms, small fish, and shellfish. Often in dense shoals.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 4–6 hooks, flapper or paternoster rig.</p>
    <h2>🐟 Best Baits</h2>
    <p>Worms, squid, mackerel strip, small shellfish.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Quick to bite; ideal for junior anglers. Good bait for larger predators.</p>
  `,
  "Poor cod": `
    <h2>📸 Identification</h2>
    <p>Small, reddish-brown fish with a slender body, large eyes, and a small chin barbel. UK size: up to 25 cm, rarely over 0.5 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Rocky ground, piers, harbours, and offshore reefs. Common in southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round, often in shoals. Feeds on worms, small crustaceans, and fish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 6–8 hooks, flapper or small baited feathers.</p>
    <h2>🐟 Best Baits</h2>
    <p>Worms, small fish strips, squid.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Often caught as bycatch. Handle gently; small and delicate.</p>
  `,
  "Launce (greater sand eel)": `
    <h2>📸 Identification</h2>
    <p>Long, slender, eel-like fish with pointed snout and silvery flanks. Greenish-blue back. UK size: up to 40 cm, 0.5 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy beaches, surf zones, and offshore banks. Forms large shoals in summer.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on plankton and small crustaceans. Buries in sand when threatened.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Small feathers, sabiki rigs, light spinning rod. Use small hooks (size 6–10).</p>
    <h2>🐟 Best Baits</h2>
    <p>Sabiki rigs, small worm or fish strips.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Excellent livebait for bass, turbot, and pollack.</p>
  `,
  "Red gurnard": `
    <h2>📸 Identification</h2>
    <p>Bright red fish with large pectoral fins, spiny head, and bony plates. UK size: up to 40 cm, 2 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and gravel seabeds, offshore banks, and open coasts. Common in southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on small fish, crustaceans, and worms. Often found on the bottom.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light to medium rod, size 2–4 hooks, long trace, attractor beads.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, lugworm, fish strips, squid.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle with care—spines are sharp. Good eating.</p>
  `,
  "Grey gurnard": `
    <h2>📸 Identification</h2>
    <p>Grey-brown fish with large pectoral fins, spiny head, and bony plates. UK size: up to 30 cm, 1 lb.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and gravel seabeds, estuaries, and open coasts. Common throughout UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on small fish, crustaceans, and worms. Bottom-dweller.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 4–6 hooks, long trace, attractor beads.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, lugworm, fish strips, squid.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently; spines can prick.</p>
  `,
  "Tub gurnard": `
    <h2>📸 Identification</h2>
    <p>Large, reddish fish with blue-edged pectoral fins, spiny head, and bony plates. UK size: up to 50 cm, 4 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Sandy and gravel seabeds, offshore banks, and open coasts. Most common in southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on small fish, crustaceans, and worms. Bottom-dweller.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Medium rod, size 2–4 hooks, long trace, attractor beads or spoons.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, lugworm, fish strips, squid.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle with care—spines are sharp. Good eating.</p>
  `,
  "John Dory": `
    <h2>📸 Identification</h2>
    <p>Oval, laterally compressed fish with large mouth, long dorsal spines, and a dark spot on each side. Olive-green to yellowish body. UK size: up to 50 cm, 6 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Offshore reefs, rocky ground, and open coasts. Rare but prized catch in southern and western UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Ambush predator feeding on small fish. Solitary and slow-moving.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Boat rod, size 2–4 hooks, long trace, light mono or fluorocarbon.</p>
    <h2>🐟 Best Baits</h2>
    <p>Live sandeel, small fish, squid strips.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently—spines are sharp. Excellent eating; treat with care.</p>
  `,
    "Ballan wrasse": `
    <h2>📸 Identification</h2>
    <p>Chunky, oval-bodied wrasse with thick lips and strong teeth. Colour varies: green, brown, orange, or red, often mottled. Large scales, spiny dorsal fin. UK size: up to 60 cm, 8 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Rocky reefs, kelp beds, harbour walls, and breakwaters. Common in SW England, Wales, Ireland, and Scotland.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Daytime feeder, eats crabs, shellfish, and small fish. Territorial and strong fighters.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Strong float or ledger rod, 2/0–4/0 hook, abrasion-resistant mono. Use float rigs near rocks or ledger in kelp.</p>
    <h2>🐟 Best Baits</h2>
    <p>Peeler crab, hardback crab, prawn, mussel, ragworm.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Strike quickly and keep fish away from snags. Handle gently—wrasse are hardy but sensitive.</p>
  `,
  "Cuckoo wrasse": `
    <h2>📸 Identification</h2>
    <p>Slender, brightly coloured wrasse. Males: vivid blue and orange stripes; females: pink/orange with white belly. Long pointed tail and dorsal fin. UK size: up to 35 cm, 2 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Rocky reefs, offshore wrecks, kelp beds. Common in western UK and Ireland.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on small shellfish, worms, and crustaceans. Often found with ballan wrasse.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light float or ledger rod, size 2–4 hooks, fine mono. Float rigs or small ledger traces.</p>
    <h2>🐟 Best Baits</h2>
    <p>Ragworm, prawn, mussel, small crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Handle gently—delicate fish. Striking colours make them easy to identify.</p>
  `,
  "Ling": `
    <h2>📸 Identification</h2>
    <p>Long, eel-like body, mottled brown/green back, pale belly, single barbel under chin. Large mouth and sharp teeth. UK size: up to 1.5 m, 50 lbs (boat fish).</p>
    <h2>🌊 Habitat</h2>
    <p>Deep rocky ground, offshore wrecks, reefs. Common in western UK, Ireland, and Scotland.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round, peak summer. Feeds on fish, squid, crabs. Hides in holes and wrecks.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Heavy boat rod, 6/0–10/0 hook, strong mono or wire trace. Use rotten-bottom for snags.</p>
    <h2>🐟 Best Baits</h2>
    <p>Whole mackerel, squid, fish heads, large crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Strike hard and keep pressure. Handle with care—ling have sharp teeth.</p>
  `,
  "Haddock": `
    <h2>📸 Identification</h2>
    <p>Slender, silver fish with dark lateral line, black spot above pectoral fin (“Devil’s thumbprint”), and three dorsal fins. UK size: up to 70 cm, 7 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Deep sandy and muddy seabeds, offshore banks. Common in northern UK and Scotland.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Year-round, peak winter/spring. Feeds on worms, shellfish, small fish.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Boat rod, size 2–4 hooks, flapper or two-hook rig, mono trace.</p>
    <h2>🐟 Best Baits</h2>
    <p>Lugworm, ragworm, squid, fish strips.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Small hooks and baits best. Good eating—handle gently.</p>
  `,
  "Black bream": `
    <h2>📸 Identification</h2>
    <p>Oval, deep-bodied fish, silver-black with dark vertical stripes. Small mouth, sharp dorsal spines. UK size: up to 45 cm, 5 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Inshore reefs, rocky ground, piers, and harbours. Common in southern UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on shellfish, worms, and small crustaceans. Often in shoals.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light rod, size 4–8 hooks, flapper or two-hook rig, fine mono.</p>
    <h2>🐟 Best Baits</h2>
    <p>Mussel, ragworm, squid strip, small crab.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Fish light for best sport. Handle gently—spines are sharp.</p>
  `,
  "Gilthead bream": `
    <h2>📸 Identification</h2>
    <p>Deep-bodied, silver fish with golden band between eyes and yellow cheeks. Strong jaws, sharp dorsal spines. UK size: up to 60 cm, 8 lbs.</p>
    <h2>🌊 Habitat</h2>
    <p>Estuaries, tidal rivers, sandy bays, and inshore reefs. Most common in southern UK.</p>
    <h2>📅 Seasonal Activity & Behavior</h2>
    <p>Spring to autumn. Feeds on shellfish, crabs, and worms. Powerful fighter.</p>
    <h2>🎣 Recommended Rigs</h2>
    <p>Light to medium rod, size 2–4 hooks, strong mono, running ledger or two-hook rig.</p>
    <h2>🐟 Best Baits</h2>
    <p>Peeler crab, lugworm, razor clam, mussel.</p>
    <h2>⚠️ Tactical Notes</h2>
    <p>Use strong tackle—gilthead bream fight hard. Handle gently; prized catch.</p>
  `,
};

  // -- Renown tiers for each species

const RENOWN = {
  // Sharks
  "Blue shark": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm: 100, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm: 150, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm: 200, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 230, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 260, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Porbeagle shark": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  80, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm: 120, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm: 160, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 200, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 230, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Thresher shark": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm: 120, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm: 170, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm: 210, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 250, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 280, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Tope": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  80, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm: 110, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm: 130, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 150, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 170, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Smoothhound": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  60, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  80, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  95, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 110, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 125, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Spurdog": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  50, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  70, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  85, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 100, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 115, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Bull huss": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  60, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  80, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  95, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 110, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 125, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Lesser spotted dogfish": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  45, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  55, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  65, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  75, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  85, bonusXP: 50, bonusMult: 1.5 }
  ],

  // Rays & Skates
  "Thornback ray": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  45, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  60, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  70, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  80, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  90, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Blonde ray": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  50, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  65, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  80, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  95, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 110, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Small-eyed ray": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  40, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  55, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  65, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  75, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  85, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Spotted ray": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  35, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  45, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  55, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  65, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  75, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Undulate ray": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  45, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  60, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  75, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  90, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 105, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Cuckoo ray": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  35, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  45, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  55, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  65, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  75, bonusXP: 50, bonusMult: 1.5 }
  ],

  // Flatfish
  "Plaice": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  30, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  40, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  50, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  60, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  65, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Dab": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  20, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  25, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  30, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  35, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  40, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Flounder": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  30, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  40, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  50, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  55, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  60, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Sole (common/Dover)": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  28, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  35, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  40, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  45, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  50, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Turbot": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  35, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  50, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  60, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  70, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  80, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Brill": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  35, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  45, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  55, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  65, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  75, bonusXP: 50, bonusMult: 1.5 }
  ],

  // Eels
  "Conger eel": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  80, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm: 120, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm: 150, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 180, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 200, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Silver eel": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  40, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  60, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  70, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  80, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  90, bonusXP: 50, bonusMult: 1.5 }
  ],

  // Other Roundfish
  "Cod": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  40, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  55, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  65, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  75, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  85, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Pollack": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  40, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  55, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  65, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  75, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  85, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Coalfish": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  35, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  50, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  60, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  70, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  80, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Bass": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  36, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  50, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  60, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  70, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  80, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Mackerel": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  25, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  30, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  35, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  40, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  45, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Scad (horse mackerel)": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  20, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  25, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  30, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  35, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  40, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Garfish": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  40, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  55, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  65, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  75, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  85, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Whiting": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  25, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  35, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  40, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  45, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  50, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Pouting": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  20, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  30, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  35, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  40, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  45, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Poor cod": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  15, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  20, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  25, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  30, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  35, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Launce (greater sand eel)": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  20, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  25, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  30, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  35, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  40, bonusXP: 50, bonusMult: 1.5 }
  ],

  // Gurnards & Oddities
  "Red gurnard": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  25, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  35, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  40, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  45, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  50, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Grey gurnard": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  20, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  25, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  30, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  35, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  40, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Tub gurnard": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  30, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  40, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  45, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  50, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  55, bonusXP: 50, bonusMult: 1.5 }
  ],
  "John Dory": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  25, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  35, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  40, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  45, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  50, bonusXP: 50, bonusMult: 1.5 }
  ],

  // Wrasse & Reef Fish
  "Ballan wrasse": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  30, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  40, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  45, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  50, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  55, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Cuckoo wrasse": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  20, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  25, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  30, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  35, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  40, bonusXP: 50, bonusMult: 1.5 }
  ],

  // Other Bream & Relatives
  "Ling": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  60, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  90, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm: 110, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm: 130, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm: 150, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Haddock": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  35, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  45, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  50, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  55, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  60, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Black bream": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  25, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  30, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  35, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  40, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  45, bonusXP: 50, bonusMult: 1.5 }
  ],
  "Gilthead bream": [
    { name: "Juvenile",  minCm:   0, bonusXP:  0, bonusMult: 0   },
    { name: "Bronze",    minCm:  25, bonusXP:  5, bonusMult: 0   },
    { name: "Silver",    minCm:  35, bonusXP: 10, bonusMult: 0   },
    { name: "Gold",      minCm:  40, bonusXP: 15, bonusMult: 0   },
    { name: "Diamond",   minCm:  45, bonusXP: 25, bonusMult: 0   },
    { name: "Legendary", minCm:  50, bonusXP: 50, bonusMult: 1.5 }
  ]
};


  // -- Legendary name pools
 
const LEGENDARY_NAMES = {
  // Sharks
  "Blue shark": [
    "Cobalt Kraken-Kisser",
    "Sapphire Slashfin",
    "Azure Ripjaw",
    "Midnight Bluesbane",
    "Turquoise Titan"
  ],
  "Porbeagle shark": [
    "Barking Beagleback",
    "Porbeagle of Perdition",
    "Beaglejaw Battalion",
    "Hound of the Deep",
    "Barkaleviathan"
  ],
  "Thresher shark": [
    "The Threshinator",
    "Whale-Tail Wraith",
    "Scythefin Titan",
    "Thresher’s Requiem",
    "Tailwhip Terror"
  ],
  "Tope": [
    "Topes of Wrath",
    "Abyssal Apex Tope",
    "Tope Terrorizer",
    "Sea-Tope Behemoth",
    "Tip-Top Tornado"
  ],
  "Smoothhound": [
    "Velvet-Jaw Sovereign",
    "Silken Hound of the Deep",
    "Smoothhound Scourge",
    "Lupine Leviathan",
    "Slippery Sovereign"
  ],
  "Spurdog": [
    "Thornspine Tyrant",
    "Spurred Fang Fiend",
    "Spurdog Sovereign",
    "Spikejaw Behemoth",
    "Spinegrip Leviathan"
  ],
  "Bull huss": [
    "Bullhorn Behemoth",
    "Husshammer Herald",
    "Raging Bull Huss",
    "Abyssal Bull Rager",
    "Horned Fury of the Deep"
  ],
  "Lesser spotted dogfish": [
    "Spotsbane Pup",
    "Microspotted Mauler",
    "Dotjaw Desolator",
    "Pup of a Thousand Spots",
    "Dappled Doom"
  ],

  // Rays & Skates
  "Thornback ray": [
    "Thornback Titan",
    "Spikescale Sovereign",
    "Bristleback Brutus",
    "Prickledus Rex",
    "Thornbringer Leviathan"
  ],
  "Blonde ray": [
    "Goldilocks Glider",
    "Blondelord of the Deep",
    "Flaxen Flapper",
    "Sunlit Sovereign",
    "Honeyfin Horror"
  ],
  "Small-eyed ray": [
    "Squintwing Scourge",
    "Pinpoint Prowler",
    "Microsight Marauder",
    "The Squinter Sovereign",
    "Beady-Gaze Behemoth"
  ],
  "Spotted ray": [
    "Polka-Dot Destroyer",
    "Spotstrike Sovereign",
    "Punctal Powerhouse",
    "Polkadot Phantom",
    "Dottedus Rex"
  ],
  "Undulate ray": [
    "Wavelord of the Depths",
    "Rippleback Ravager",
    "Undulatus Titan",
    "Cresting Chaos",
    "Sinuous Scourge"
  ],
  "Cuckoo ray": [
    "Cuckoofin Czar",
    "Lunefin Lunatic",
    "Cuckoorageous Leviathan",
    "Birdfin Behemoth",
    "Devouring Cuckoo"
  ],

  // Flatfish
  "Plaice": [
    "Placidus Rex",
    "Plaicequake Terror",
    "Flatland Fury",
    "Plaice of Peril",
    "Bedrock Beast"
  ],
  "Dab": [
    "Dabolisher of Seas",
    "Dabsolutive Destroyer",
    "The Dabdominator",
    "Abyssal Dabraith",
    "Flat-Strike Fiend"
  ],
  "Flounder": [
    "Flounderwraith",
    "Abyssal Floundraptor",
    "Floudershred Titan",
    "Flounder Fury",
    "Flatfin Phenom"
  ],
  "Sole (common/Dover)": [
    "Solstice Sovereign",
    "Dover Dominator",
    "Solemnus Rex",
    "Sandstride Scourge",
    "Single-Foot Behemoth"
  ],
  "Turbot": [
    "Turbo-Tsunami Turbot",
    "Turbotron Titan",
    "Spottledus Maximus",
    "Abyssal Discus",
    "Turbotoren Ravager"
  ],
  "Brill": [
    "Brilliance Bringer",
    "Brillarific Beast",
    "Abyssal Beacon",
    "Brill’s Wrath",
    "Flatlight Fury"
  ],

  // Eels
  "Conger eel": [
    "Conge-Ravager",
    "Abyssal Congeratron",
    "Coilpede Conqueror",
    "Jawconger Juggernaut",
    "Serpentail Sovereign"
  ],
  "Silver eel": [
    "Argentum Serpent",
    "Silverstrike Sovereign",
    "Sterling Serpent",
    "Gleamjaw Guardian",
    "Moonlit Mamba"
  ],

  // Other Roundfish
  "Cod": [
    "Codzilla",
    "Codfather of Chaos",
    "Abyssal Coddom",
    "Codgaze Colossus",
    "Bountiful Behemoth"
  ],
  "Pollack": [
    "Pollackpocalypse",
    "The Pollack Paladin",
    "Abyssal Pollscraper",
    "Pollackulous Predator",
    "Puncturepoll Conqueror"
  ],
  "Coalfish": [
    "Coalcrusher Titan",
    "Sulfurous Sovereign",
    "Carbocoalus Beast",
    "Emberjaw Leviathan",
    "Blackscale Behemoth"
  ],
  "Bass": [
    "Bassquake Behemoth",
    "Sonic-Boom Bass",
    "Bassdrop Dominator",
    "Lowdown Leviathan",
    "Thunder-Tone Titan"
  ],
  "Mackerel": [
    "Mackerel Maelstrom",
    "Mackersaurus Rex",
    "Flickerfin Fury",
    "Silver-Bullet Beast",
    "Mach-Fin Maverick"
  ],
  "Scad (horse mackerel)": [
    "Hoofin’ Horror",
    "Scadnado Sovereign",
    "Abyssal Stallionfin",
    "Horsepower Ravager",
    "Scaddling Scourge"
  ],
  "Garfish": [
    "Garfury Striker",
    "Spikebeak Sovereign",
    "Garfish Gargantua",
    "Beakblade Beast",
    "Lancer Leviathan"
  ],
  "Whiting": [
    "Whiteout Wraith",
    "Whitelash Terror",
    "Whiting Warlord",
    "Bleachblade Behemoth",
    "Frostfin Fury"
  ],
  "Pouting": [
    "Poutpocalypse",
    "Abyssal Sulker",
    "Poutjaw Juggernaut",
    "Sullen Sovereign",
    "Grumblefin Giant"
  ],
  "Poor cod": [
    "Pitycod Punisher",
    "Patron Saint of Poor Cod",
    "Benevolent Behemoth",
    "Misanthropic Morsel",
    "Underdog of the Deep"
  ],
  "Launce (greater sand eel)": [
    "Lance of the Sandy Depths",
    "Sandlance Scourge",
    "Spearfin Sovereign",
    "Substratum Stabber",
    "Launcetastic Leviathan"
  ],

  // Gurnards & Oddities
  "Red gurnard": [
    "Crimson Crawler",
    "Gurnador of the Deep",
    "Ruby Rumbler",
    "Scarlet Striker",
    "Firefin Fury"
  ],
  "Grey gurnard": [
    "Ashen Ambusher",
    "Greyhound of the Depths",
    "Smokestack Sovereign",
    "Shadowfin Stalker",
    "Fogwing Fiend"
  ],
  "Tub gurnard": [
    "Tubbered Titan",
    "Gurnardian Guardian",
    "Tubstrike Terror",
    "Bulkfin Behemoth",
    "Barrelback Brute"
  ],
  "John Dory": [
    "Doryus Dominator",
    "Lucky Stinger",
    "Zeus-Dory Rex",
    "Singular Scourge",
    "Marblefin Monarch"
  ],

  // Wrasse & Reef Fish
  "Ballan wrasse": [
    "Ballan Basher",
    "Wrassewarrior of the Deep",
    "Boulderjaw Behemoth",
    "Stonecrush Sovereign",
    "Reefbulwark Titan"
  ],
  "Cuckoo wrasse": [
    "Cuckoo Crusader",
    "Wrassewraith",
    "Lunefin Lancer",
    "Eccentrifin Emperor",
    "Cuckooclamor Colossus"
  ],

  // Other Bream & Relatives
  "Ling": [
    "Linglord Leviathan",
    "Sea-Ling Sovereign",
    "Dreadling Destroyer",
    "Lingblade Rumbler",
    "Enduring Eelcod"
  ],
  "Haddock": [
    "Haddockhammer",
    "The Haddominator",
    "Abyssal Flamefin",
    "Pisci-haddock Punisher",
    "Saltshard Sovereign"
  ],
  "Black bream": [
    "Onyx Breambringer",
    "Blackout Behemoth",
    "Shadowbream Scourge",
    "Obsidianjaw Leviathan",
    "Darkfin Dominator"
  ],
  "Gilthead bream": [
    "Gilded Crownfin",
    "Aureate Avenger",
    "Helmbream Herald",
    "Suncrest Sovereign",
    "Goldenhead Guardian"
  ]
};


    // -- Show / Hide helpers
  function show(el) { if(el) el.classList.remove('hidden'); }
  function hide(el) { if(el) el.classList.add('hidden'); }

  // -- Format seconds → "HH:MM:SS"
  function formatTime(sec) {
    const h = String(Math.floor(sec/3600)).padStart(2,'0');
    const m = String(Math.floor((sec%3600)/60)).padStart(2,'0');
    const s = String(sec%60).padStart(2,'0');
    return `${h}:${m}:${s}`;
  }

  // -- Live session timer update
function updateSessionTime() {
  if (!sessionStart) return;
  sessionElapsed = Math.round((Date.now() - sessionStart) / 1000);
  const el = document.getElementById('session-time');
  if (el) el.textContent = formatTime(sessionElapsed);
}

  // -- Determine renown tier by lookup
function getRenownTier(species, length) {
  const tiers = RENOWN[species] || [];
  // Look through the reversed tier array and pick the first whose minCm ≤ length
  return tiers
    .slice().reverse()
    .find(t => length >= t.minCm)   // <-- use minCm here
  || tiers[0];
  }

  // -- Pick a legendary name for this species
  function pickLegendaryName(species) {
    const pool = LEGENDARY_NAMES[species] || [];
    return pool[Math.floor(Math.random()*pool.length)];
  }

  // -- XP needed for next level
function xpForLevel(lv) {
  let xp = 100; // XP needed for level 2
  for (let i = 3; i <= lv; i++) {
    xp *= 2; // Double the XP needed for each subsequent level
  }
  return xp;
}

  // -- Level up if XP threshold crossed
  function maybeLevelUp(p) {
    while (p.xp >= xpForLevel(p.level+1)) {
      p.level++;
      alert(`🔥 Level Up! ${p.name} reached lvl ${p.level}`);
    }
  }

    // Choose anglers
  const profileSection     = document.getElementById('profile-section');
  const profileGrid        = document.getElementById('profile-grid');
  const profileContinueBtn = document.getElementById('profile-continue-btn');
  let viewSessionInitBtn = document.getElementById('view-session-init');
  let viewAllInitBtn     = document.getElementById('view-alltime-init');

  // Profile modal
  const modal            = document.getElementById('profile-modal');
  const modalTitle       = document.getElementById('modal-title');
  const inputName        = document.getElementById('profile-name');
  const inputAge         = document.getElementById('profile-age');
  const avatarOptions    = document.getElementById('avatar-options');
  const saveProfileBtn   = document.getElementById('save-profile-btn');
  const cancelProfileBtn = document.getElementById('cancel-profile-btn');

  // Mode selection
  const modeSection     = document.getElementById('mode-section');
  const modeButtons     = document.querySelectorAll('.mode-btn[data-mode]');
  const modeDescription = document.getElementById('mode-description');
  const modeDescText    = document.getElementById('mode-desc-text');
  const startGameBtn    = document.getElementById('start-game-btn');

  // Game screen
  const gameSection      = document.getElementById('game-section');
  const caughtOneBtn     = document.getElementById('caught-one-btn');
  const scoreList        = document.getElementById('score-list');
  const logList          = document.getElementById('log-list');
  const undoBtn          = document.getElementById('undo-btn');
  const endSessionBtn    = document.getElementById('end-session-btn');

  // Session & All-Time panels
  const toggleSessionBtn  = document.getElementById('toggle-session-profile');
  const sessionPanel      = document.getElementById('session-profile');
  const viewAllBtn        = document.getElementById('view-alltime-profile');
  const alltimeModal      = document.getElementById('alltime-modal');
  const closeAlltimeModal = document.getElementById('close-alltime-modal');

  // Catch flow
const catchFlowSection  = document.getElementById('catch-flow-section');
const anglerButtons     = document.getElementById('angler-buttons');
const fishButtons       = document.getElementById('fish-buttons');
const confirmFishBtn    = document.getElementById('confirm-fish-btn');
const lengthInput       = document.getElementById('length-input');
const lengthContinueBtn = document.getElementById('length-continue-btn');
const catchSummary      = document.getElementById('catch-summary');
const confirmCatchBtn   = document.getElementById('confirm-catch-btn');
const cancelCatchBtn    = document.getElementById('cancel-catch-btn');
const methodButtons     = document.getElementById('method-buttons');      // <-- add this line
const methodContinueBtn = document.getElementById('method-continue-btn'); // <-- add this line
const catchNotes        = document.getElementById('catch-notes');      

  // Select angler modal
  const selectAnglerModal   = document.getElementById('select-angler-modal');
  const selectAnglerButtons = document.getElementById('select-angler-buttons');
  const cancelSelectAngler  = document.getElementById('cancel-select-angler');

    // Render avatar options
  function renderAvatars() {
    avatarOptions.innerHTML = '';
    AVATARS.forEach(file => {
      const img = document.createElement('img');
      img.src        = `media/pictures/${file}`;
      img.dataset.src= file;
      img.className  = 'avatar-option';
      img.addEventListener('click', () => {
        document.querySelectorAll('.avatar-option')
                .forEach(i => i.classList.remove('selected'));
        img.classList.add('selected');
      });
      avatarOptions.appendChild(img);
    });
  }

  // Render profile cards grid
  function renderProfiles() {
    profileGrid.innerHTML = '';
    profiles.forEach(p => {
      const card = document.createElement('div');
      card.className = 'profile-card';
      if (selectedProfiles.includes(p.id)) card.classList.add('selected');
      card.dataset.id = p.id;
      card.innerHTML = `
        <img src="media/pictures/${p.avatarPic}" alt="${p.name}"/>
        <div class="name">${p.name}</div>
        <div class="level">Lvl ${p.level} (${p.xp} XP)</div>
        <div class="edit-icon">✎</div>
      `;
      card.addEventListener('click', e => {
        if (e.target.classList.contains('edit-icon')) openModal(p.id);
        else toggleProfileSelection(p.id);
      });
      profileGrid.appendChild(card);
    });
    if (profiles.length < 6) {
      const add = document.createElement('div');
      add.className = 'add-card';
      add.textContent = '+';
      add.addEventListener('click', () => openModal(null));
      profileGrid.appendChild(add);
    }
    profileContinueBtn.disabled = selectedProfiles.length < 2;
  }

  function toggleProfileSelection(id) {
    const idx = selectedProfiles.indexOf(id);
    if (idx === -1 && selectedProfiles.length < 6) {
      selectedProfiles.push(id);
    } else if (idx > -1) {
      selectedProfiles.splice(idx, 1);
    }
    renderProfiles();
  }

    // Open / close add-edit modal
  function openModal(id) {
    editingId = id;
    modalTitle.textContent = id ? 'Edit Profile' : 'Add Profile';
    if (id) {
      const p = profiles.find(x => x.id === id);
      inputName.value = p.name; inputAge.value = p.age;
    } else {
      inputName.value = ''; inputAge.value = '';
    }
    renderAvatars();
    show(modal);
  }
  function closeModal() {
    hide(modal);
    editingId = null;
  }

  // Save profile
  saveProfileBtn.addEventListener('click', () => {
    const name = inputName.value.trim();
    const age  = parseInt(inputAge.value,10);
    const sel  = document.querySelector('.avatar-option.selected');
    if (!name||!age||!sel) return alert('Name, Age & Avatar required.');
    const avatarPic = sel.dataset.src;
    if (editingId) {
      profiles = profiles.map(p =>
        p.id===editingId?{...p,name,age,avatarPic}:p
      );
    } else {
      profiles.push({
        id: crypto.randomUUID(), name,age,avatarPic,
        xp:0, level:1,
        badges:[], legendaryLog:[], history:[],
        totalFishingTime:0
      });
    }
    saveProfiles(profiles);
    renderProfiles();
    closeModal();
  });
  cancelProfileBtn.addEventListener('click', closeModal);

  // Init choose-anglers screen
  renderProfiles();
  viewSessionInitBtn = document.getElementById('view-session-init');
   viewAllInitBtn     = document.getElementById('view-alltime-init');

  viewSessionInitBtn.addEventListener('click', () => openSelectAngler('session'));
  viewAllInitBtn    .addEventListener('click', () => openSelectAngler('alltime'));

  // Mode buttons
  const MODE_DESC = {
    'Biggest Fish':'Only your single heaviest fish counts.',
    'Heaviest Haul':'Sum of all weights.',
    'Most Fish':'Each catch = 1 point.',
    'Sharks Only':'Only sharks score.'
  };
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMode = btn.dataset.mode;
      modeDescText.textContent = MODE_DESC[selectedMode];
      show(modeDescription);
      startGameBtn.disabled = false;
    });
  });
  profileContinueBtn.addEventListener('click', () => {
    profiles = profiles.filter(p => selectedProfiles.includes(p.id));
    saveProfiles(profiles);
    hide(profileSection);
    show(modeSection);
  });
  startGameBtn.addEventListener('click', () => {
    hide(modeSection);
    initGame();
  });

    function initGame() {
    // Start session timer
    sessionStart = Date.now();
    sessionElapsed = 0;
    updateSessionTime();
    sessionTimerInterval = setInterval(updateSessionTime, 1000);

    // Reveal profile buttons mid-game
    show(viewSessionInitBtn);
    show(viewAllInitBtn);

    // Reset session state
    profiles.forEach(p => p.sessionScore=0);
    logEntries = [];

    show(gameSection);
    renderScoreboard();
    renderLog();
    updateUndo();

    // Wire catch flow & session end
    caughtOneBtn.addEventListener('click',startCatchFlow);
    undoBtn.addEventListener('click',undoCatch);
    endSessionBtn.addEventListener('click',endSession);

    toggleSessionBtn.addEventListener('click',()=>openSelectAngler('session'));
    viewAllBtn.addEventListener('click',   ()=>openSelectAngler('alltime'));
    closeAlltimeModal.addEventListener('click',()=>hide(alltimeModal));
    cancelSelectAngler .addEventListener('click',()=>hide(selectAnglerModal));
  }

function renderScoreboard() {
  scoreList.innerHTML = '';

  // Calculate scores based on selectedMode
  let scores = profiles.map(p => {
    let score = 0;
    let label = '';
    const catches = logEntries.filter(e => e.angler === p.name);

    if (selectedMode === 'Biggest Fish') {
      // Only biggest fish counts
      const biggest = catches.reduce((best, e) => e.weight > best.weight ? e : best, {weight:0});
      score = biggest.weight || 0;
      label = biggest.weight ? `${biggest.fish} (${biggest.weight} lbs, ${biggest.length} cm)` : '—';
    } else if (selectedMode === 'Most Fish') {
      // One point per fish
      score = catches.length;
      label = `${score} fish`;
    } else if (selectedMode === 'Sharks Only') {
      // Only sharks count
      score = catches
        .filter(e => fishData[e.fish]?.category === 'Shark')
        .reduce((sum, e) => sum + e.weight, 0);
      label = score ? `${score.toFixed(2)} lbs` : '—';
    } else {
      // Heaviest Haul (default)
      score = catches.reduce((sum, e) => sum + e.weight, 0);
      label = score ? `${score.toFixed(2)} lbs` : '—';
    }

    return {
      name: p.name,
      level: p.level,
      score,
      label,
      avatar: p.avatarPic
    };
  });

  // Sort by score descending, then name
  scores.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Assign ranks (joint ranks if scores are equal)
  let rank = 1;
  let lastScore = null;
  scores.forEach((s, i) => {
    if (lastScore !== null && s.score < lastScore) rank = i + 1;
    s.rank = rank;
    lastScore = s.score;
  });

  // Render scoreboard
  scores.forEach(s => {
    const li = document.createElement('li');
    li.className = 'scoreboard-row';
    if (s.rank === 1) li.classList.add('leader');
    li.innerHTML = `
      <span class="score-rank">#${s.rank}</span>
      <img src="media/pictures/${s.avatar}" class="score-avatar" alt="${s.name}" />
      <span class="score-name">${s.name}</span>
      <span class="score-level">Lvl ${s.level}</span>
      <span class="score-value">${s.label}</span>
    `;
    scoreList.appendChild(li);
  });
}

function renderLog() {
  const logList = document.getElementById('log-list');
  logList.innerHTML = '';

  logEntries.forEach(e => {
    const entryDiv = document.createElement('div');
    entryDiv.classList.add('log-entry');
    if (e.undo) entryDiv.classList.add('undone-catch'); // Add red X overlay for undone catches

    // Weather & tide info (with emoji)
    const weather = e.weather || {};
    const tide    = e.tide || {};

    entryDiv.innerHTML = `
      <strong>${e.timestamp}</strong> –
      ${e.angler} caught <em>${e.fish}</em>
      (${e.length}cm, ${e.weight}lbs)
      <br>
      <strong>Tier:</strong> ${e.tier || '—'}
      <br>
      <strong>Legendary:</strong> ${e.legendaryName ? `<em>${e.legendaryName}</em>` : '—'}
      <br>
      <strong>Score:</strong> ${e.score} pts
      <br>
      <span><strong>Method:</strong> ${e.method || '—'}</span>
      <br>
      <span><strong>Notes:</strong> ${e.notes || ''}</span>
      <br>
      ${weather.emoji || '❓'} ${weather.temp !== undefined ? weather.temp + '°C' : ''}
      ${weather.wind && weather.wind.arrow ? weather.wind.arrow : ''} ${weather.wind && weather.wind.speed !== undefined ? weather.wind.speed + 'kn' : ''}
      ${tide.marker || '❓'} ${tide.height !== undefined ? tide.height + tide.unit : ''}
    `;
    if (e.lat && e.lng) {
      const a = document.createElement('a');
      a.href        = `https://www.google.com/maps?q=${e.lat},${e.lng}`;
      a.target      = '_blank';
      a.textContent = 'View on map';
      a.classList.add('view-map-link');
      entryDiv.appendChild(a);
    }

    logList.appendChild(entryDiv);
  });

  updateUndo();
}

// Fish Facts feature
const fishFactsBtn = document.getElementById('fish-facts-btn');
const fishFactsSection = document.getElementById('fish-facts-section');
const fishFactsList = document.getElementById('fish-facts-list');
const fishFactsBackBtn = document.getElementById('fish-facts-back-btn');
const fishFactsContinueBtn = document.getElementById('fish-facts-continue-btn');
const fishFactsDetailSection = document.getElementById('fish-facts-detail-section');
const fishFactsTitle = document.getElementById('fish-facts-title');
const fishFactsImg = document.getElementById('fish-facts-img');
const fishFactsBio = document.getElementById('fish-facts-bio');
const fishFactsDetailBackBtn = document.getElementById('fish-facts-detail-back-btn');

let selectedFishFact = null;

// Show Fish Facts list
fishFactsBtn.addEventListener('click', () => {
  hide(gameSection);
  hide(catchFlowSection);
  show(fishFactsSection);
  renderFishFactsList();
});

// Render list of all fish as buttons in a grid
function renderFishFactsList() {
  fishFactsList.innerHTML = '';
  Object.keys(fishData).sort().forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'fish-fact-item blue-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      selectedFishFact = name;
      document.querySelectorAll('.fish-fact-item').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      fishFactsContinueBtn.disabled = false;
    });
    fishFactsList.appendChild(btn);
  });
  fishFactsContinueBtn.disabled = true;
}

// Back button returns to scoreboard/catch log
fishFactsBackBtn.addEventListener('click', () => {
  hide(fishFactsSection);
  show(gameSection); // or show scoreboard/catch log as needed
});

// Continue button shows fish detail
fishFactsContinueBtn.addEventListener('click', () => {
  if (!selectedFishFact) return;
  hide(fishFactsSection);
  show(fishFactsDetailSection);
  fishFactsTitle.textContent = selectedFishFact;
  fishFactsImg.src = `media/fishPics/${fishData[selectedFishFact].img}`;
  fishFactsBio.innerHTML = fishBio[selectedFishFact] || '<p>No bio available.</p>';
});

// Back button on detail page returns to list
fishFactsDetailBackBtn.addEventListener('click', () => {
  hide(fishFactsDetailSection);
  show(fishFactsSection);
});

  function updateUndo() {
    undoBtn.disabled = logEntries.length===0;
  }

function undoCatch() {
  if (!logEntries.length || !confirm('Undo last catch?')) return;
  const rem = logEntries.shift();
  const prof = profiles.find(p=>p.name===rem.angler);
  prof.sessionScore = Math.max(0,prof.sessionScore-rem.score);

  // Add an "undo" record to the catch log
  logEntries.unshift({
    angler: rem.angler,
    fish: rem.fish,
    length: rem.length,
    weight: rem.weight,
    score: 0,
    timestamp: new Date().toLocaleString(),
    tier: rem.tier,
    legendaryName: rem.legendaryName,
    lat: rem.lat,
    lng: rem.lng,
    method: rem.method,
    notes: `Last catch was undone.`,
    undo: true // flag for styling if needed
  });

  renderLog(); renderScoreboard(); updateUndo();
}

function endSession() {
    if (!confirm('End session?')) return;
    clearInterval(sessionTimerInterval);

    const nowMs = Date.now();
    const duration = Math.round((nowMs-sessionStart)/1000);
    const stamp    = new Date().toLocaleString();

  

    saveProfiles(profiles);

    // Reset session timer and UI
    sessionStart = null;
    sessionElapsed = 0;
    const sessionTimeEl = document.getElementById('session-time');
    if (sessionTimeEl) sessionTimeEl.textContent = formatTime(0);

    // Export PDF if needed
    if (confirm('View Full Session Report in a new tab?')) {
      exportFullReportPDF();
    }

    // Hide game-related sections
    hide(
      document.getElementById('game-section'),
      document.getElementById('catch-flow-section'),
      document.getElementById('session-profile'),
      document.getElementById('alltime-modal')
    );

    // Show the "choose anglers" screen
    show(document.getElementById('profile-section'));

    // Reset session data and refresh
    logEntries = [];
    profiles.forEach(p => p.sessionScore = 0);
    renderProfiles();


  // ⬅️ INSERT: export all profiles to PDF, then reload
  exportAllProfilesToPDF();
setTimeout(() => location.reload(), 500);
} // <-- Add this closing brace to properly close endSession()

// Prompt angler→fish→length→confirm
function startCatchFlow() {
  hide(gameSection); show(catchFlowSection);
  hide(document.getElementById('session-profile'));
  hide(document.getElementById('alltime-modal'));

  // Reset notes box for new catch
  catchNotes.value = '';

  showStep('step-angler');
  renderAnglerButtons(); renderFishButtons();
}

function showStep(id) {
  document.querySelectorAll('.catch-step').forEach(s=>hide(s));
  document.getElementById(id).classList.remove('hidden');
}

// Step 1: Select Angler
function renderAnglerButtons() {
  anglerButtons.innerHTML = '';
  profiles.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'angler-btn';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      currentAngler = p;
      showStep('step-fish');
      renderFishButtons();
    });
    anglerButtons.appendChild(btn);
  });
}

// Step 2: Select Fish
function renderFishButtons() {
  fishButtons.innerHTML = '';
  Object.keys(fishData).sort().forEach(sp => {
    const btn = document.createElement('button');
    btn.className = 'fish-btn';
    btn.textContent = sp;
    btn.addEventListener('click', () => {
      currentFish = sp;
      document.querySelectorAll('.fish-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      show(confirmFishBtn);
    });
    fishButtons.appendChild(btn);
  });
 const notSureBtn = document.createElement('button');
  notSureBtn.className = 'fish-btn';
  notSureBtn.textContent = 'Not Sure';
  notSureBtn.addEventListener('click', () => {
    document.querySelectorAll('.fish-btn').forEach(b => b.classList.remove('selected'));
    notSureBtn.classList.add('selected');
    hide(confirmFishBtn); // Hide the normal continue button
    selectedCategory = null;
    selectedIdentifierFish = null;
    showStep('step-fish-category');
    renderFishCategoryButtons();
    fishCategoryContinueBtn.disabled = true;
  });
  fishButtons.appendChild(notSureBtn);
}
confirmFishBtn.addEventListener('click', () => {
  showStep('step-length');
});

// --- Not Sure fish identification flow ---
const notSureBtn = document.getElementById('not-sure-btn');
const fishCategorySection = document.getElementById('step-fish-category');
const fishCategoryButtons = document.getElementById('fish-category-buttons');
const fishCategoryContinueBtn = document.getElementById('fish-category-continue-btn');
const fishIdentifierSection = document.getElementById('step-fish-identifier');
const fishIdentifierPics = document.getElementById('fish-identifier-pics');
const fishIdentifierBackBtn = document.getElementById('fish-identifier-back-btn');
const fishIdentifierContinueBtn = document.getElementById('fish-identifier-continue-btn');

let selectedCategory = null;
let selectedIdentifierFish = null;

notSureBtn.addEventListener('click', () => {
  selectedCategory = null;
  selectedIdentifierFish = null;
  showStep('step-fish-category');
  renderFishCategoryButtons();
  fishCategoryContinueBtn.disabled = true;
});

function renderFishCategoryButtons() {
  const categories = [
    'Shark', 'Ray', 'Flatfish', 'Eel',
    'Roundfish', 'Gurnards and Oddities', 'Wrasse', 'Bream'
  ];
  fishCategoryButtons.innerHTML = '';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      selectedCategory = cat;
      document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      fishCategoryContinueBtn.disabled = false;
    });
    fishCategoryButtons.appendChild(btn);
  });
}

fishCategoryContinueBtn.addEventListener('click', () => {
  selectedIdentifierFish = null;
  showStep('step-fish-identifier');
  renderFishIdentifierPics(selectedCategory);
  fishIdentifierContinueBtn.disabled = true;
});

function renderFishIdentifierPics(category) {
  fishIdentifierPics.innerHTML = '';
  Object.entries(fishData)
    .filter(([name, data]) => data.category === category)
    .forEach(([name, data]) => {
      const div = document.createElement('div');
      div.className = 'fish-id-pic';
      div.innerHTML = `
        <img src="media/fishPics/${data.img}" alt="${name}" style="max-width:120px;">
        <div>${name}</div>
      `;
      div.addEventListener('click', () => {
        selectedIdentifierFish = name;
        document.querySelectorAll('.fish-id-pic').forEach(d => d.classList.remove('selected'));
        div.classList.add('selected');
        fishIdentifierContinueBtn.disabled = false;
      });
      fishIdentifierPics.appendChild(div);
    });
}

fishIdentifierContinueBtn.addEventListener('click', () => {
  if (!selectedIdentifierFish) return;
  currentFish = selectedIdentifierFish;
  showStep('step-length');
});

fishIdentifierBackBtn.addEventListener('click', () => {
  showStep('step-fish-category');
  fishCategoryContinueBtn.disabled = !selectedCategory;
});

// Step 3: Enter Length
lengthContinueBtn.addEventListener('click', () => {
  currentLength = parseFloat(lengthInput.value);
  if (isNaN(currentLength) || currentLength <= 0) {
    alert('Enter valid length.');
    return;
  }
  spec = fishData[currentFish];
  if (!spec) {
    alert(`Error: unknown species "${currentFish}"`);
    return;
  }
  renderMethodButtons();
  showStep('step-method');
});

// Step 4: How? (Method & Notes)
function renderMethodButtons() {
  const methods = ['Ledger', 'Float', 'Feathers', 'Lure'];
  methodButtons.innerHTML = '';
  methods.forEach(method => {
    const btn = document.createElement('button');
    btn.className = 'method-btn';
    btn.textContent = method;
    btn.style.background = '#2196f3';
    btn.style.color = '#fff';
    btn.style.margin = '8px';
    btn.style.borderRadius = '8px';
    btn.addEventListener('click', () => {
      currentMethod = method;
      document.querySelectorAll('.method-btn').forEach(b => b.style.background = '#2196f3');
      btn.style.background = '#c4770dff';
      
    });
    methodButtons.appendChild(btn);
  });
}
methodContinueBtn.addEventListener('click', () => {
  currentNotes = catchNotes.value;
  if (!currentMethod) return alert('Please select a method.');

  // Calculate catch details
  weight = +(currentLength * spec.w).toFixed(2);
  const rawPts = weight * spec.m;
  tierObj = getRenownTier(currentFish, currentLength);
  xpGain  = Math.round(rawPts * 10) + tierObj.bonusXP;
  const bonusM  = tierObj.bonusMult;

  legendaryName = null;
  if (tierObj.name === 'Legendary') {
    legendaryName = pickLegendaryName(currentFish);
    alert(`🎺 Legendary Catch: ${legendaryName}!`);
    currentAngler.badges.push(`legendary-${currentFish}`);
    currentAngler.legendaryLog.push({
      fish: currentFish,
      length: currentLength,
      name: legendaryName,
      time: new Date().toLocaleString()
    });
  }

  finalScore = Math.round(rawPts + bonusM);

  // Show summary
  const fishImg = fishData[currentFish]?.img || 'default-fish.png';

  catchSummary.innerHTML = `
    <img src="media/fishPics/${fishImg}" alt="${currentFish}" style="max-width:200px;display:block;margin:0 auto 12px auto;">
    <p><strong>Angler:</strong> ${currentAngler.name}</p>
    <p><strong>Fish:</strong> ${currentFish}</p>
    <p><strong>Length:</strong> ${currentLength} cm</p>
    <p><strong>Weight:</strong> ${weight} lbs</p>
    <p><strong>Tier:</strong> ${tierObj.name}</p>
    ${legendaryName ? `<p><strong>Legendary Name:</strong> <em>${legendaryName}</em></p>` : ''}
    <p><strong>XP Earned:</strong> ${xpGain}</p>
    <p><strong>Points:</strong> ${finalScore}</p>
    <p><strong>Method:</strong> ${currentMethod}</p>
    <p><strong>Notes:</strong> ${currentNotes}</p>
  `;
  showStep('step-confirm');
});

// Step 5: Confirm Catch
confirmCatchBtn.addEventListener('click', async () => {
  // Update session score & XP for the angler
  currentAngler.sessionScore = (currentAngler.sessionScore || 0) + finalScore;
  currentAngler.xp = (currentAngler.xp || 0) + xpGain;
  maybeLevelUp(currentAngler);

  // Build the base entry
  const entry = {
    angler:    currentAngler.name,
    fish:      currentFish,
    length:    currentLength,
    weight,
    score:     finalScore,
    timestamp: new Date().toLocaleString(),
    tier:      tierObj.name,
    legendaryName,
    lat:       null,
    lng:       null,
    weather:   {},
    tide:      {},
    method:    currentMethod,
    notes:     currentNotes,
  };

  // Attempt geo-fix and fetch weather/tide
  try {
    if (!navigator.geolocation) throw new Error('Geolocation not supported');
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: true, timeout: 5000 }
      )
    );
    entry.lat = pos.coords.latitude.toFixed(6);
    entry.lng = pos.coords.longitude.toFixed(6);
    const [weather, tide] = await Promise.all([
      fetchWeather(entry.lat, entry.lng),
      fetchTide(entry.lat, entry.lng)
    ]);
    entry.weather = weather;
    entry.tide    = tide;
  } catch (err) {
    entry.weather = {
      temp:        'N/A',
      emoji:       '❓',
      description: 'unknown',
      wind:        { speed:'?', unit:'', dir:'', arrow:'' }
    };
    entry.tide = {
      height:   'N/A',
      unit:     'm',
      state:    'N/A',
      marker:   '?',
      nextHigh: null,
      nextLow:  null
    };
  }

  // Log it and finish the catch
  logEntries.unshift(entry);

// Store instantly in all-time profile history
if (!Array.isArray(currentAngler.history)) currentAngler.history = [];
  currentAngler.history.unshift({
  fish: entry.fish,
  length: entry.length,
  weight: entry.weight,
  tier: entry.tier,
  legendaryName: entry.legendaryName,
  lat: entry.lat,
  lng: entry.lng,
  timestamp: entry.timestamp,
  method: entry.method,
  notes: entry.notes,
  score: entry.score
});

  // Update UI and profiles
  renderLog();
  renderScoreboard();
  updateUndo();
  saveProfiles(profiles);
  renderSessionProfile(currentAngler);
  renderAlltimeProfile(currentAngler);

  // Reset and return to game screen
  lengthInput.value = '';
  document.querySelectorAll('.catch-step').forEach(s => s.classList.add('hidden'));
  hide(document.getElementById('step-confirm')); // <-- Add this line
  show(gameSection);
});

  // → CHECK ENDS HERE


// Step 3 → record the catch, now with geo coords + weather/tide



// Helper to DRY up the post-catch logic
function finishCatch() {
  renderLog();
  renderScoreboard();
  updateUndo();
  saveProfiles(profiles);

  // Update all-time profile live
  renderAlltimeProfile(currentAngler);

  // Reset and return to game screen
  lengthInput.value = '';
  hide(catchFlowSection);
  show(gameSection);
}


cancelCatchBtn.addEventListener('click', () => {
  document.querySelectorAll('.catch-step').forEach(s => s.classList.add('hidden'));
  hide(document.getElementById('step-confirm')); // <-- Add this line
  show(gameSection);
});

  // Session & All-Time profile viewers
  function openSelectAngler(mode) {
    selectAnglerButtons.innerHTML='';
    profiles.forEach(p=>{
      const btn=document.createElement('button');
      btn.className='mode-btn';
      btn.textContent=p.name;
      btn.addEventListener('click',()=>{
        hide(selectAnglerModal);
        currentAngler=p;
        if(mode==='session'){
          renderSessionProfile(p); show(sessionPanel);
        } else {
          renderAlltimeProfile(p); show(alltimeModal);
        }
      });
      selectAnglerButtons.appendChild(btn);
    });
    show(selectAnglerModal);
  }

  // ===== Session Profile Rendering =====
  function renderSessionProfile(p) {
  // Header
  document.getElementById('session-angler-name').textContent = p.name;

  // XP Wheel
  const xp   = p.xp;
  const nxt  = xpForLevel(p.level + 1);
  const pct  = Math.min(100, Math.round((xp / nxt) * 100));
  document.getElementById('session-xp-fill').style.width = pct + '%';
  document.getElementById('session-xp-text').textContent = `${xp}/${nxt} XP`;

  // Live timer (show current sessionElapsed)
  document.getElementById('session-time').textContent = formatTime(sessionElapsed);

  // Gather this session’s catches for p
  const catches = logEntries.filter(e => e.angler === p.name);

  // 1) Renown tally
  const renownCounts = { Juvenile:0, Bronze:0, Silver:0, Gold:0, Diamond:0, Legendary:0 };
  catches.forEach(e => renownCounts[e.tier]++);
  const rt = document.getElementById('session-renown-tally');
  rt.innerHTML = '';  
  Object.entries(renownCounts).forEach(([tier, count]) => {
    rt.innerHTML += `<li>${tier}: ${count}</li>`;
  });

  // 2) Species tally
  const speciesCounts = {};
  catches.forEach(e => speciesCounts[e.fish] = (speciesCounts[e.fish] || 0) + 1);
  const st = document.getElementById('session-species-tally');
  st.innerHTML = '';
  Object.entries(speciesCounts).forEach(([fish, cnt]) => {
    st.innerHTML += `<li>${fish}: ${cnt}</li>`;
  });

  // 3) Biggest fish
  let biggest = catches.reduce((best, e) => e.weight > best.weight ? e : best, {weight:0});
  document.getElementById('session-biggest').textContent =
    biggest.weight
      ? `${biggest.fish} at ${biggest.weight} lbs`
      : '—';

  // 4) Most caught species
  let most = Object.entries(speciesCounts).sort((a,b) => b[1]-a[1])[0];
  document.getElementById('session-most-species').textContent =
    most ? `${most[0]} (${most[1]})` : '—';

  // 5) Average weight
  const totalW = catches.reduce((sum, e) => sum + e.weight, 0);
  const avgW   = catches.length ? (totalW / catches.length).toFixed(2) : '—';
  document.getElementById('session-avg-weight').textContent = avgW;

    // 6) Personal catch log for this user (time, fish, species, weight)
const personalLogEl = document.getElementById('session-personal-log');
const personalCatches = logEntries.filter(e => e.angler === p.name);
personalLogEl.innerHTML = personalCatches.length
  ? personalCatches.map(e => `
      <li>
        <strong>${e.timestamp}</strong> –
        ${e.fish} (${e.length}cm, ${e.weight}lbs)
      </li>
    `).join('')
  : '<li>No catches yet.</li>';

  // ...existing code...
}

function renderAlltimeProfile(p) {
  // Header
  document.getElementById('alltime-angler-name').textContent = p.name;

  // XP Wheel
  const xpA   = p.xp;
  const nxtA  = xpForLevel(p.level + 1);
  const pctA  = Math.min(100, Math.round((xpA / nxtA) * 100));
  document.getElementById('alltime-xp-fill').style.width = pctA + '%';
  document.getElementById('alltime-xp-text').textContent = `${xpA}/${nxtA} XP`;

  // Total fishing time
  const liveTotalTime = (p.totalFishingTime || 0) + (sessionStart && p === currentAngler ? sessionElapsed : 0);
  document.getElementById('alltime-time').textContent = formatTime(liveTotalTime);

const allCatches = Array.isArray(p.history)
  ? p.history.flatMap(sess => sess.catches || []).filter(c => c && c.fish)
  : [];

  // 1) Renown tally
  const renownTotals = { Juvenile:0, Bronze:0, Silver:0, Gold:0, Diamond:0, Legendary:0 };
  allCatches.forEach(c => renownTotals[c.tier]++);
  const ar = document.getElementById('alltime-renown-tally');
  ar.innerHTML = '';
  Object.entries(renownTotals).forEach(([tier, cnt]) => {
    ar.innerHTML += `<li>${tier}: ${cnt}</li>`;
  });

  // 2) Species tally
  const speciesTotals = {};
  allCatches.forEach(c => speciesTotals[c.fish] = (speciesTotals[c.fish]||0)+1);
  const ast = document.getElementById('alltime-species-tally');
  ast.innerHTML = '';
  Object.entries(speciesTotals).forEach(([fish, cnt]) => {
    ast.innerHTML += `<li>${fish}: ${cnt}</li>`;
  });

  // 3) Biggest ever per species list
  const biggestEach = {};
  allCatches.forEach(c => {
    if (!biggestEach[c.fish] || c.weight > biggestEach[c.fish].weight) {
      biggestEach[c.fish] = { weight: c.weight };
    }
  });
  const abe = document.getElementById('alltime-biggest-each');
  abe.innerHTML = '';
  Object.entries(biggestEach).forEach(([fish, rec]) => {
    abe.innerHTML += `<li>${fish}: ${rec.weight} lbs</li>`;
  });

  // 4) Most caught species
  let mostA = Object.entries(speciesTotals).sort((a,b) => b[1]-a[1])[0];
  document.getElementById('alltime-most-species').textContent =
    mostA ? `${mostA[0]} (${mostA[1]})` : '—';

  // 5) Average weight across all
  const totalWeight = allCatches.reduce((sum,c)=>sum+c.weight,0);
  const avgAll      = allCatches.length
    ? (totalWeight / allCatches.length).toFixed(2)
    : '—';
  document.getElementById('alltime-avg-weight').textContent = avgAll;

  // 6) All-time catch log (optional – if you want it)

const logEl = document.getElementById('alltime-log-list');
logEl.innerHTML = allCatches.length
  ? allCatches.map(c => `
      <li>
        <strong>${c.fish}</strong>
        ${c.length ? `&nbsp;${c.length}cm` : ''}
        ${c.weight ? `, ${c.weight}lbs` : ''}
        ${c.lat && c.lng ? `
          &nbsp;<a href="https://www.google.com/maps?q=${c.lat},${c.lng}" target="_blank">
            View on map
          </a>
        ` : ''}
      </li>
    `).join('')
  : '<li>No catches yet.</li>';
}

   // ── PDF EXPORT FUNCTION ──────────────────────────────────────
function buildSessionProfileHTML(p) {
  // Find the latest session for this angler
  const lastSession = Array.isArray(p.history) && p.history.length
    ? p.history[p.history.length - 1]
    : null;
  const sessionTime = lastSession ? lastSession.duration : 0;

  // Gather session catches from the latest session
  const catches = lastSession && Array.isArray(lastSession.catches)
    ? lastSession.catches
    : [];

  const renownCounts = { Juvenile:0, Bronze:0, Silver:0, Gold:0, Diamond:0, Legendary:0 };
  const speciesCounts = {};
  let biggest = { fish:'', weight:0 };
  let totalW = 0;

  catches.forEach(e => {
    renownCounts[e.tier]++;
    speciesCounts[e.fish] = (speciesCounts[e.fish] || 0) + 1;
    if (e.weight > biggest.weight) biggest = { fish: e.fish, weight: e.weight };
    totalW += e.weight;
  });

  const mostCaught = Object.entries(speciesCounts)
    .sort((a,b) => b[1] - a[1])[0] || [];
  const avgWeight = catches.length ? (totalW / catches.length).toFixed(2) : '—';

  let html = `
    <h3>Session Profile &mdash; ${p.name}</h3>
    <p><strong>XP:</strong> ${p.xp} (Level ${p.level})</p>
    <p><strong>Session Time:</strong> ${formatTime(sessionTime)}</p>
    <h4>Renown Tally</h4><ul>`;
  Object.entries(renownCounts).forEach(([tier, cnt]) => {
    html += `<li>${tier}: ${cnt}</li>`;
  });
  html += `</ul><h4>Species Tally</h4><ul>`;
  Object.entries(speciesCounts).forEach(([fish, cnt]) => {
    html += `<li>${fish}: ${cnt}</li>`;
  });
  html += `</ul>
    <p><strong>Biggest Fish:</strong> ${biggest.weight ? `${biggest.fish} (${biggest.weight} lbs)` : '—'}</p>
    <p><strong>Most Caught Species:</strong> ${mostCaught.length ? `${mostCaught[0]} (${mostCaught[1]})` : '—'}</p>
    <p><strong>Average Weight:</strong> ${avgWeight} lbs</p>
  `;
  return html;
}

function buildAlltimeProfileHTML(p) {
  // Gather all catches from all sessions
  const allCatches = Array.isArray(p.history)
  ? p.history.flatMap(sess => sess.catches || []).filter(c => c && c.fish)
  : [];

  // Renown tally
  const renownTotals = { Juvenile:0, Bronze:0, Silver:0, Gold:0, Diamond:0, Legendary:0 };
  const speciesTotals = {};
  const biggestEach = {};
  let totalW = 0;

  allCatches.forEach(c => {
    renownTotals[c.tier]++;
    speciesTotals[c.fish] = (speciesTotals[c.fish]||0) + 1;
    if (!biggestEach[c.fish] || c.weight > biggestEach[c.fish].weight) {
      biggestEach[c.fish] = { weight: c.weight };
    }
    totalW += c.weight;
  });

  const mostCaught = Object.entries(speciesTotals)
    .sort((a,b) => b[1] - a[1])[0] || [];
  const avgWeight = allCatches.length ? (totalW / allCatches.length).toFixed(2) : '—';

  let html = `
    <h3>All-Time Profile &mdash; ${p.name}</h3>
    <p><strong>Total Fishing Time:</strong> ${formatTime(p.totalFishingTime||0)}</p>
    <h4>Renown Tally</h4><ul>`;
  Object.entries(renownTotals).forEach(([tier, cnt]) => {
    html += `<li>${tier}: ${cnt}</li>`;
  });
  html += `</ul><h4>Species Tally</h4><ul>`;
  Object.entries(speciesTotals).forEach(([fish, cnt]) => {
    html += `<li>${fish}: ${cnt}</li>`;
  });
  html += `</ul><h4>Biggest Ever per Species</h4><ul>`;
  Object.entries(biggestEach).forEach(([fish, rec]) => {
    html += `<li>${fish}: ${rec.weight.toFixed(2)} lbs</li>`;
  });
  html += `</ul>
    <p><strong>Most Caught Species:</strong> ${mostCaught.length ? `${mostCaught[0]} (${mostCaught[1]})` : '—'}</p>
    <p><strong>Average Weight:</strong> ${avgWeight} lbs</p>
  `;
  return html;
}

// PDF export function: builds full report with session and all-time profiles
function exportFullReportPDF() {
  const c = document.createElement('div');
  c.style.background = '#fff';
  c.style.color      = '#000';
  c.style.fontFamily = 'Arial, sans-serif';

  c.innerHTML = `
    <style>
      .pdf-page { padding: 20px 10px 30px 10px; }
      .pdf-header, .pdf-footer { position: fixed; width: 100%; text-align: center; }
      .pdf-header { top: 10px; font-size: 12px; }
      .pdf-footer { bottom: 10px; font-size: 10px; }
      h1,h2,h3,h4 { margin: 0.5em 0; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 1em; }
      th, td { border:1px solid #000; padding:5px; }
      ul { margin:0.5em 0; padding-left:1.2em; }
      li { margin-bottom:0.2em; }
      hr { border:none; border-top:1px solid #666; margin:1em 0; }
      .catch-entry { margin-bottom: 1.5em; page-break-inside: avoid; }
      .catch-row { display: flex; flex-wrap: wrap; gap: 2em; }
      .catch-label { font-weight: bold; }
      .view-map-link { color: #005fa3; text-decoration: underline; }
      .pdf-break { page-break-after: always; }
    </style>
    <div class="pdf-header">Sea Fishing Score — Full Report</div>
    <div class="pdf-footer">Generated on ${new Date().toLocaleString()}</div>
    <div class="pdf-page">
      <h1>Session Scoreboard</h1>
      <table>
        <thead>
          <tr>
            <th>Angler</th><th>Level</th><th>Session Score</th><th>XP</th>
          </tr>
        </thead>
        <tbody>
          ${profiles.map(p=>`
            <tr>
              <td>${p.name}</td>
              <td>${p.level}</td>
              <td>${p.sessionScore||0}</td>
              <td>${p.xp||0}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <hr>
      <h1>Session Catch Log</h1>
      ${logEntries.map(e=>`
        <div class="catch-entry">
          <div class="catch-row">
            <span class="catch-label">Time:</span> ${e.timestamp}
            <span class="catch-label">Angler:</span> ${e.angler}
            <span class="catch-label">Species:</span> ${e.fish}
          </div>
          <div class="catch-row">
            <span class="catch-label">Length:</span> ${e.length}cm
            <span class="catch-label">Weight:</span> ${e.weight}lbs
            <span class="catch-label">Tier:</span> ${e.tier}
            <span class="catch-label">Score:</span> ${e.score}
          </div>
          <div class="catch-row">
            ${e.legendaryName ? `<span class="catch-label">Legendary:</span> <em>${e.legendaryName}</em>` : ''}
            ${e.lat && e.lng ? `<span class="catch-label">Location:</span> <a href="https://www.google.com/maps?q=${e.lat},${e.lng}&z=15" target="_blank" class="view-map-link">View on map</a>` : ''}
          </div>
          <div class="catch-row">
            <span class="catch-label">Method:</span> ${e.method || '—'}
            <span class="catch-label">Notes:</span> ${e.notes || ''}
          </div>
          <div class="catch-row">
            ${e.weather ? `<span class="catch-label">Weather:</span> ${e.weather.emoji || ''} ${e.weather.temp !== undefined ? e.weather.temp + '°C' : ''} ${e.weather.wind && e.weather.wind.arrow ? e.weather.wind.arrow : ''} ${e.weather.wind && e.weather.wind.speed !== undefined ? e.weather.wind.speed + 'kn' : ''}` : ''}
            ${e.tide ? `<span class="catch-label">Tide:</span> ${e.tide.marker || ''} ${e.tide.height !== undefined ? e.tide.height + e.tide.unit : ''}` : ''}
          </div>
        </div>
      `).join('')}
      <div class="pdf-break"></div>
      ${profiles.map(p=>`
        <h2>Session – ${p.name}</h2>
        ${buildSessionProfileHTML(p)}
        <h3>Personal Catch Log</h3>
        ${(() => {
          const catches = logEntries.filter(e => e.angler === p.name);
          return catches.length
            ? catches.map(e => `
              <div class="catch-entry">
                <div class="catch-row">
                  <span class="catch-label">Time:</span> ${e.timestamp}
                  <span class="catch-label">Species:</span> ${e.fish}
                </div>
                <div class="catch-row">
                  <span class="catch-label">Length:</span> ${e.length}cm
                  <span class="catch-label">Weight:</span> ${e.weight}lbs
                </div>
                <div class="catch-row">
                  <span class="catch-label">Tier:</span> ${e.tier}
                  <span class="catch-label">Score:</span> ${e.score}
                </div>
                <div class="catch-row">
                  ${e.legendaryName ? `<span class="catch-label">Legendary:</span> <em>${e.legendaryName}</em>` : ''}
                  ${e.lat && e.lng ? `<span class="catch-label">Location:</span> <a href="https://www.google.com/maps?q=${e.lat},${e.lng}&z=15" target="_blank" class="view-map-link">View on map</a>` : ''}
                </div>
                <div class="catch-row">
                  <span class="catch-label">Method:</span> ${e.method || '—'}
                  <span class="catch-label">Notes:</span> ${e.notes || ''}
                </div>
                <div class="catch-row">
                  ${e.weather ? `<span class="catch-label">Weather:</span> ${e.weather.emoji || ''} ${e.weather.temp !== undefined ? e.weather.temp + '°C' : ''} ${e.weather.wind && e.weather.wind.arrow ? e.weather.wind.arrow : ''} ${e.weather.wind && e.weather.wind.speed !== undefined ? e.weather.wind.speed + 'kn' : ''}` : ''}
                  ${e.tide ? `<span class="catch-label">Tide:</span> ${e.tide.marker || ''} ${e.tide.height !== undefined ? e.tide.height + e.tide.unit : ''}` : ''}
                </div>
              </div>
            `).join('')
            : '<div>No catches yet.</div>';
        })()}
        <div class="pdf-break"></div>
       <h2>All-Time – ${p.name}</h2>
<div class="alltime-block">${buildAlltimeProfileHTML(p)}</div>
<h3>${p.name}’s All-Time Catch History</h3>
${(() => {
  const allCatches = Array.isArray(p.history)
  ? p.history.flatMap(sess => sess.catches || []).filter(c => c && c.fish)
  : [];
  return allCatches.length ? allCatches.map(e => `
    <div class="catch-entry">
      <div class="catch-row">
        <span class="catch-label">Time:</span> ${e.timestamp}
        <span class="catch-label">Species:</span> ${e.fish}
      </div>
      <div class="catch-row">
        <span class="catch-label">Length:</span> ${e.length}cm
        <span class="catch-label">Weight:</span> ${e.weight}lbs
        <span class="catch-label">Tier:</span> ${e.tier}
        <span class="catch-label">Score:</span> ${e.score}
      </div>
      <div class="catch-row">
        ${e.legendaryName ? `<span class="catch-label">Legendary:</span> <em>${e.legendaryName}</em>` : ''}
        ${e.lat && e.lng ? `<span class="catch-label">Location:</span> <a href="https://www.google.com/maps?q=${e.lat},${e.lng}&z=15" target="_blank" class="view-map-link">View on map</a>` : ''}
      </div>
      <div class="catch-row">
        <span class="catch-label">Method:</span> ${e.method || '—'}
        <span class="catch-label">Notes:</span> ${e.notes || ''}
      </div>
    </div>
  `).join('') : '<div>No catches yet.</div>';
})()}
<div class="pdf-break"></div>
      `).join('')}
    </div>
  `;

  html2pdf()
    .set({
      margin:      [30, 10, 30, 10],
      filename:    `FullReport_${new Date().toISOString().slice(0,10)}.pdf`,
      image:       { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] }
    })
    .from(c)
    .toPdf()
    .get('pdf')
    .then(doc => {
      const pageCount = doc.internal.getNumberOfPages();
      const pageWidth = doc.internal.pageSize.getWidth();
      const footerY   = doc.internal.pageSize.getHeight() - 10;
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.text(`Sea Fishing Score`, pageWidth / 2, 15, { align: 'center' });
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, footerY, { align: 'center' });
      }
      return doc;
    })
    .save();
}

// ─────────────── UPDATED END SESSION ─────────────────────────
function endSession() {
  if (!confirm('End this fishing session?')) return;

  clearInterval(sessionTimerInterval);

  const nowMs = Date.now();
  const duration = Math.round((nowMs - sessionStart) / 1000);
  const stamp = new Date().toLocaleString();

  profiles.forEach(p => {
    if (!Array.isArray(p.history)) p.history = [];

   const catches = logEntries
  .filter(e => e.angler === p.name)
  .map(e => ({
    fish: e.fish,
    length: e.length,
    weight: e.weight,
    tier: e.tier,
    legendaryName: e.legendaryName,
    lat: e.lat,                // <-- add this
    lng: e.lng,                // <-- add this
    timestamp: e.timestamp,    // <-- add this
    method: e.method,          // <-- add this
    notes: e.notes,            // <-- add this
    score: e.score             // <-- add this
  }));

    p.history.push({
      date: stamp, score: p.sessionScore,
      catches, duration
    });
    p.totalFishingTime = (p.totalFishingTime || 0) + duration;
    delete p.sessionScore;
  });

  saveProfiles(profiles);

  // Reset session timer and UI
  sessionStart = null;
  sessionElapsed = 0;
  const sessionTimeEl = document.getElementById('session-time');
  if (sessionTimeEl) sessionTimeEl.textContent = formatTime(0);

  // Prompt and open the PDF in a new tab
  if (confirm('View Full Session Report in a new tab?')) {
    exportFullReportPDF();
  }

  // Hide game-related sections
  hide(
    document.getElementById('game-section'),
    document.getElementById('catch-flow-section'),
    document.getElementById('session-profile'),
    document.getElementById('alltime-modal')
  );

  // Show the "choose anglers" screen
  show(document.getElementById('profile-section'));

  // Reset session data and refresh
  logEntries = [];
  profiles.forEach(p => p.sessionScore = 0);
  renderProfiles();
}

// ───────── Rebind End-Session Button ─────────────────────────
// Note: Do NOT redeclare endSessionBtn if it already exists
// Just remove and re-attach the handler:

endSessionBtn.removeEventListener('click', endSession);
endSessionBtn.addEventListener('click', endSession);


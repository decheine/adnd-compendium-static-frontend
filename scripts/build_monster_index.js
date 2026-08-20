/**
 * build_monster_index.js
 * -----------------------------------------------------------------------------
 * Flattens the site's monster data into a single compact index that the
 * standalone tool at static/tools/monster-editor.html can load and filter.
 *
 *   src/data/ALL_MONSTERS.json   monster pages (statblocks + fullBody HTML)
 *   src/data/Full_Catalog.json   books -> monster_keys
 *   data/all_tsr.json            publish_id -> { title, year, author, setting }
 *   src/data/CatAcronyms.json    setting name -> acronym
 *
 * One monster PAGE may carry several statblocks (e.g. "Drake, Air / Earth /
 * Fire"). The index emits ONE ROW PER STATBLOCK so that numeric filters such as
 * Hit Dice actually discriminate between variants; every row keeps `key` so it
 * can be traced back to its /appendix/<key> page.
 *
 * Raw statblock fields are stored under short codes (see FIELD_CODES) to keep
 * the file small; the editor page carries the same legend.
 *
 *   node scripts/build_monster_index.js
 *   npm run build:monster-index
 *
 * Output: static/tools/monster_index.json  (served at /tools/monster_index.json)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'static', 'tools', 'monster_index.json');
const SCHEMA_VERSION = '1.0.0';

const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

/* ── Field codes ───────────────────────────────────────────────────────────
   Short key -> canonical AD&D 2e statblock label. Kept in sync with the
   FIELD_CODES table inside static/tools/monster-editor.html. */
const FIELD_CODES = {
  ct:  'Climate/Terrain',
  fr:  'Frequency',
  org: 'Organization',
  cyc: 'Activity Cycle',
  dt:  'Diet',
  int: 'Intelligence',
  tr:  'Treasure',
  al:  'Alignment',
  na:  'No. Appearing',
  ac:  'Armor Class',
  mv:  'Movement',
  hd:  'Hit Dice',
  th:  'THAC0',
  noa: 'No. of Attacks',
  dmg: 'Damage/Attack',
  sa:  'Special Attacks',
  sd:  'Special Defenses',
  mr:  'Magic Resistance',
  sz:  'Size',
  mor: 'Morale',
  xp:  'XP Value',
};
/* label -> code, tolerant of the handful of pages with trailing ':' or nbsp */
const LABEL_TO_CODE = {};
for (const [code, label] of Object.entries(FIELD_CODES)) {
  LABEL_TO_CODE[normLabel(label)] = code;
}
function normLabel(s) {
  return String(s).replace(/&nbsp;/g, ' ').replace(/[:\s]+$/, '').trim().toLowerCase();
}

/* ── Normalizers ─────────────────────────────────────────────────────────── */

const clean = (v) =>
  v == null
    ? ''
    : String(v)
        .replace(/<br\s*\/?>/gi, ' / ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;|&rsquo;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

/** First signed integer in a string: "-2 (see below)" -> -2 */
function firstInt(s) {
  const m = /(-?\d+)/.exec(String(s).replace(/,/g, ''));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Hit Dice. AD&D writes these as "4", "4+4", "1-1", "½", "1 hp", "5-10".
 * Returns { hd, hdMod, hdMax, sort } where
 *   hd    base dice (0.5 for ½, 0 for hp-only entries)
 *   hdMod +/- hit point modifier ("4+4" -> 4, "1-1" -> -1)
 *   hdMax upper bound when the entry is a genuine range ("5-10" -> 10)
 *   sort  hd + hdMod/100, so 4+4 sorts just above 4 and 1-1 just below 1
 */
function parseHD(raw) {
  const s = clean(raw);
  if (!s) return { hd: null, hdMod: null, hdMax: null, sort: null };

  // "1 hp", "77-84 hp", "75-150 hit points" — hit points, not hit dice.
  // Guarded so that "17 (97 hit points)" still reads as 17 HD.
  if (/^\s*\d+(\s*[-+]\s*\d+)?(d\d+)?\s*(hp\b|hit\s*points?\b)/i.test(s)) {
    return { hd: 0, hdMod: null, hdMax: null, sort: 0 };
  }

  // fractions
  const frac = { '½': 0.5, '1/2': 0.5, '¼': 0.25, '1/4': 0.25, '¾': 0.75, '3/4': 0.75 };
  for (const [glyph, val] of Object.entries(frac)) {
    if (s.startsWith(glyph)) return { hd: val, hdMod: null, hdMax: null, sort: val };
  }

  // "N-M": M < N (or equal, e.g. the very common "1-1") is a hit-point
  // penalty; M > N is a range of hit dice.
  const range = /^\s*(\d+)\s*-\s*(\d+)/.exec(s);
  if (range) {
    const lo = parseInt(range[1], 10);
    const hi = parseInt(range[2], 10);
    if (hi <= lo) return { hd: lo, hdMod: -hi, hdMax: null, sort: lo - hi / 100 };
    return { hd: lo, hdMod: null, hdMax: hi, sort: lo };
  }

  // "N+M" / plain "N"
  const plus = /^\s*(\d+)\s*\+\s*(\d+)/.exec(s);
  if (plus) {
    const base = parseInt(plus[1], 10);
    const mod = parseInt(plus[2], 10);
    return { hd: base, hdMod: mod, hdMax: null, sort: base + mod / 100 };
  }
  const flat = /^\s*(\d+)/.exec(s);
  if (flat) {
    const base = parseInt(flat[1], 10);
    return { hd: base, hdMod: null, hdMax: null, sort: base };
  }
  // "Varies", "As in life", "Special", ...
  return { hd: null, hdMod: null, hdMax: null, sort: null };
}

/** Size letter code -> label. "M (20'+ wingspan)" -> Medium */
const SIZE_LABELS = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
function parseSize(raw) {
  const s = clean(raw);
  if (!s) return null;
  const m = /^([TSMLHG])\b/.exec(s);
  if (m) return SIZE_LABELS[m[1]];
  for (const label of Object.values(SIZE_LABELS)) {
    if (new RegExp('^' + label, 'i').test(s)) return label;
  }
  return null;
}

/** Intelligence ladder. "Average (8-10)" -> { label: 'Average', score: 8 } */
const INT_LADDER = [
  [/^non-?\b|^none\b/i, 'Non-', 0],
  [/^animal\b/i, 'Animal', 1],
  [/^semi-?\b/i, 'Semi-', 2],
  [/^low\b/i, 'Low', 5],
  [/^average\b/i, 'Average', 8],
  [/^very\b/i, 'Very', 11],
  [/^high(ly)?\b/i, 'High', 13],
  [/^exceptional\b/i, 'Exceptional', 15],
  [/^genius\b/i, 'Genius', 17],
  [/^supra-?genius\b/i, 'Supra-genius', 19],
  [/^god-?like\b|^deity\b/i, 'Godlike', 21],
];
function parseIntelligence(raw) {
  const s = clean(raw);
  if (!s) return { label: null, score: null };
  // supra-genius must beat the "genius" test
  const ordered = [INT_LADDER[10], INT_LADDER[9], ...INT_LADDER.slice(0, 9)];
  let label = null,
    base = null;
  for (const [re, name, val] of ordered) {
    if (re.test(s)) {
      label = name;
      base = val;
      break;
    }
  }
  const inParens = /\((\d+)/.exec(s);
  const score = inParens ? parseInt(inParens[1], 10) : base;
  return { label, score };
}

/** Frequency -> one of the five canonical rarities. */
function parseFrequency(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  if (/^very\s+rare/.test(s)) return 'Very rare';
  if (/^unique/.test(s)) return 'Unique';
  if (/^uncommon/.test(s)) return 'Uncommon';
  if (/^rare/.test(s)) return 'Rare';
  if (/^common/.test(s)) return 'Common';
  if (/^mythical/.test(s)) return 'Mythical';
  return null;
}

/** Diet -> broad bucket. */
function parseDiet(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  if (/^omnivor/.test(s)) return 'Omnivore';
  if (/^carnivor/.test(s)) return 'Carnivore';
  if (/^herbivor/.test(s)) return 'Herbivore';
  if (/^insectivor/.test(s)) return 'Carnivore';
  if (/^scaveng/.test(s)) return 'Scavenger';
  if (/^(nil|none|n\/a)\b/.test(s)) return 'None';
  if (/^special|^see /.test(s)) return 'Special';
  return 'Other';
}

/** Activity cycle -> Any / Day / Night / Other. */
function parseCycle(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  if (/^any\b|^all\b/.test(s)) return 'Any';
  if (/^(day|diurnal)\b/.test(s)) return 'Day';
  if (/^(night|nocturnal|dark)/.test(s)) return 'Night';
  return 'Other';
}

/** Alignment -> canonical two-letter code where one is recoverable. */
function parseAlignment(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  if (/^any\b/.test(s)) return 'Any';
  if (/^(nil|none|n\/a)\b/.test(s)) return 'None';
  const law = /lawful/.test(s) ? 'L' : /chaotic/.test(s) ? 'C' : /neutral/.test(s) ? 'N' : null;
  const good = /good/.test(s) ? 'G' : /evil/.test(s) ? 'E' : /neutral/.test(s) ? 'N' : null;
  if (law === 'N' && (good === 'N' || good === null)) return 'N';
  if (law && good) return law + good;
  return null;
}

/** Movement: base ground rate plus movement-mode flags. */
function parseMovement(raw) {
  const s = clean(raw);
  if (!s) return { base: null, modes: [] };
  const base = firstInt(s.split(',')[0]);
  const modes = [];
  if (/\bFl\b/i.test(s)) modes.push('Fly');
  if (/\bSw\b/i.test(s)) modes.push('Swim');
  if (/\bBr\b/i.test(s)) modes.push('Burrow');
  if (/\bWb\b/i.test(s)) modes.push('Web');
  if (/\bCl\b/i.test(s)) modes.push('Climb');
  if (/\bJp\b/i.test(s)) modes.push('Jump');
  return { base: Number.isFinite(base) ? base : null, modes };
}

/** XP: "1,400" -> 1400; "Varies" -> null. */
function parseXP(raw) {
  const s = clean(raw).replace(/,/g, '');
  if (!/^\s*\d/.test(s)) return null;
  return firstInt(s);
}

/* ── Build ───────────────────────────────────────────────────────────────── */

function build() {
  const monsters = read('src', 'data', 'ALL_MONSTERS.json');
  const catalog = read('src', 'data', 'Full_Catalog.json');
  const allTsr = read('data', 'all_tsr.json');
  const catAcronyms = read('src', 'data', 'CatAcronyms.json');

  /* Books: prefer Full_Catalog (it carries monster_keys), fall back to
     all_tsr for publish ids a monster cites but the catalog does not list. */
  /** Upstream leaves a few titles blank ("TerrorsFromAbove"); derive one. */
  function bookTitle(raw, id) {
    const t = clean(raw);
    if (t) return t;
    return String(id).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').trim() || ('Book ' + id);
  }

  const books = {};
  for (const b of catalog) {
    if (!b || !b.publish_id) continue;
    books[b.publish_id] = {
      title: bookTitle(b.title, b.publish_id),
      year: b.year || null,
      author: clean(b.author) || null,
      setting: b.setting || null,
      acr: catAcronyms[b.setting] || null,
      count: 0,
    };
  }
  for (const [id, b] of Object.entries(allTsr)) {
    if (books[id]) continue;
    books[id] = {
      title: bookTitle(b.title, id),
      year: b.year || null,
      author: clean(b.author) || null,
      setting: b.setting || null,
      acr: catAcronyms[b.setting] || null,
      count: 0,
    };
  }

  const rows = [];
  let rowId = 0;
  const unknownBooks = new Set();
  let pagesWithoutStatblock = 0;

  for (const page of monsters) {
    const md = page.monster_data || {};
    const key = page.monster_key;
    const pageTitle = clean(page.title || md.title || key);
    const setting = md.setting || null;

    /* Sources: `sources` and `monster_data.TSR` agree on nearly every page;
       union them so nothing is dropped. */
    const sources = Array.from(
      new Set([...(page.sources || []), ...(md.TSR || [])].map(String).filter(Boolean))
    ).sort();
    for (const id of sources) if (!books[id]) unknownBooks.add(id);

    /* Page-level psionics flag — the Psionics Summary table lives in the
       page body, not in any one statblock. Notable for Dark Sun. */
    const psionic = /Psionics Summary/i.test(md.fullBody || '');

    const statblocks = md.statblock && typeof md.statblock === 'object' ? md.statblock : {};
    const names = Object.keys(statblocks);
    if (!names.length) {
      pagesWithoutStatblock++;
      rows.push(makeRow(++rowId, key, pageTitle, pageTitle, setting, sources, {}, psionic, catAcronyms));
      continue;
    }
    for (const name of names) {
      const fields = statblocks[name];
      if (!fields || typeof fields !== 'object') continue;
      rows.push(
        makeRow(++rowId, key, pageTitle, clean(name), setting, sources, fields, psionic, catAcronyms)
      );
    }
  }

  for (const r of rows) for (const id of r.src) if (books[id]) books[id].count++;

  const settings = Array.from(new Set(rows.map((r) => r.set).filter(Boolean))).sort();

  const out = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    source: 'src/data/ALL_MONSTERS.json',
    fieldCodes: FIELD_CODES,
    counts: {
      pages: monsters.length,
      rows: rows.length,
      books: Object.keys(books).length,
      settings: settings.length,
      pagesWithoutStatblock,
    },
    settings,
    settingAcronyms: catAcronyms,
    books,
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
  console.log(`monster_index.json written -> ${path.relative(ROOT, OUT)} (${mb} MB)`);
  console.log(`  ${monsters.length} pages -> ${rows.length} statblock rows`);
  console.log(`  ${Object.keys(books).length} books, ${settings.length} settings`);
  if (pagesWithoutStatblock) console.log(`  ${pagesWithoutStatblock} page(s) had no statblock (kept as a row)`);
  if (unknownBooks.size) {
    console.warn(`  WARNING: ${unknownBooks.size} publish id(s) cited by a monster are in neither`);
    console.warn(`  Full_Catalog.json nor all_tsr.json: ${Array.from(unknownBooks).join(', ')}`);
  }
}

function makeRow(id, key, pageTitle, name, setting, sources, fields, psionic, catAcronyms) {
  /* raw statblock values, keyed by short code */
  const sb = {};
  for (const [label, value] of Object.entries(fields)) {
    const code = LABEL_TO_CODE[normLabel(label)];
    const text = clean(value);
    if (!text) continue;
    if (code) {
      if (!sb[code]) sb[code] = text;
    } else {
      // Non-standard label (Birthright bloodlines, Spelljammer ship stats…)
      if (!sb.x) sb.x = {};
      sb.x[clean(label).replace(/:$/, '')] = text;
    }
  }

  const hd = parseHD(sb.hd);
  const intel = parseIntelligence(sb.int);
  const mv = parseMovement(sb.mv);

  return {
    id,
    key,                                  // monster_key -> /appendix/<key>
    page: pageTitle,                      // monster page title
    name: name || pageTitle,              // this statblock's creature name
    set: setting,                         // campaign setting
    acr: catAcronyms[setting] || null,
    src: sources,                         // publish ids == "Found In" books
    psi: psionic || undefined,
    sb,
    // derived, for sorting and numeric filters
    d: {
      hd: hd.hd,
      hdMod: hd.hdMod,
      hdMax: hd.hdMax,
      hdSort: hd.sort,
      ac: firstInt(sb.ac),
      thac0: firstInt(sb.th),
      xp: parseXP(sb.xp),
      mor: firstInt((sb.mor || '').replace(/^[^(]*\(/, '')) ?? firstInt(sb.mor),
      mv: mv.base,
      modes: mv.modes.length ? mv.modes : undefined,
      sz: parseSize(sb.sz),
      int: intel.label,
      intScore: intel.score,
      fr: parseFrequency(sb.fr),
      dt: parseDiet(sb.dt),
      cyc: parseCycle(sb.cyc),
      al: parseAlignment(sb.al),
      noa: firstInt(sb.noa),
    },
  };
}

if (require.main === module) build();
module.exports = { build, parseHD, parseSize, parseIntelligence, parseAlignment, FIELD_CODES };

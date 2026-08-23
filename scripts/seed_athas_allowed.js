/**
 * seed_athas_allowed.js
 * -----------------------------------------------------------------------------
 * Applies the "Monsters of Athas" appendix from the Dark Sun boxed set — the
 * list of creatures from other Monstrous Compendium volumes that suit Athas —
 * to static/tools/monster_index.json, adding `ds` to their allowedSettings.
 *
 * The mapping lives in data/athas_allowed_list.json rather than in this file so
 * the curation stays reviewable: every printed entry is there with the page(s)
 * it resolved to, the judgement calls spelled out, and the two entries that
 * matched nothing left visible instead of quietly dropped.
 *
 *   node scripts/seed_athas_allowed.js            apply
 *   node scripts/seed_athas_allowed.js --dry-run  report without writing
 *
 * Idempotent: rows already carrying the target acronym are left alone. Safe to
 * re-run after build_monster_index.js, which carries curated lists forward.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'static', 'tools', 'monster_index.json');
const LIST = path.join(ROOT, 'data', 'athas_allowed_list.json');
const DRY = process.argv.includes('--dry-run');

function main() {
  if (!fs.existsSync(INDEX)) {
    console.error('No monster_index.json — run scripts/build_monster_index.js first.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  const target = list.target;

  /* Canonical acronym order, so a seeded list reads the same as a hand-edited one. */
  const order = Object.keys(data.settingByAcronym || {})
    .sort((a, b) => data.settingByAcronym[a].localeCompare(data.settingByAcronym[b]));
  const sortAcr = (a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
  };

  const byPage = new Map();
  for (const r of data.rows) {
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(r);
  }

  let tagged = 0, already = 0, skipped = 0;
  const missingPages = [];
  const unmatchedEntries = [];
  const perEntry = [];

  for (const e of list.entries) {
    if (!e.pages.length) { unmatchedEntries.push(e.entry); continue; }
    const exclude = new Set(e.excludeStatblocks || []);
    let n = 0, hit = 0;

    for (const page of e.pages) {
      const rows = byPage.get(page);
      if (!rows) { missingPages.push(e.entry + ' -> ' + page); continue; }
      for (const r of rows) {
        if (exclude.has(r.name)) { skipped++; continue; }
        hit++;
        const allow = Array.isArray(r.allowedSettings) ? r.allowedSettings : [];
        if (allow.includes(target)) { already++; continue; }
        if (!DRY) r.allowedSettings = allow.concat(target).sort(sortAcr);
        tagged++; n++;
      }
    }
    perEntry.push({ entry: e.entry, volume: e.volume, matched: hit, newlyTagged: n, note: e.note });
  }

  console.log((DRY ? 'DRY RUN — ' : '') + 'Monsters of Athas -> allowedSettings "' + target + '"');
  console.log('  ' + tagged + ' row(s) newly tagged');
  console.log('  ' + already + ' row(s) already carried it');
  if (skipped) console.log('  ' + skipped + ' row(s) skipped by an explicit exclusion');
  if (missingPages.length) {
    console.log('\n  PAGE NOT IN INDEX (the list names it, the data does not have it):');
    for (const m of missingPages) console.log('    - ' + m);
  }
  if (unmatchedEntries.length) {
    console.log('\n  PRINTED ENTRIES THAT MATCHED NOTHING:');
    for (const m of unmatchedEntries) console.log('    - ' + m);
  }
  const noted = perEntry.filter(e => e.note);
  if (noted.length) {
    console.log('\n  ENTRIES CARRYING A NOTE:');
    for (const e of noted) console.log('    - ' + e.entry + ' [' + e.volume + '] ' + e.matched + ' row(s): ' + e.note);
  }

  if (DRY) { console.log('\nNothing written.'); return; }
  data.seededAt = new Date().toISOString();
  fs.writeFileSync(INDEX, JSON.stringify(data));
  console.log('\nWrote ' + path.relative(ROOT, INDEX));
}

if (require.main === module) main();

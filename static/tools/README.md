# `/tools` — standalone browser tools

Plain HTML/JS pages that ship with the site (Gatsby copies `static/` to the web
root verbatim), so they are reachable at e.g.
`https://www.completecompendium.com/tools/monster-editor.html`.

## `monster-editor.html` — Monster Filter & Editor

A single-file table view over every statblock in the compendium, with the
filters the Gatsby site does not offer: **Found in** (sourcebook), setting,
hit dice range, XP range, size, intelligence, frequency, alignment, diet and
movement mode.

### Data

It reads `monster_index.json` from the same folder. That file is **generated** —
do not hand-edit it as a source of truth:

```
node scripts/build_monster_index.js     # or: npm run build:monster-index
```

The build flattens `src/data/ALL_MONSTERS.json` into **one row per statblock**
(2,499 monster pages → ~3,509 rows), because a single page such as
*Elemental (Athas), Lesser* carries several creatures with different hit dice.
Each row keeps its `key`, so it links back to `/appendix/<key>` on the live site.

Sourcebooks come from `src/data/Full_Catalog.json` (falling back to
`data/all_tsr.json`), which is what makes the **Found in** filter possible: it
matches on a monster's `sources` / `TSR` publish ids rather than on the single
`setting` field. Those are different questions — 267 statblocks have
`setting: "Dark Sun"`, but 319 appear in a Dark Sun sourcebook, the extra ones
being Monstrous-Manual staples reprinted in *DSE2 Black Spine* and friends.

### `allowedSettings`

Every row carries `allowedSettings`, an array of setting acronyms (`ds`, `fr`,
`ps`…) naming the campaign settings a creature may be used in. It defaults to
the row's own `acr` — one entry — because a creature starts out allowed only
where it was printed.

The point is that this is editable. A great many perfectly good Athasian
encounters are Monstrous Manual stock reprinted in *DSE2 Black Spine*; ticking
`ds` on them says "this one is welcome on Athas" without pretending it was ever
a Dark Sun monster. The `Allowed in` column shows the creature's own setting in
gold and anything added in green, and the `Allowed in` filter reads the array
rather than the single `setting` field.

**Tag view…** applies a change to every row currently in view, which is how you
tag a batch rather than 300 rows one at a time: filter to the books you want,
open the tagger, tick a setting, then **Add**, **Remove**, or **Replace**. The
confirm names the setting and the row count before anything changes.

**Seeded from the boxed set.** The Dark Sun campaign setting shipped a
"Monsters of Athas" appendix naming creatures from other Monstrous Compendium
volumes that suit Athas. That list is transcribed in
`data/athas_allowed_list.json` — every printed entry with the page(s) it
resolved to, the judgement calls written down, and the entries that matched
nothing left visible rather than quietly dropped — and applied by:

```
node scripts/seed_athas_allowed.js --dry-run   # report only
node scripts/seed_athas_allowed.js             # apply
```

It is idempotent and safe to re-run after a rebuild. It tags 139 rows, taking
`allowed in ds` from 267 to 406.

These edits are curation, not derived data, so `build_monster_index.js` reads
the previous `monster_index.json` and carries every non-default list forward,
matching rows on page key + statblock name rather than on the positional `id`.
A rebuild will not silently reset your tagging — but the file is still
generated, so commit it once you have curation worth keeping.

### Running it

Fetching a local JSON file only works over HTTP, so either serve the folder:

```
npx serve static      # -> http://localhost:3000/tools/monster-editor.html
npm run develop       # -> http://localhost:8000/tools/monster-editor.html
```

…or open the `.html` straight off disk and click **Open JSON…** to pick
`static/tools/monster_index.json` by hand.

### Using it

- **Dark Sun preset** ticks every Dark Sun sourcebook in *Found in* at once.
- *Found in* matches **any of** the selected books by default; switch to
  **all of these** to find monsters that appear in several books.
- Click a column header to sort, drag a column edge to resize, `☰` to show or
  hide columns. Layout is remembered per browser.
- Click a row to open it; edit any field and hit **Apply**. Derived values
  (hit dice, AC, size, intelligence…) are recomputed from what you typed.
- **Save** / **Save As…** write the whole index back out; **Export view…**
  downloads just the filtered rows as CSV or JSON.

Keys: `Ctrl+S` save · `Ctrl+F` search · `Ctrl+↑`/`Ctrl+↓` previous/next row ·
`Esc` close panel.

### Editing caveat

Edits are saved into `monster_index.json`, which is a **derived** file.
`allowedSettings` survives a rebuild (see above); everything else — corrected
hit dice, renamed creatures, fixed sources — does **not**, and will be
overwritten the next time the index is generated. Treat those as a scratchpad
and a way to export corrections; changes meant to stick belong in
`src/data/ALL_MONSTERS.json`.

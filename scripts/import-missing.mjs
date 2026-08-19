// Additive, idempotent importer for listings that exist in the spreadsheet but NOT yet in D1.
//
//   node scripts/import-missing.mjs "data/Rentoo data 2026.xlsx"                      # dry run
//   node scripts/import-missing.mjs "data/Rentoo data 2026.xlsx" --captions "/path/RENTOO"
//   node scripts/import-missing.mjs "data/Rentoo data 2026.xlsx" --apply              # writes D1
//
// Why this exists rather than re-running scripts/import-excel.mjs: that script mints
// crypto.randomUUID() ids and index-derived slugs on every run, so a second run would duplicate
// every listing and hand the duplicates brand-new URLs. This one keys on display_id ("#123",
// "##14", "C-3"), which is the spreadsheet's own Property ID and the only stable identity we have.
//
// Guarantees:
//   * INSERT only. There is no UPDATE and no DELETE anywhere in this file. A display_id already
//     in D1 is skipped untouched, so re-running is a no-op.
//   * A slug is minted once, at insert time, and checked against every slug already in D1.
//     Slugs are live URLs and the R2 media path prefix — they must never move afterwards.
//   * Slugs are hard-validated against ^[a-z0-9-]+$ before they reach SQL or an R2 key.
//   * D1 is reached through the authenticated wrangler session; no D1/R2 API keys needed.
//
// Rows whose Property ID exists but whose every other cell is blank are placeholder rows (the
// sheet pre-numbers ids far ahead of the data) and are reported, never invented into listings.

import { execFileSync } from 'node:child_process';
import { parseRent, parseAreaSqft } from './lib/parse-rent.mjs';
export { parseRent, parseAreaSqft };
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const DB = 'rentoo-listings';

export const RESIDENTIAL_SHEETS = ['Inventory (Below 50K) ', 'Inventory (Above 50K)'];
export const COMMERCIAL_SHEET = 'Commercial';

const SEGMENTS = new Set(['residential', 'commercial', 'industrial']);
const STATUSES = new Set(['available', 'rented', 'on-hold']);
const FURNISHINGS = new Set(['furnished', 'semi-furnished', 'unfurnished']);
// Warehouses and factories are 'industrial', not 'commercial' — see migrations/0002.
const INDUSTRIAL_TYPES = new Set(['warehouse', 'factory']);
// /admin/new is a static route, so a listing slugged "new" could never be opened in the editor.
const RESERVED_SLUGS = new Set(['new']);

// The 16 Jaipur major areas (docs/jaipur-area-hierarchy.md). A brand-new neighbourhood tag only
// gets a major_slug automatically when it IS one of these; anything else is left NULL and
// reported, because guessing which major area a landmark belongs to is a human decision.
export const MAJOR_AREAS = [
  ['mansarovar', 'Mansarovar'], ['vaishali-nagar', 'Vaishali Nagar'], ['malviya-nagar', 'Malviya Nagar'],
  ['c-scheme', 'C-Scheme'], ['jagatpura', 'Jagatpura'], ['vidhyadhar-nagar', 'Vidhyadhar Nagar'],
  ['raja-park', 'Raja Park'], ['tonk-road', 'Tonk Road'], ['jhotwara', 'Jhotwara'],
  ['bani-park', 'Bani Park'], ['sodala-ajmer-road', 'Sodala / Ajmer Road'], ['gopalpura', 'Gopalpura'],
  ['durgapura', 'Durgapura'], ['pratap-nagar', 'Pratap Nagar'], ['sitapura', 'Sitapura'],
  ['civil-lines', 'Civil Lines'], ['bapu-nagar', 'Bapu Nagar'], ['mahesh-nagar', 'Mahesh Nagar'],
];

// ---------------------------------------------------------------- pure helpers

export function slugify(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function titlecase(s) {
  return String(s ?? '').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** SQL literal. Doubles single quotes; null/empty become NULL. */
export function esc(v) {
  return v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
}

/** Slugs are interpolated into SQL and into R2 object keys — anything else is a hard stop. */
export function assertSlugSafe(slug, what = 'slug') {
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`unsafe ${what}: ${JSON.stringify(slug)} (must match ^[a-z0-9-]+$)`);
  }
  return slug;
}

/**
 * Rent as written in the sheet. Mirrors scripts/import-excel.mjs so a listing imported here reads
 * the same as its neighbours: "35000" | 35000 | "90K+ maintainance" | "1.2 lakh" | "15" -> 15000.
 */

export function bhkOf(type) {
  if (!type) return null;
  const s = String(type);
  const m = s.match(/(\d+)\s*bhk/i);
  if (m) return `${m[1]}BHK`;
  if (/studio/i.test(s)) return 'Studio';
  return null;
}

export function ptypeOf(keyFeatures) {
  if (!keyFeatures) return 'property';
  return String(keyFeatures).trim().toLowerCase().replace(/appartment/g, 'apartment').replace(/\s+/g, ' ');
}

export function normalizeFurnishing(v) {
  const s = String(v ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (s.includes('semi')) return 'semi-furnished';
  if (s.includes('unfurnished') || s.includes('bare')) return 'unfurnished';
  if (s.includes('furnish')) return 'furnished';
  return null;
}

export function normalizeStatus(v) {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('rent') && !s.includes('for rent')) return 'rented';
  if (s.includes('hold')) return 'on-hold';
  return 'available';
}

function looksBad(s) {
  const t = String(s ?? '').trim();
  return !t || t.length < 2 || /^https?:/i.test(t) || /maps\.app|google\./i.test(t) || /^[\d.\s,\-]+$/.test(t);
}

/** Area name = last comma-separated part of Location, else the Landmark. */
export function areaOf(location, landmark) {
  let a = '';
  if (location) {
    const parts = String(location).split(',');
    a = parts[parts.length - 1].trim();
    if (looksBad(a)) a = '';
  }
  if (!a && landmark && !looksBad(landmark)) a = String(landmark).trim();
  return a;
}

export function mapUrlOf(location) {
  const m = String(location ?? '').match(/https?:\/\/\S*(?:maps\.app\.goo\.gl|google\.[^/\s]*\/maps)\S*/i);
  return m ? m[0] : null;
}

/**
 * True when the row carries any fact at all. The sheet pre-numbers Property IDs hundreds of rows
 * ahead of the data, so most rows are an id and nothing else; those are not listings.
 */
export function rowHasData(row, idKey = 'Property ID') {
  return Object.entries(row).some(([k, v]) => k !== idKey && v != null && String(v).trim() !== '');
}

/** Sheet row -> listing fields (no id, no slug — those are minted in planImport). */
export function sheetRowToListing(row, kind) {
  const displayId = String(row['Property ID'] ?? '').trim();
  if (kind === 'commercial') {
    const landmark = row['Landmark'];
    const area = areaOf(row['Location'], landmark) || 'Jaipur';
    const propertyType = ptypeOf(row['Key Feature']);
    // Commercial rents are sometimes quoted per sq ft, so the area has to reach the parser.
    // Strip-non-digits would also turn "15R + Banquet" into 15, so parseAreaSqft rejects prose.
    const areaSqft = parseAreaSqft(row['Area (sqft)']);
    const rent = parseRent(row['Rent'], areaSqft);
    return {
      display_id: displayId,
      segment: INDUSTRIAL_TYPES.has(propertyType) ? 'industrial' : 'commercial',
      bhk_type: null,
      property_type: propertyType,
      rent_inr: rent,
      area_sqft: areaSqft,
      furnishing: normalizeFurnishing(row['Furnishing']),
      status: normalizeStatus(row['Status']),
      landmark: landmark ? String(landmark).trim() : null,
      neighbourhood_slug: slugify(area),
      neighbourhood_name: titlecase(area),
      map_url: mapUrlOf(row['Column 1']) ?? mapUrlOf(row['Location']),
      description: propertyType ? titlecase(propertyType) : null,
      published: rent > 0 ? 1 : 0,
      slug_base: slugify(`${propertyType} ${row['Location'] || landmark || area}`),
    };
  }

  const landmark = row['Landmark'];
  const area = areaOf(row['Loction'], landmark) || 'Jaipur';
  const propertyType = ptypeOf(row['Key Features']);
  const bhk = bhkOf(row['Type']);
  const availableFor = row['Available for '] ?? row['Available for'];
  const rent = parseRent(row['Rent (₹)']);
  return {
    display_id: displayId,
    segment: 'residential',
    bhk_type: bhk,
    property_type: propertyType,
    rent_inr: rent,
    area_sqft: null,
    furnishing: normalizeFurnishing(row['Furnishing']),
    status: normalizeStatus(row['Property status']),
    landmark: landmark ? String(landmark).trim() : null,
    neighbourhood_slug: slugify(area),
    neighbourhood_name: titlecase(area),
    map_url: mapUrlOf(row['Loction']),
    description: [propertyType && titlecase(propertyType), availableFor].filter(Boolean).join(' · ') || null,
    published: rent > 0 ? 1 : 0,
    slug_base: slugify(`${bhk || ''} ${propertyType} ${landmark || area}`),
  };
}

// ---------------------------------------------------------------- caption fallback

/** Plain money out of caption prose: "₹3,00,000 per month" -> 300000. First number wins. */
export function parseMoney(text) {
  const m = String(text ?? '').match(/([\d][\d,]*(?:\.\d+)?)/);
  if (!m) return 0;
  const n = Math.round(parseFloat(m[1].replace(/,/g, '')));
  return isFinite(n) ? n : 0;
}

// The label must open its own line (after the emoji), otherwise the headline
// "#03 FOR RENT: 3BHK SEMI-FURNISHED …" is read as the Rent field and yields ₹3.
const captionField = (text, label) => {
  const re = new RegExp(`^[^A-Za-z]*${label}\\s*:\\s*(.+)$`, 'i');
  const m = String(text ?? '').split(/\r?\n/).map((l) => l.trim().match(re)).find(Boolean);
  return m ? m[1].trim() : null;
};

// Commercial captions have no "Property:" line — they name the type in the headline
// ("🏢 Warehouse for Rent | Near Arambhkala Foundation"). Longest match first.
const TYPE_WORDS = [
  ['office space', 'office space'], ['house portion', 'house portion'], ['warehouse', 'warehouse'],
  ['factory', 'factory'], ['restaurant', 'restaurant'], ['banquet', 'banquet'], ['hotel', 'hotel'],
  ['library', 'library'], ['showroom', 'showroom'], ['penthouse', 'penthouse'], ['villa', 'villa'],
  ['apartment', 'apartment'], ['office', 'office space'], ['flat', 'apartment'], ['shop', 'shop'],
];
export function typeFromHeadline(text) {
  const first = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const s = first.toLowerCase();
  const hit = TYPE_WORDS.find(([word]) => s.includes(word));
  return hit ? hit[1] : null;
}

/**
 * Pull the facts out of an Instagram/WhatsApp marketing caption. This is a SECONDARY source: the
 * captions carry rent, location, BHK, furnishing and sometimes size, but never Property status,
 * never a map URL, and never a neighbourhood we can trust as an area tag. Everything it cannot
 * find comes back null so the caller can see exactly what would have to be guessed.
 */
export function parseCaption(text) {
  const s = String(text ?? '');
  const property = captionField(s, 'Property');
  const location = captionField(s, 'Location');
  const rentLine = captionField(s, 'Rent');
  const statusLine = captionField(s, 'Status');
  const sizeLine = captionField(s, 'Size') ?? captionField(s, 'Area');

  let bhk = null;
  let propertyType = null;
  if (property) {
    bhk = bhkOf(property);
    propertyType = property
      .replace(/\d+\s*bhk/gi, '').replace(/studio/gi, '')
      .replace(/\+\s*(basement|servant)/gi, '')
      .replace(/[+|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() || null;
  }
  if (!propertyType) propertyType = typeFromHeadline(s);
  if (!bhk) bhk = bhkOf(String(s).split(/\r?\n/)[0] ?? '');

  const rent = rentLine ? parseMoney(rentLine.replace(/₹/g, '')) : 0;
  const furnishing = normalizeFurnishing(`${statusLine ?? ''} ${property ?? ''}`);
  const areaSqft = sizeLine && /sq/i.test(sizeLine) ? parseMoney(sizeLine) || null : null;

  return {
    bhk_type: bhk,
    property_type: propertyType,
    location: location && !/^\[.*\]$/.test(location) ? location : null,
    rent_inr: rent >= 1000 ? rent : 0, // a caption always writes the full amount; anything smaller is a ₹/sqft rate
    furnishing,
    area_sqft: areaSqft,
  };
}

/** Caption -> the same listing shape as sheetRowToListing, for ids the sheet has no data for. */
export function captionToListing(displayId, text, kind = 'residential') {
  const c = parseCaption(text);
  const area = c.location ? areaOf(c.location, null) || c.location : 'Jaipur';
  const propertyType = c.property_type || 'property';
  const commercial = kind === 'commercial';
  return {
    display_id: displayId,
    segment: commercial ? (INDUSTRIAL_TYPES.has(propertyType) ? 'industrial' : 'commercial') : 'residential',
    bhk_type: commercial ? null : c.bhk_type,
    property_type: propertyType,
    rent_inr: c.rent_inr,
    area_sqft: c.area_sqft,
    furnishing: c.furnishing,
    status: 'available',       // captions never state it; "available" is the schema default
    landmark: c.location ?? null,
    neighbourhood_slug: slugify(area),
    neighbourhood_name: titlecase(area),
    map_url: null,             // never present in a caption
    description: titlecase(propertyType) || null,
    published: c.rent_inr > 0 ? 1 : 0,
    slug_base: slugify(`${commercial ? '' : c.bhk_type || ''} ${propertyType} ${area}`),
  };
}

// ---------------------------------------------------------------- planning

/** `base`, else base-2, base-3 … `taken` is mutated so a single batch cannot collide with itself. */
export function uniqueSlug(base, taken) {
  const clean = slugify(base) || 'listing';
  let slug = clean;
  for (let i = 2; RESERVED_SLUGS.has(slug) || taken.has(slug); i++) slug = `${clean}-${i}`;
  taken.add(slug);
  return slug;
}

export function majorFor(neighbourhoodSlug) {
  const hit = MAJOR_AREAS.find(([slug]) => slug === neighbourhoodSlug);
  return hit ? { major_slug: hit[0], major_area: hit[1] } : { major_slug: null, major_area: null };
}

/**
 * Decide what to insert. Never returns an update or a delete — the only verb this script knows
 * is INSERT, and only for a display_id D1 has never seen.
 */
export function planImport({ candidates, dbListings, dbNeighbourhoods, nextOrder = 0 }) {
  const existingIds = new Set(dbListings.map((r) => String(r.display_id).trim()));
  const takenSlugs = new Set(dbListings.map((r) => r.slug));
  const knownNbhds = new Set(dbNeighbourhoods.map((n) => n.slug));

  const insert = [];
  const skipExisting = [];
  const newNeighbourhoods = [];
  const warnings = [];
  const seen = new Set();
  let order = nextOrder;

  for (const c of candidates) {
    const id = String(c.display_id ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) throw new Error(`duplicate Property ID among the candidates: ${id}`);
    seen.add(id);
    if (existingIds.has(id)) { skipExisting.push(id); continue; }

    if (!SEGMENTS.has(c.segment)) throw new Error(`${id}: invalid segment ${JSON.stringify(c.segment)}`);
    if (!STATUSES.has(c.status)) throw new Error(`${id}: invalid status ${JSON.stringify(c.status)}`);
    if (c.furnishing != null && !FURNISHINGS.has(c.furnishing)) {
      throw new Error(`${id}: invalid furnishing ${JSON.stringify(c.furnishing)}`);
    }
    if (!c.property_type) throw new Error(`${id}: property_type is NOT NULL in the schema`);
    if (!c.neighbourhood_slug) throw new Error(`${id}: neighbourhood_slug is NOT NULL in the schema`);
    assertSlugSafe(c.neighbourhood_slug, 'neighbourhood_slug');

    const slug = assertSlugSafe(uniqueSlug(c.slug_base, takenSlugs));
    if (c.rent_inr <= 0) warnings.push(`${id}: rent is 0 — inserted as an unpublished draft`);
    if (c.source === 'caption') warnings.push(`${id}: reconstructed from a marketing caption — verify before publishing`);

    insert.push({ ...c, id: randomUUID(), display_id: id, slug, published: c.rent_inr > 0 ? 1 : 0 });

    if (!knownNbhds.has(c.neighbourhood_slug)) {
      knownNbhds.add(c.neighbourhood_slug);
      const major = majorFor(c.neighbourhood_slug);
      newNeighbourhoods.push({
        slug: c.neighbourhood_slug,
        name: c.neighbourhood_name || titlecase(c.neighbourhood_slug.replace(/-/g, ' ')),
        display_order: ++order,
        ...major,
      });
      if (!major.major_slug) {
        warnings.push(`new area "${c.neighbourhood_slug}" has no major_slug — it will only show under "All areas" until someone maps it in seed/neighbourhood-areas.sql`);
      }
    }
  }

  return { insert, skipExisting, newNeighbourhoods, warnings };
}

/**
 * SQL for the plan. ON CONFLICT DO NOTHING is belt-and-braces on top of the display_id check:
 * even in a race with another writer this can only ever fail to insert, never overwrite.
 */
export function buildSql(plan) {
  const lines = [];
  for (const n of plan.newNeighbourhoods) {
    lines.push(
      'INSERT INTO neighbourhoods (slug,name,display_order,major_slug,major_area) VALUES ('
      + [esc(n.slug), esc(n.name), n.display_order, esc(n.major_slug), esc(n.major_area)].join(',')
      + ') ON CONFLICT DO NOTHING;',
    );
  }
  for (const p of plan.insert) {
    assertSlugSafe(p.slug);
    assertSlugSafe(p.neighbourhood_slug, 'neighbourhood_slug');
    lines.push(
      'INSERT INTO properties (id,display_id,segment,bhk_type,property_type,rent_inr,area_sqft,'
      + 'furnishing,status,landmark,neighbourhood_slug,map_url,description,slug,published) VALUES ('
      + [
        esc(p.id), esc(p.display_id), esc(p.segment), esc(p.bhk_type), esc(p.property_type),
        Number(p.rent_inr) || 0, p.area_sqft == null ? 'NULL' : Number(p.area_sqft),
        esc(p.furnishing), esc(p.status), esc(p.landmark), esc(p.neighbourhood_slug),
        esc(p.map_url), esc(p.description), esc(p.slug), p.published ? 1 : 0,
      ].join(',')
      + ') ON CONFLICT DO NOTHING;',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- I/O

const wrangler = (args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function d1Query(sql) {
  const out = wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

function d1Apply(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'rentoo-import-'));
  const file = join(dir, 'import-missing.sql');
  try {
    writeFileSync(file, sql);
    return wrangler(['d1', 'execute', DB, '--remote', '--json', '--file', file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function readWorkbook(path) {
  const XLSX = await import('xlsx');
  return XLSX.read(readFileSync(path), { type: 'buffer' });
}

/** Every listing the spreadsheet actually carries data for, in sheet order. */
export function candidatesFromWorkbook(wb, XLSX) {
  const json = (name) => (wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null }) : []);
  const out = [];
  const placeholders = [];
  for (const sheet of RESIDENTIAL_SHEETS) {
    for (const row of json(sheet)) {
      const id = String(row['Property ID'] ?? '').trim();
      if (!id) continue;
      if (!rowHasData(row)) { placeholders.push(id); continue; }
      out.push({ ...sheetRowToListing(row, 'residential'), source: `sheet:${sheet.trim()}` });
    }
  }
  for (const row of json(COMMERCIAL_SHEET)) {
    const id = String(row['Property ID'] ?? '').trim();
    if (!id) continue;
    if (!rowHasData(row)) { placeholders.push(id); continue; }
    out.push({ ...sheetRowToListing(row, 'commercial'), source: `sheet:${COMMERCIAL_SHEET}` });
  }
  return { candidates: out, placeholders };
}

/** id -> caption text, from the marketing .xlsx files sitting in the Drive export. */
export async function readCaptions(path) {
  const XLSX = await import('xlsx');
  const files = statSync(path).isDirectory()
    ? readdirSync(path).filter((f) => extname(f).toLowerCase() === '.xlsx' && !f.startsWith('~$')).map((f) => join(path, f))
    : [path];
  const byId = new Map();
  for (const file of files) {
    const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
    const commercial = /commercial/i.test(file);
    for (const sheet of wb.SheetNames) {
      for (const row of XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: null })) {
        const [rawId, text] = row;
        if (!rawId || !text || typeof text !== 'string') continue;
        const id = String(rawId).trim();
        if (!/^#{1,2}\d+$|^C-\d+$/i.test(id)) continue;
        // '#1' -> '#01' / '##1' -> '##01': D1 and the sheet zero-pad, the caption files do not.
        const norm = id.replace(/^(#{1,2})(\d)$/, '$10$2');
        if (!byId.has(norm)) byId.set(norm, { text, kind: commercial ? 'commercial' : 'residential', file });
      }
    }
  }
  return byId;
}

// ---------------------------------------------------------------- CLI

function pad(s, n) { return String(s).padEnd(n); }

async function main() {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');
  const positional = argv.filter((a) => !a.startsWith('-'));
  const capIdx = argv.indexOf('--captions');
  const captionsPath = capIdx >= 0 ? argv[capIdx + 1] : null;
  const sheetPath = positional.find((a) => a !== captionsPath) ?? 'data/Rentoo data 2026.xlsx';

  const XLSX = await import('xlsx');
  const wb = await readWorkbook(sheetPath);
  const { candidates, placeholders } = candidatesFromWorkbook(wb, XLSX);

  const dbListings = d1Query('SELECT display_id, slug FROM properties');
  const dbNeighbourhoods = d1Query('SELECT slug, name, major_slug, major_area, display_order FROM neighbourhoods');
  const nextOrder = dbNeighbourhoods.reduce((m, n) => Math.max(m, Number(n.display_order) || 0), 0);
  const inDb = new Set(dbListings.map((r) => String(r.display_id).trim()));

  // Ids that have no data anywhere: a bare placeholder row in the sheet AND not in D1.
  const unsourced = placeholders.filter((id) => !inDb.has(id));

  let captions = new Map();
  const captionOnly = [];
  if (captionsPath) {
    captions = await readCaptions(captionsPath);
    for (const id of unsourced) {
      const cap = captions.get(id);
      if (!cap) continue;
      candidates.push({ ...captionToListing(id, cap.text, cap.kind), source: 'caption' });
      captionOnly.push(id);
    }
  }

  const plan = planImport({ candidates, dbListings, dbNeighbourhoods, nextOrder });

  console.log(`spreadsheet:        ${sheetPath}`);
  console.log(`rows with data:     ${candidates.length}   id-only placeholder rows: ${placeholders.length}`);
  console.log(`already in D1:      ${plan.skipExisting.length}`);
  console.log(`to insert:          ${plan.insert.length}   new neighbourhoods: ${plan.newNeighbourhoods.length}`);
  if (captionsPath) console.log(`caption fallback:   ${captions.size} captions read, ${captionOnly.length} used`);

  const stillUnsourced = unsourced.filter((id) => !captionOnly.includes(id));
  if (stillUnsourced.length) {
    console.log(`\nno data anywhere (placeholder row in the sheet, absent from D1) — ${stillUnsourced.length}:`);
    console.log('  ' + stillUnsourced.join(' '));
    console.log('  These cannot be imported. The sheet must be refreshed, or the facts supplied by hand.');
  }

  if (plan.newNeighbourhoods.length) {
    console.log('\nnew neighbourhoods:');
    for (const n of plan.newNeighbourhoods) {
      console.log(`  ${pad(n.slug, 32)} ${pad(n.name, 28)} major=${n.major_slug ?? '(none — needs a human)'}`);
    }
  }

  if (plan.insert.length) {
    console.log('\nlistings to insert:');
    for (const p of plan.insert) {
      console.log(`  ${pad(p.display_id, 7)} ${pad(p.segment, 11)} ${pad(p.bhk_type ?? '-', 7)} ${pad(p.property_type, 14)}`
        + ` ₹${pad(p.rent_inr, 8)} ${pad(p.status, 10)} pub=${p.published} ${pad(p.neighbourhood_slug, 22)} -> ${p.slug}`);
    }
  }

  if (plan.warnings.length) {
    console.log('\nwarnings:');
    for (const w of plan.warnings) console.log('  ! ' + w);
  }

  // Cross-check only — this branch never proposes a write. It surfaces where the marketing
  // captions disagree with what D1 already holds, which is how the ₹/sq-ft rent rows were found.
  if (captionsPath && captions.size) {
    const rows = d1Query('SELECT display_id, rent_inr, area_sqft, furnishing FROM properties');
    const diffs = [];
    for (const r of rows) {
      const cap = captions.get(String(r.display_id).trim());
      if (!cap) continue;
      const c = parseCaption(cap.text);
      if (c.rent_inr > 0 && c.rent_inr !== r.rent_inr) diffs.push(`${r.display_id}: rent D1=${r.rent_inr} caption=${c.rent_inr}`);
      if (c.area_sqft != null && r.area_sqft != null && c.area_sqft !== r.area_sqft) diffs.push(`${r.display_id}: area D1=${r.area_sqft} caption=${c.area_sqft}`);
    }
    console.log(`\ncaption cross-check against D1 (read-only, no writes proposed): ${diffs.length} disagreements`);
    for (const d of diffs) console.log('  ~ ' + d);
  }

  const sql = buildSql(plan);
  if (!APPLY) {
    if (sql) console.log('\nSQL that would run:\n' + sql.split('\n').map((l) => '  ' + l).join('\n'));
    console.log('\ndry run — nothing written. add --apply');
    return;
  }
  if (!sql) { console.log('\nnothing to insert.'); return; }
  console.log('\napplying…');
  d1Apply(sql);
  console.log(`inserted ${plan.insert.length} listings and ${plan.newNeighbourhoods.length} neighbourhoods.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });

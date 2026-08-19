// Import "Rentoo data 2026.xlsx" -> seed/properties.sql (+ seed/photos.json for the Drive photo step).
// Run: npx tsx scripts/import-excel.mjs
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { slugify, normalizeFurnishing, normalizeStatus } from './lib/transform.ts';
import { parseRent, parseAreaSqft } from './lib/parse-rent.mjs';

const FILE = 'data/Rentoo data 2026.xlsx';
const wb = XLSX.read(readFileSync(FILE), { type: 'buffer' });
const J = (sn) => XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
const esc = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const titlecase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

function bhkOf(type) {
  if (!type) return null;
  const s = String(type);
  const m = s.match(/(\d+)\s*bhk/i);
  if (m) return `${m[1]}BHK`;
  if (/studio/i.test(s)) return 'Studio';
  return null;
}
function ptype(keyFeatures) {
  if (!keyFeatures) return 'property';
  return String(keyFeatures).trim().toLowerCase().replace(/appartment/g, 'apartment').replace(/\s+/g, ' ');
}
function looksBad(s) {
  const t = String(s ?? '').trim();
  return !t || t.length < 2 || /^https?:/i.test(t) || /maps\.app|google\./i.test(t) || /^[\d.\s,\-]+$/.test(t);
}
function areaOf(loction, landmark) {
  let a = '';
  if (loction) { const p = String(loction).split(','); a = p[p.length - 1].trim(); if (looksBad(a)) a = ''; }
  if (!a && landmark && !looksBad(landmark)) a = String(landmark).trim();
  return a;
}
function mapUrlOf(loction) {
  const m = String(loction ?? '').match(/https?:\/\/\S*(?:maps\.app\.goo\.gl|google\.[^/\s]*\/maps)\S*/i);
  return m ? m[0] : null;
}

let idx = 0;
const props = [];
const photos = [];
const nbhds = new Map();
const usedDisplay = new Map();
const statusCount = {};
const addNbhd = (slug, name) => { if (slug && !nbhds.has(slug)) nbhds.set(slug, { slug, name, order: nbhds.size }); };
function uniqDisplay(raw) {
  let d = String(raw).trim();
  const n = (usedDisplay.get(d) ?? 0) + 1;
  usedDisplay.set(d, n);
  return n === 1 ? d : `${d}-${n}`;
}

// ---- Residential ----
for (const sheet of ['Inventory (Below 50K) ', 'Inventory (Above 50K)']) {
  for (const r of J(sheet)) {
    const rawId = r['Property ID'];
    if (!rawId) continue;
    const landmark = r['Landmark'];
    const area = areaOf(r['Loction'], landmark) || 'Jaipur';
    const nslug = slugify(area); addNbhd(nslug, titlecase(area));
    const status = normalizeStatus(String(r['Property status'] ?? ''));
    statusCount[status] = (statusCount[status] || 0) + 1;
    idx++;
    const pt = ptype(r['Key Features']);
    const bhk = bhkOf(r['Type']);
    const availFor = r['Available for '] ?? r['Available for'];
    const desc = [pt && titlecase(pt), availFor].filter(Boolean).join(' · ') || null;
    const slug = slugify(`${bhk || ''} ${pt} ${landmark || area}`, idx);
    let rent = parseRent(r['Rent (₹)']);
    if (rent > 0 && rent < 1000) rent *= 1000; // residential rents are in thousands ("15" -> 15000)
    props.push({
      id: crypto.randomUUID(), display_id: uniqDisplay(rawId), segment: 'residential',
      bhk_type: bhk, property_type: pt, rent_inr: rent,
      area_sqft: null, furnishing: r['Furnishing'] ? normalizeFurnishing(String(r['Furnishing'])) : null,
      status, landmark: landmark || null, neighbourhood_slug: nslug, map_url: mapUrlOf(r['Loction']),
      description: desc, slug, published: rent > 0 ? 1 : 0,
    });
    const drive = r['Photos'];
    if (drive && /drive\.google/.test(String(drive))) photos.push({ display_id: String(rawId).trim(), slug, drive_url: String(drive).trim() });
  }
}

// ---- Commercial ----
for (const r of J('Commercial')) {
  const rawId = r['Property ID'];
  if (!rawId) continue;
  const landmark = r['Landmark'];
  const area = areaOf(r['Location'], landmark) || 'Jaipur';
  const nslug = slugify(area); addNbhd(nslug, titlecase(area));
  const status = normalizeStatus(String(r['Status'] ?? ''));
  statusCount[status] = (statusCount[status] || 0) + 1;
  idx++;
  const pt = ptype(r['Key Feature']);
  const slug = slugify(`${pt} ${r['Location'] || landmark || area}`, idx);
  const areaSqft = r['Area (sqft)'] ? Math.round(Number(String(r['Area (sqft)']).replace(/[^0-9.]/g, ''))) || null : null;
  const rent = parseRent(r['Rent'], parseAreaSqft(r['Area (sqft)']));
  props.push({
    id: crypto.randomUUID(), display_id: uniqDisplay(rawId), segment: 'commercial',
    bhk_type: null, property_type: pt, rent_inr: rent,
    area_sqft: areaSqft, furnishing: r['Furnishing'] ? normalizeFurnishing(String(r['Furnishing'])) : null,
    status, landmark: landmark || null, neighbourhood_slug: nslug, map_url: null,
    description: pt ? titlecase(pt) : null, slug, published: rent > 0 ? 1 : 0,
  });
}

// ---- SQL (only "live" rows: rent > 0; empty placeholder rows are dropped) ----
const NOW = new Date().toISOString();
const live = props.filter((p) => p.rent_inr > 0);
const liveNbhds = new Map();
for (const p of live) if (!liveNbhds.has(p.neighbourhood_slug)) liveNbhds.set(p.neighbourhood_slug, nbhds.get(p.neighbourhood_slug));
const liveSlugs = new Set(live.map((p) => p.slug));
const livePhotos = photos.filter((ph) => liveSlugs.has(ph.slug));

let sql = '';
for (const n of liveNbhds.values())
  sql += `INSERT INTO neighbourhoods (slug,name,display_order) VALUES (${esc(n.slug)},${esc(n.name)},${n.order}) ON CONFLICT(slug) DO UPDATE SET name=excluded.name;\n`;
for (const p of live)
  sql += `INSERT INTO properties (id,display_id,segment,bhk_type,property_type,rent_inr,area_sqft,furnishing,status,landmark,neighbourhood_slug,map_url,description,slug,published,created_at) VALUES (`
    + [esc(p.id), esc(p.display_id), esc(p.segment), esc(p.bhk_type), esc(p.property_type), p.rent_inr, (p.area_sqft == null ? 'NULL' : p.area_sqft), esc(p.furnishing), esc(p.status), esc(p.landmark), esc(p.neighbourhood_slug), esc(p.map_url), esc(p.description), esc(p.slug), 1, esc(NOW)].join(',')
    + `) ON CONFLICT(slug) DO UPDATE SET rent_inr=excluded.rent_inr,status=excluded.status,published=1,display_id=excluded.display_id,landmark=excluded.landmark,neighbourhood_slug=excluded.neighbourhood_slug,map_url=excluded.map_url;\n`;

mkdirSync('seed', { recursive: true });
writeFileSync('seed/properties.sql', sql);
writeFileSync('seed/photos.json', JSON.stringify(livePhotos, null, 1));

const sc = {}; for (const p of live) sc[p.status] = (sc[p.status] || 0) + 1;
console.log('LIVE properties:', live.length, '| residential:', live.filter((p) => p.segment === 'residential').length, '| commercial:', live.filter((p) => p.segment === 'commercial').length);
console.log('skipped empty/zero-rent rows:', props.length - live.length);
console.log('neighbourhoods:', liveNbhds.size);
console.log('status counts (live):', JSON.stringify(sc));
console.log('listings with map_url:', live.filter((p) => p.map_url).length);
console.log('listings with Drive photos:', livePhotos.length);
console.log('distinct furnishing:', JSON.stringify([...new Set(live.map((p) => p.furnishing))]));
console.log('distinct property_type:', JSON.stringify([...new Set(live.map((p) => p.property_type))]));
console.log('rent range:', Math.min(...live.map((p) => p.rent_inr)), '-', Math.max(...live.map((p) => p.rent_inr)));
console.log('sample neighbourhoods:', JSON.stringify([...liveNbhds.values()].slice(0, 12).map((n) => n.name)));
console.log('sample props:', JSON.stringify(live.slice(0, 2), null, 1));

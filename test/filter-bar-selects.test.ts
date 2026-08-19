import { expect, test, describe } from 'vitest';
// Read the pages as text (Vite's ?raw) rather than rendering them: the repo has no DOM test
// runner, and these are source-level invariants.
//
// This file used to guard the Base UI <Select> in src/components/FilterBar.tsx, which needed an
// `items` prop for <Select.Value> to resolve a label during SSR — without it the trigger rendered
// the raw value ("most-viewed" instead of "Most viewed"). That component is gone: the public
// filter bar is now a native <form method="get"> inlined into each listing page, so the hydration
// hazard it guarded cannot exist any more.
//
// The user-visible invariant behind it survives, and so does this file: the filter menus must
// still offer human labels rather than raw slugs, every offered value must still be one the query
// builder actually implements, and — new with the island's removal — the three pages each carry
// their own copy of the option lists, so they can now silently drift apart.
import rentSrc from '../src/pages/rent/index.astro?raw';
import commercialSrc from '../src/pages/commercial/index.astro?raw';
import industrialSrc from '../src/pages/industrial/index.astro?raw';
import sqlSrc from '../src/lib/sql.ts?raw';
import typesSrc from '../src/lib/types.ts?raw';

const PAGES: [string, string][] = [
  ['rent', rentSrc],
  ['commercial', commercialSrc],
  ['industrial', industrialSrc],
];

// `const NAME: [string, string][] = [ ['value', 'Label'], ... ];`
function itemsMap(src: string, name: string): [string, string][] {
  const block = src.match(new RegExp(`const ${name}: \\[string, string\\]\\[\\] = \\[[\\s\\S]*?\\n\\];`));
  if (!block) throw new Error(`no ${name} in this page`);
  return [...block[0].matchAll(/\[\s*'([^']*)',\s*'([^']*)'\s*\]/g)].map((m) => [m[1], m[2]]);
}

// The filter bar's own <select> elements, whole, so the options inside can be inspected.
function filterSelects(src: string): string[] {
  return [...src.matchAll(/<select\b[^>]*class="filter-select-trigger"[\s\S]*?<\/select>/g)].map((m) => m[0]);
}

describe.each(PAGES)('the %s filter bar', (name, src) => {
  const hasBhk = name === 'rent'; // BHK is residential-only; the other two bars omit that group

  test('is a plain GET form, not a client-side island', () => {
    // The whole point of removing FilterBar.tsx: these controls only ever rewrote the query
    // string and reloaded, which is what a GET form does unaided. A `client:` directive
    // reappearing here means the React runtime is back on a public listing page.
    expect(src).toMatch(/<form[^>]*class="filter-bar"[^>]*method="get"/);
    expect(src).not.toMatch(/client:(load|visible|idle|only|media)/);
  });

  test('every filter select renders its options from a list, never hand-written', () => {
    const selects = filterSelects(src);
    expect(selects.length).toBe(hasBhk ? 4 : 3); // sort, area, (bhk), furnishing
    for (const el of selects) {
      const name = el.match(/name="(\w+)"/)?.[1];
      expect(el, `${name}: options are not generated from a list`).toMatch(/(\w+_ITEMS|areas)\.map\(/);
      // The only literal <option> allowed is the empty "no filter" one on the areas select —
      // anything else is a hand-written entry that can drift from the values the server accepts.
      for (const [, value] of el.matchAll(/<option value="([^"]*)"/g)) {
        expect(value, `${name}: hand-written option "${value}"`).toBe('');
      }
    }
  });

  test('each menu opens with an empty "no filter" option, so a filter can be cleared', () => {
    for (const map of ['SORT_ITEMS', 'FURNISHING_ITEMS', ...(hasBhk ? ['BHK_ITEMS'] : [])]) {
      const items = itemsMap(src, map);
      expect(items.length, `${map} is empty`).toBeGreaterThan(1);
      expect(items[0][0], `${map} does not start with the empty value`).toBe('');
      expect(items.filter(([v]) => v === '').length, `${map} has two empty values`).toBe(1);
    }
  });

  test('the values that regressed carry human labels', () => {
    // The original bug: these rendered as their raw slugs in the trigger. A native <select> shows
    // the selected option's own text, so the guard is now that the text is not the slug itself.
    const labels = Object.fromEntries([...itemsMap(src, 'SORT_ITEMS'), ...itemsMap(src, 'FURNISHING_ITEMS')]);
    expect(labels['most-viewed']).toBe('Most viewed');
    expect(labels['semi-furnished']).toBe('Semi-furnished');
    for (const [value, label] of Object.entries(labels)) {
      expect(label, `"${value}" is shown as its own slug`).not.toBe(value);
      expect(label.trim(), `"${value}" has no label`).not.toBe('');
    }
  });

  test('every sort option is one the query builder actually orders by', () => {
    // A sort value with no `case` in orderByFor falls through to the default ordering, so the
    // menu would offer a choice that silently does nothing.
    const orderBy = sqlSrc.match(/function orderByFor[\s\S]*?\n}/)![0];
    const implemented = new Set([...orderBy.matchAll(/case '([^']+)'/g)].map((m) => m[1]));
    for (const [value] of itemsMap(src, 'SORT_ITEMS')) {
      if (value === '') continue; // the empty value is the default ordering
      expect(implemented.has(value), `sort=${value} has no case in orderByFor`).toBe(true);
    }
  });

  test('every furnishing option is a value the column can hold', () => {
    const union = typesSrc.match(/export type Furnishing = ([^;]+);/)![1];
    const allowed = new Set([...union.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    for (const [value] of itemsMap(src, 'FURNISHING_ITEMS')) {
      if (value === '') continue;
      expect(allowed.has(value), `furnishing=${value} is not a Furnishing`).toBe(true);
    }
  });
});

// The island was one component shared by all three pages; the form is copied into each of them.
// Nothing but this test stops the copies from diverging.
describe('the three filter bars stay in step', () => {
  test.each(['SORT_ITEMS', 'FURNISHING_ITEMS'])('%s is identical on all three pages', (map) => {
    const [first, ...rest] = PAGES.map(([, src]) => itemsMap(src, map));
    for (const other of rest) expect(other).toEqual(first);
  });
});

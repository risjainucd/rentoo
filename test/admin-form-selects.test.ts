import { expect, test, describe } from 'vitest';
// Read the components as text (Vite's ?raw) rather than rendering them: the repo has no DOM
// test runner, and these are source-level invariants. The rendered behaviour behind them was
// verified in a real browser against `astro dev`.
import newListingSrc from '../src/components/admin/AdminNewListingForm.tsx?raw';
import editListingSrc from '../src/components/admin/AdminListingForm.tsx?raw';

// Base UI's <Select.Value> can only resolve an item's LABEL from the `items` prop: the options
// live in a Portal that is not mounted during SSR (nor while the popup is closed), so a <Select>
// without `items` renders the raw value — "c-scheme" instead of "C Scheme" — and the resulting
// server/client disagreement surfaces as a React hydration mismatch that regenerates the island.

// `<Select ...>` opening tags, including the multi-line ones.
function selectTags(src: string): string[] {
  return [...src.matchAll(/<Select\s[^>]*?>/gs)].map((m) => m[0]);
}

describe.each([
  ['AdminNewListingForm', newListingSrc],
  ['AdminListingForm', editListingSrc],
])('%s', (_name, src) => {
  test('every named <Select> passes items so labels resolve during SSR', () => {
    const named = selectTags(src).filter((t) => /\bname=/.test(t));
    expect(named.length).toBeGreaterThan(0);
    for (const tag of named) {
      expect(tag, `missing items= on: ${tag.replace(/\s+/g, ' ')}`).toMatch(/\bitems=/);
    }
  });

  test('options are rendered from the items map, so list and labels cannot drift', () => {
    for (const map of [...src.matchAll(/^const (\w+_ITEMS)\b/gm)].map((m) => m[1])) {
      expect(src).toContain(`Object.entries(${map}).map`);
      expect(src).toContain(`items={${map}}`);
    }
    // No hand-written option list left behind alongside the maps.
    expect(src).not.toMatch(/<SelectItem value="(furnished|semi-furnished|available|rented)"/);
  });
});

test('the new-listing form derives its neighbourhood labels from props', () => {
  expect(newListingSrc).toContain('items={neighbourhoodItems}');
  expect(newListingSrc).toMatch(/neighbourhoodItems\s*=\s*React\.useMemo/);
});

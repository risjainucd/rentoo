import { expect, test, describe } from 'vitest';
// Read the component as text (Vite's ?raw) rather than rendering it: the repo has no DOM test
// runner, and these are source-level invariants. The rendered behaviour behind them was verified
// against `astro dev` by reading the SSR HTML for a filtered URL.
import filterBarSrc from '../src/components/FilterBar.tsx?raw';

// Base UI's <Select.Value> can only resolve an item's LABEL from the `items` prop: the options
// live in a Portal that is not mounted during SSR (nor while the popup is closed), so a <Select>
// without `items` renders the raw value — "most-viewed" instead of "Most viewed" — on the public
// filter bar, and the resulting server/client disagreement surfaces as a hydration mismatch.

// `<Select ...>` opening tags, including the multi-line ones. Comments are stripped first so
// prose that mentions a tag (as the note above does) is not mistaken for real JSX.
function selectTags(src: string): string[] {
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/<Select\s[^>]*?>/gs)].map((m) => m[0]);
}

describe('FilterBar', () => {
  test('every <Select> passes items so labels resolve during SSR', () => {
    const tags = selectTags(filterBarSrc);
    expect(tags.length).toBe(4); // sort, area, bhk, furnishing
    for (const tag of tags) {
      expect(tag, `missing items= on: ${tag.replace(/\s+/g, ' ')}`).toMatch(/\bitems=/);
    }
  });

  test('options are rendered from the items map, so list and labels cannot drift', () => {
    const maps = [...filterBarSrc.matchAll(/^const (\w+_ITEMS)\b/gm)].map((m) => m[1]);
    expect(maps).toEqual(['SORT_ITEMS', 'BHK_ITEMS', 'FURNISHING_ITEMS']);
    for (const map of maps) {
      expect(filterBarSrc).toContain(`items={${map}}`);
      expect(filterBarSrc).toContain(`Object.entries(${map}).map`);
    }
    // No hand-written option list left behind alongside the maps.
    expect(filterBarSrc).not.toMatch(/<SelectItem value="/);
  });

  test('the area select derives its labels from the areas prop', () => {
    expect(filterBarSrc).toContain('items={areaItems}');
    expect(filterBarSrc).toContain('Object.entries(areaItems).map');
    expect(filterBarSrc).toMatch(/areaItems\s*=\s*React\.useMemo/);
  });

  test('the values that regressed carry human labels', () => {
    // The reported bug: these rendered as their raw slugs in the trigger.
    expect(filterBarSrc).toMatch(/'most-viewed':\s*'Most viewed'/);
    expect(filterBarSrc).toMatch(/'semi-furnished':\s*'Semi-furnished'/);
  });
});

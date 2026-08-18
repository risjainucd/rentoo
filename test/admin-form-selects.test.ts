import { expect, test, describe } from 'vitest';
// Read the components as text (Vite's ?raw) rather than rendering them: the repo has no DOM
// test runner, and these are source-level invariants. The rendered behaviour behind them was
// verified in a real browser against `astro dev`.
import newListingSrc from '../src/components/admin/AdminNewListingForm.tsx?raw';
import editListingSrc from '../src/components/admin/AdminListingForm.tsx?raw';
import newListingPageSrc from '../src/pages/admin/new.astro?raw';

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

// A rejected POST re-renders the page. If the island doesn't seed from the submission, the admin
// loses every field AND the selects silently reset to valid-looking defaults (Residential / first
// neighbourhood / Available) that were never chosen — so a resubmit files the listing wrongly.
describe('a rejected submission is echoed back into the form', () => {
  test('the page collects the rejected fields and passes them to the island', () => {
    expect(newListingPageSrc).toMatch(/submitted = Object\.fromEntries/);
    expect(newListingPageSrc).toContain('values={submitted}');
    // …and only on the failure path: the success path redirects before reaching it.
    const errIdx = newListingPageSrc.indexOf('Please provide a valid');
    expect(errIdx).toBeGreaterThan(-1);
    expect(newListingPageSrc.indexOf('submitted = Object.fromEntries')).toBeGreaterThan(errIdx);
  });

  test('every named control seeds from props.values', () => {
    expect(newListingSrc).toMatch(/const prev = props\.values \?\? \{\}/);
    for (const field of [
      'segment', 'neighbourhood_slug', 'property_type', 'bhk_type', 'rent_inr', 'area_sqft',
      'furnishing', 'status', 'landmark', 'description', 'map_url',
    ]) {
      expect(newListingSrc, `no prev.${field} seed`).toContain(`prev.${field}`);
    }
    expect(newListingSrc).toContain('defaultChecked={prev.featured === "on"}');
    expect(newListingSrc).toContain('defaultChecked={prev.published === "on"}');
  });
});

test('the neighbourhood select does not silently pre-pick one of the 88 areas', () => {
  expect(newListingSrc).not.toMatch(/useState\(props\.neighbourhoods\[0\]/);
  expect(newListingSrc).toContain('placeholder="Choose an area…"');
});

// Base UI's hidden select input is aria-hidden + tabindex=-1, so a browser cannot render a
// validation bubble on it: `required` there swallows the submit with no visible message.
test('no required on the neighbourhood select — it would block submit invisibly', () => {
  const tag = newListingSrc.match(/<Select\s+name="neighbourhood_slug"[\s\S]*?>/);
  expect(tag).not.toBeNull();
  expect(tag![0]).not.toMatch(/\brequired\b/);
});

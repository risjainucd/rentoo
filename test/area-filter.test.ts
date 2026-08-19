import { expect, test, describe } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { listMajorAreasIncluding } from '../src/lib/db';
import { dropUnknownFilters, soleNarrowingFilter } from '../src/lib/sql';

// The Area select lists only areas with live inventory (listMajorAreas), but ?area= can name
// any area — a stale link, a shared URL, an area whose last listing was marked rented, or a
// cross-segment link (most areas have no commercial/industrial stock). Base UI resolves a
// Select's label only from `items`, so an area missing from that list renders as its raw slug
// ("mahesh-nagar") in the trigger. These cover resolving the real name for it.

// listMajorAreas issues prepare().bind(segment).all(); the name lookup is prepare().bind(slug).first().
function areaDb(areas: { slug: string; name: string }[], names: Record<string, string> = {}): D1Database {
  return {
    prepare: () => {
      let bound: string | null = null;
      const stmt: Record<string, unknown> = {
        bind: (v: string) => { bound = v; return stmt; },
        all: async () => ({ results: areas.map((a) => ({ ...a, n: 1 })) }),
        first: async () => (bound != null && names[bound] ? { name: names[bound] } : null),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

const LIVE = [
  { slug: 'bani-park', name: 'Bani Park' },
  { slug: 'c-scheme', name: 'C-Scheme' },
  { slug: 'civil-lines', name: 'Civil Lines' },
  { slug: 'mansarovar', name: 'Mansarovar' },
];
// Real names for areas with no live inventory in this segment.
const DORMANT = { 'mahesh-nagar': 'Mahesh Nagar', 'sodala-ajmer-road': 'Sodala / Ajmer Road', 'bapu-nagar': 'Bapu Nagar' };

describe('listMajorAreasIncluding', () => {
  test('returns the live areas unchanged when nothing is selected', async () => {
    expect(await listMajorAreasIncluding(areaDb(LIVE, DORMANT), 'residential', undefined)).toEqual(LIVE);
  });

  test('returns the live areas unchanged when the selection is already listed', async () => {
    expect(await listMajorAreasIncluding(areaDb(LIVE, DORMANT), 'residential', 'c-scheme')).toEqual(LIVE);
  });

  test('adds the selected area with its real name when it has no live listings', async () => {
    const areas = await listMajorAreasIncluding(areaDb(LIVE, DORMANT), 'industrial', 'mahesh-nagar');
    expect(areas).toContainEqual({ slug: 'mahesh-nagar', name: 'Mahesh Nagar' });
  });

  test('never humanizes the slug — the name comes from the database', async () => {
    // 'sodala-ajmer-road' humanizes to "Sodala Ajmer Road"; the real name has a slash.
    const areas = await listMajorAreasIncluding(areaDb(LIVE, DORMANT), 'commercial', 'sodala-ajmer-road');
    expect(areas).toContainEqual({ slug: 'sodala-ajmer-road', name: 'Sodala / Ajmer Road' });
  });

  test('inserts in name order without disturbing the order of the live areas', async () => {
    const areas = await listMajorAreasIncluding(areaDb(LIVE, DORMANT), 'residential', 'bapu-nagar');
    expect(areas.map((a) => a.name)).toEqual([
      'Bani Park', 'Bapu Nagar', 'C-Scheme', 'Civil Lines', 'Mansarovar',
    ]);
  });

  test('returns the live areas unchanged for a slug that is not an area at all', async () => {
    // No name to show — the caller drops the filter rather than inventing a label.
    expect(await listMajorAreasIncluding(areaDb(LIVE, DORMANT), 'residential', 'not-an-area')).toEqual(LIVE);
  });
});

describe('dropUnknownFilters', () => {
  test('no redirect when everything named something real', () => {
    expect(dropUnknownFilters(new URL('https://x.test/rent?area=mahesh-nagar'), [])).toBeNull();
  });

  test('drops a slug that is not a real area', () => {
    expect(dropUnknownFilters(new URL('https://x.test/rent?area=asdf'), ['area'])).toBe('/rent');
  });

  test('drops a slug that is not a real neighbourhood', () => {
    // Reachable from the footer's hard-coded links if a neighbourhood is ever renamed.
    expect(dropUnknownFilters(new URL('https://x.test/rent?neighbourhood=gone'), ['neighbourhood'])).toBe('/rent');
  });

  test('keeps the other filters when dropping a bad one', () => {
    const to = dropUnknownFilters(new URL('https://x.test/rent?area=asdf&bhk=2BHK&sort=budget'), ['area']);
    expect(to).toBe('/rent?bhk=2BHK&sort=budget');
  });

  test('drops several at once', () => {
    const to = dropUnknownFilters(new URL('https://x.test/rent?area=asdf&neighbourhood=gone&bhk=2BHK'), ['area', 'neighbourhood']);
    expect(to).toBe('/rent?bhk=2BHK');
  });

  test('drops page too, since removing a filter changes the result set', () => {
    expect(dropUnknownFilters(new URL('https://x.test/industrial?area=asdf&page=4'), ['area'])).toBe('/industrial');
  });
});

describe('soleNarrowingFilter', () => {
  // Guards the empty-state wording: naming a place is only honest when that place is what
  // emptied the page, not when a rent bound or a BHK did.
  test('names the one filter in play', () => {
    expect(soleNarrowingFilter({ area: 'mahesh-nagar', segment: 'residential', page: 2 })).toBe('area');
    expect(soleNarrowingFilter({ neighbourhood: 'sodala', sort: 'budget' })).toBe('neighbourhood');
  });
  test('null when another filter could be what emptied the results', () => {
    expect(soleNarrowingFilter({ area: 'mahesh-nagar', bhk: '3BHK' })).toBeNull();
    expect(soleNarrowingFilter({ area: 'mahesh-nagar', maxRent: 9000 })).toBeNull();
    expect(soleNarrowingFilter({ neighbourhood: 'sodala', furnishing: 'furnished' })).toBeNull();
  });
  test('null when area and neighbourhood are both set, since either could be the cause', () => {
    expect(soleNarrowingFilter({ area: 'mahesh-nagar', neighbourhood: 'sodala' })).toBeNull();
  });
  test('null when nothing narrowing is applied', () => {
    expect(soleNarrowingFilter({ segment: 'residential' })).toBeNull();
  });
});

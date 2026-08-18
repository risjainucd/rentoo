import { expect, test, describe } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { listMajorAreasIncluding } from '../src/lib/db';
import { areaRedirectUrl, isAreaOnlyFilter } from '../src/lib/sql';

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

describe('areaRedirectUrl', () => {
  const resolved = [{ slug: 'c-scheme' }, { slug: 'mahesh-nagar' }];

  test('no redirect when no area is filtered', () => {
    expect(areaRedirectUrl(new URL('https://x.test/rent'), resolved, undefined)).toBeNull();
  });

  test('no redirect when the area resolved to a real name', () => {
    expect(areaRedirectUrl(new URL('https://x.test/rent?area=mahesh-nagar'), resolved, 'mahesh-nagar')).toBeNull();
  });

  test('drops an area slug that is not a real area', () => {
    expect(areaRedirectUrl(new URL('https://x.test/rent?area=asdf'), resolved, 'asdf')).toBe('/rent');
  });

  test('keeps the other filters when dropping the bad area', () => {
    const to = areaRedirectUrl(new URL('https://x.test/rent?area=asdf&bhk=2BHK&sort=budget'), resolved, 'asdf');
    expect(to).toBe('/rent?bhk=2BHK&sort=budget');
  });

  test('drops page too, since removing a filter changes the result set', () => {
    expect(areaRedirectUrl(new URL('https://x.test/industrial?area=asdf&page=4'), resolved, 'asdf')).toBe('/industrial');
  });
});

describe('isAreaOnlyFilter', () => {
  // Guards the empty-state wording: naming the area is only honest when the area is what emptied it.
  test('true when area is the only filter applied', () => {
    expect(isAreaOnlyFilter({ area: 'mahesh-nagar', segment: 'residential', page: 2 })).toBe(true);
  });
  test('false when another filter could be what emptied the results', () => {
    expect(isAreaOnlyFilter({ area: 'mahesh-nagar', bhk: '3BHK' })).toBe(false);
    expect(isAreaOnlyFilter({ area: 'mahesh-nagar', maxRent: 9000 })).toBe(false);
    expect(isAreaOnlyFilter({ area: 'mahesh-nagar', furnishing: 'furnished' })).toBe(false);
    expect(isAreaOnlyFilter({ area: 'mahesh-nagar', neighbourhood: 'sodala' })).toBe(false);
  });
  test('false when no area is filtered', () => {
    expect(isAreaOnlyFilter({ bhk: '3BHK' })).toBe(false);
  });
});

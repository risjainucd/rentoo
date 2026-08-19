import * as React from 'react';
import type { ListingFilters } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

// Value → label for every filter select. Passed to <Select items> AND used to render the
// options, so the list and the label lookup can never drift. Base UI's <Select.Value> can only
// resolve an item's label from `items`: the options live in a Portal that is not mounted during
// SSR (nor while the popup is closed), so without this the trigger renders the raw value
// ("most-viewed" instead of "Most viewed") and the server/client disagreement surfaces as a
// React hydration mismatch.
const SORT_ITEMS: Record<string, string> = {
  '': 'Newest first',
  featured: 'Featured',
  'most-viewed': 'Most viewed',
  budget: 'Budget-friendly',
  'most-liked': 'Most liked',
};
const BHK_ITEMS: Record<string, string> = {
  '': 'Any',
  '1BHK': '1BHK',
  '2BHK': '2BHK',
  '3BHK': '3BHK',
  '4BHK': '4BHK',
};
const FURNISHING_ITEMS: Record<string, string> = {
  '': 'Any',
  furnished: 'Furnished',
  'semi-furnished': 'Semi-furnished',
  unfurnished: 'Unfurnished',
};

interface Props {
  areas: { slug: string; name: string }[];
  value: ListingFilters;
}

function applyFilters(next: ListingFilters) {
  const p = new URLSearchParams();
  if (next.segment) p.set('segment', next.segment);
  if (next.sort) p.set('sort', next.sort);
  if (next.area) p.set('area', next.area);
  if (next.neighbourhood) p.set('neighbourhood', next.neighbourhood);
  if (next.q) p.set('q', next.q); // keep the hero locality search sticky while refining

  if (next.bhk) p.set('bhk', next.bhk);
  if (next.furnishing) p.set('furnishing', next.furnishing);
  if (next.minRent != null) p.set('minRent', String(next.minRent));
  if (next.maxRent != null) p.set('maxRent', String(next.maxRent));
  // note: reset to page 1 on any filter change (omit page)
  window.location.search = p.toString();
}

export default function FilterBar({ areas, value }: Props) {
  // BHK only applies to residential; commercial & industrial spaces don't use it.
  const showBhk = value.segment !== 'commercial' && value.segment !== 'industrial';

  const [area, setArea] = React.useState<string>(value.area ?? '');
  const [sort, setSort] = React.useState<string>(value.sort ?? '');
  const [bhk, setBhk] = React.useState<string>(value.bhk ?? '');
  const [furnishing, setFurnishing] = React.useState<string>(
    value.furnishing ?? ''
  );
  const [minRent, setMinRent] = React.useState<string>(
    value.minRent != null ? String(value.minRent) : ''
  );
  const [maxRent, setMaxRent] = React.useState<string>(
    value.maxRent != null ? String(value.maxRent) : ''
  );

  // Built from props, so the label lookup always matches the options actually rendered.
  const areaItems = React.useMemo<Record<string, string>>(
    () => ({ '': 'All areas', ...Object.fromEntries(areas.map((a) => [a.slug, a.name])) }),
    [areas]
  );

  function handleSortChange(val: string | null) {
    const next = val ?? '';
    setSort(next);
    applyFilters({
      ...value,
      sort: next || undefined,
      area: area || undefined,
      bhk: bhk || undefined,
      furnishing: (furnishing as ListingFilters['furnishing']) || undefined,
      minRent: minRent ? Number(minRent) : undefined,
      maxRent: maxRent ? Number(maxRent) : undefined,
    });
  }

  function handleAreaChange(val: string | null) {
    const next = val ?? '';
    setArea(next);
    applyFilters({
      ...value,
      area: next || undefined,
      neighbourhood: undefined, // a chosen major area supersedes a deep-linked sub-locality
      bhk: bhk || undefined,
      furnishing: (furnishing as ListingFilters['furnishing']) || undefined,
      minRent: minRent ? Number(minRent) : undefined,
      maxRent: maxRent ? Number(maxRent) : undefined,
    });
  }

  function handleBhkChange(val: string | null) {
    const next = val ?? '';
    setBhk(next);
    applyFilters({
      ...value,
      area: area || undefined,
      bhk: next || undefined,
      furnishing: (furnishing as ListingFilters['furnishing']) || undefined,
      minRent: minRent ? Number(minRent) : undefined,
      maxRent: maxRent ? Number(maxRent) : undefined,
    });
  }

  function handleFurnishingChange(val: string | null) {
    const next = val ?? '';
    setFurnishing(next);
    applyFilters({
      ...value,
      area: area || undefined,
      bhk: bhk || undefined,
      furnishing: (next as ListingFilters['furnishing']) || undefined,
      minRent: minRent ? Number(minRent) : undefined,
      maxRent: maxRent ? Number(maxRent) : undefined,
    });
  }

  function handleRentApply() {
    applyFilters({
      ...value,
      area: area || undefined,
      bhk: bhk || undefined,
      furnishing: (furnishing as ListingFilters['furnishing']) || undefined,
      minRent: minRent ? Number(minRent) : undefined,
      maxRent: maxRent ? Number(maxRent) : undefined,
    });
  }

  return (
    <div className="filter-bar">
      {/* Sort — Featured / Most viewed / Budget / Most liked */}
      <div className="filter-group">
        <label className="filter-legend">Show me</label>
        <Select items={SORT_ITEMS} value={sort || null} onValueChange={handleSortChange}>
          <SelectTrigger className="filter-select-trigger">
            <SelectValue placeholder="Newest" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORT_ITEMS).map(([val, label]) => (
              <SelectItem key={val} value={val}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Area (major areas only) */}
      <div className="filter-group">
        <label className="filter-legend">Area</label>
        <Select items={areaItems} value={area || null} onValueChange={handleAreaChange}>
          <SelectTrigger className="filter-select-trigger">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(areaItems).map(([val, label]) => (
              <SelectItem key={val} value={val}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* BHK — residential only (hidden for commercial / industrial) */}
      {showBhk && (
        <div className="filter-group">
          <label className="filter-legend">BHK</label>
          <Select items={BHK_ITEMS} value={bhk || null} onValueChange={handleBhkChange}>
            <SelectTrigger className="filter-select-trigger">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(BHK_ITEMS).map(([val, label]) => (
                <SelectItem key={val} value={val}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Furnishing */}
      <div className="filter-group">
        <label className="filter-legend">Furnishing</label>
        <Select items={FURNISHING_ITEMS} value={furnishing || null} onValueChange={handleFurnishingChange}>
          <SelectTrigger className="filter-select-trigger">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FURNISHING_ITEMS).map(([val, label]) => (
              <SelectItem key={val} value={val}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Rent range */}
      <div className="filter-group filter-group--rent">
        <label className="filter-legend">Rent (₹/mo)</label>
        <div className="filter-rent-inputs">
          <Input
            type="number"
            placeholder="Min"
            value={minRent}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setMinRent(e.target.value)
            }
            onBlur={handleRentApply}
            className="filter-input"
            min={0}
          />
          <span className="filter-rent-sep" aria-hidden="true">–</span>
          <Input
            type="number"
            placeholder="Max"
            value={maxRent}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setMaxRent(e.target.value)
            }
            onBlur={handleRentApply}
            className="filter-input"
            min={0}
          />
        </div>
      </div>

      <style>{`
        .filter-bar {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-md);
          align-items: flex-end;
          background: var(--paper-snow);
          border: 1px solid var(--line);
          border-radius: var(--r-md);
          padding: var(--space-lg);
        }
        .filter-group {
          display: flex;
          flex-direction: column;
          gap: var(--space-xs);
          min-width: 140px;
          flex: 1 1 140px;
        }
        .filter-group--rent {
          min-width: 200px;
          flex: 2 1 200px;
        }
        .filter-legend {
          font-family: var(--font-mono);
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-muted);
        }
        .filter-select-trigger {
          width: 100%;
          background: var(--paper);
          border-color: var(--line);
          color: var(--ink);
          border-radius: var(--r-sm);
          font-size: 0.9375rem;
        }
        .filter-select-trigger:focus-visible {
          border-color: var(--jaipur-navy);
          outline-color: var(--jaipur-navy);
        }
        .filter-rent-inputs {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
        }
        .filter-rent-sep {
          color: var(--ink-soft);
          font-size: 0.875rem;
          flex-shrink: 0;
        }
        .filter-input {
          background: var(--paper);
          border-color: var(--line);
          color: var(--ink);
          border-radius: var(--r-sm);
          font-size: 0.9375rem;
          font-variant-numeric: tabular-nums;
        }
        .filter-input:focus-visible {
          border-color: var(--jaipur-navy);
          outline-color: var(--jaipur-navy);
        }
      `}</style>
    </div>
  );
}

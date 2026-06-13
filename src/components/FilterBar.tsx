import * as React from 'react';
import type { ListingFilters, Neighbourhood } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface Props {
  neighbourhoods: Pick<Neighbourhood, 'slug' | 'name'>[];
  value: ListingFilters;
}

function applyFilters(next: ListingFilters) {
  const p = new URLSearchParams();
  if (next.segment) p.set('segment', next.segment);
  if (next.neighbourhood) p.set('neighbourhood', next.neighbourhood);
  if (next.bhk) p.set('bhk', next.bhk);
  if (next.furnishing) p.set('furnishing', next.furnishing);
  if (next.minRent != null) p.set('minRent', String(next.minRent));
  if (next.maxRent != null) p.set('maxRent', String(next.maxRent));
  // note: reset to page 1 on any filter change (omit page)
  window.location.search = p.toString();
}

export default function FilterBar({ neighbourhoods, value }: Props) {
  const [neighbourhood, setNeighbourhood] = React.useState<string>(
    value.neighbourhood ?? ''
  );
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

  function handleNeighbourhoodChange(val: string | null) {
    const next = val ?? '';
    setNeighbourhood(next);
    applyFilters({
      ...value,
      neighbourhood: next || undefined,
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
      neighbourhood: neighbourhood || undefined,
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
      neighbourhood: neighbourhood || undefined,
      bhk: bhk || undefined,
      furnishing: (next as ListingFilters['furnishing']) || undefined,
      minRent: minRent ? Number(minRent) : undefined,
      maxRent: maxRent ? Number(maxRent) : undefined,
    });
  }

  function handleRentApply() {
    applyFilters({
      ...value,
      neighbourhood: neighbourhood || undefined,
      bhk: bhk || undefined,
      furnishing: (furnishing as ListingFilters['furnishing']) || undefined,
      minRent: minRent ? Number(minRent) : undefined,
      maxRent: maxRent ? Number(maxRent) : undefined,
    });
  }

  return (
    <div className="filter-bar">
      {/* Neighbourhood */}
      <div className="filter-group">
        <label className="filter-legend">Neighbourhood</label>
        <Select value={neighbourhood || null} onValueChange={handleNeighbourhoodChange}>
          <SelectTrigger className="filter-select-trigger">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All areas</SelectItem>
            {neighbourhoods.map((n) => (
              <SelectItem key={n.slug} value={n.slug}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* BHK */}
      <div className="filter-group">
        <label className="filter-legend">BHK</label>
        <Select value={bhk || null} onValueChange={handleBhkChange}>
          <SelectTrigger className="filter-select-trigger">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any</SelectItem>
            <SelectItem value="1BHK">1BHK</SelectItem>
            <SelectItem value="2BHK">2BHK</SelectItem>
            <SelectItem value="3BHK">3BHK</SelectItem>
            <SelectItem value="4BHK">4BHK</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Furnishing */}
      <div className="filter-group">
        <label className="filter-legend">Furnishing</label>
        <Select value={furnishing || null} onValueChange={handleFurnishingChange}>
          <SelectTrigger className="filter-select-trigger">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any</SelectItem>
            <SelectItem value="furnished">Furnished</SelectItem>
            <SelectItem value="semi-furnished">Semi-furnished</SelectItem>
            <SelectItem value="unfurnished">Unfurnished</SelectItem>
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

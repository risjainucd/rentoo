import * as React from "react"

import { slugify } from "@/lib/sql"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Value → label for every select. Passed to <Select items> AND used to render the options,
// so the two can never drift. Base UI's <Select.Value> resolves a selected item's LABEL from
// `items`; without it the trigger falls back to rendering the raw value, so the admin sees
// "c-scheme" / "residential" instead of "C Scheme" / "Residential" — on the server-rendered
// HTML and after hydration alike.
const SEGMENT_ITEMS: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  industrial: "Industrial",
}
const FURNISHING_ITEMS: Record<string, string> = {
  "": "—",
  furnished: "Furnished",
  "semi-furnished": "Semi-furnished",
  unfurnished: "Unfurnished",
}
const STATUS_ITEMS: Record<string, string> = {
  available: "Available",
  "on-hold": "On hold",
  rented: "Rented out (hidden from site)",
}

export interface AdminNewListingFormProps {
  neighbourhoods: { slug: string; name: string; mapped: boolean }[]
  /** Server-computed next "#NN" — shown read-only; the server assigns it on submit. */
  suggestedDisplayId: string
  /**
   * The raw fields of a submission the server rejected. Every control seeds from this so a
   * validation bounce re-renders what the admin typed instead of an empty form — resetting
   * the selects would otherwise silently swap in valid-looking defaults (Residential / the
   * first neighbourhood / Available) that the admin never chose.
   */
  values?: Record<string, string> | null
}

function Row({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-border py-3.5 last:border-b-0 sm:grid-cols-[150px_1fr] sm:gap-4">
      <Label htmlFor={htmlFor} className="pt-2 [font-family:var(--font-display)] font-semibold">
        {label}
      </Label>
      <div className="space-y-1.5">
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

export function AdminNewListingForm(props: AdminNewListingFormProps) {
  const prev = props.values ?? {}
  const [segment, setSegment] = React.useState(prev.segment || "residential")
  // Deliberately unset: pre-selecting the first of 88 neighbourhoods files the listing in an
  // arbitrary area, and the server only checks that the slug exists, so the wrong area validates.
  const [neighbourhood, setNeighbourhood] = React.useState(prev.neighbourhood_slug || "")
  const [propertyType, setPropertyType] = React.useState(prev.property_type || "")
  const [bhk, setBhk] = React.useState(prev.bhk_type || "")
  const [slug, setSlug] = React.useState(prev.slug || "")
  const [slugEdited, setSlugEdited] = React.useState(Boolean(prev.slug))
  // Both uniqueness helpers auto-avoid collisions rather than reject, so a second POST cannot
  // fail — it just creates a second near-identical listing. Let the first submit through only.
  const [submitting, setSubmitting] = React.useState(false)

  // Astro serves this form as real, typeable HTML before the island hydrates, so an admin can
  // start filling it in immediately. Those keystrokes are invisible to React, and the first
  // re-render (picking any dropdown) would wipe the controlled fields back to state. Adopt
  // whatever the DOM already holds, once, right after hydration.
  const typeRef = React.useRef<HTMLInputElement>(null)
  const bhkRef = React.useRef<HTMLInputElement>(null)
  const slugRef = React.useRef<HTMLInputElement>(null)
  React.useLayoutEffect(() => {
    const domType = typeRef.current?.value ?? ""
    const domBhk = bhkRef.current?.value ?? ""
    const domSlug = slugRef.current?.value ?? ""
    if (domType) setPropertyType(domType)
    if (domBhk) setBhk(domBhk)
    // Only treat the slug as hand-written if it isn't just the suggestion we rendered.
    if (domSlug && domSlug !== slugify([domBhk, domType].filter(Boolean).join(" "))) {
      setSlug(domSlug)
      setSlugEdited(true)
    }
    // Mount only: later edits come through onChange.
  }, [])

  const neighbourhoodItems = React.useMemo(
    () => Object.fromEntries(props.neighbourhoods.map((n) => [n.slug, n.name])),
    [props.neighbourhoods]
  )

  // Areas with no major_slug are absent from the public Area filter, so a listing filed under one
  // is only reachable by browsing. Warn at create time rather than letting it happen silently.
  const areaUnmapped = props.neighbourhoods.some((n) => n.slug === neighbourhood && !n.mapped)

  const isResidential = segment === "residential"
  // Live slug suggestion from the fields, unless the admin has typed their own.
  const derivedSlug = slugify(
    [isResidential ? bhk : "", propertyType, neighbourhood].filter(Boolean).join(" ")
  )
  const slugValue = slugEdited ? slug : derivedSlug

  return (
    <form
      method="POST"
      className="mb-6 rounded-xl border border-border bg-card p-5 shadow-[var(--elev-1)] sm:p-6"
      onSubmit={(e) => {
        if (submitting) {
          e.preventDefault()
          return
        }
        setSubmitting(true)
      }}
    >
      <Row label="Display ID">
        <div className="flex h-9 items-center font-mono text-sm text-muted-foreground">
          {props.suggestedDisplayId}
          <span className="ml-2 text-xs">(assigned automatically)</span>
        </div>
      </Row>

      <Row label="Segment" htmlFor="segment">
        <Select
          name="segment"
          items={SEGMENT_ITEMS}
          value={segment}
          onValueChange={(v) => setSegment(String(v))}
        >
          <SelectTrigger id="segment" className="h-9 w-full max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SEGMENT_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {/* No `required` here: Base UI's hidden select input is aria-hidden and tabindex=-1, so the
          browser cannot show a validation bubble on it — the submit would just be swallowed with
          no visible message. An unset area is caught server-side instead, which re-renders with a
          readable banner and every field preserved. */}
      <Row
        label="Neighbourhood"
        htmlFor="neighbourhood"
        hint={
          areaUnmapped
            ? "This area isn't part of any major area, so the listing won't show up under the public Area filter."
            : "Determines the area map and browse filters."
        }
      >
        <Select
          name="neighbourhood_slug"
          items={neighbourhoodItems}
          value={neighbourhood}
          onValueChange={(v) => setNeighbourhood(String(v))}
        >
          <SelectTrigger id="neighbourhood" className="h-9 w-full max-w-72">
            <SelectValue placeholder="Choose an area…" />
          </SelectTrigger>
          <SelectContent>
            {props.neighbourhoods.map((n) => (
              <SelectItem key={n.slug} value={n.slug}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Type" htmlFor="property_type">
        <Input
          id="property_type"
          name="property_type"
          ref={typeRef}
          required
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
          placeholder="e.g. apartment, office, warehouse"
          className="h-9"
        />
      </Row>

      {isResidential && (
        <Row label="BHK" htmlFor="bhk_type">
          <Input
            id="bhk_type"
            name="bhk_type"
            ref={bhkRef}
            value={bhk}
            onChange={(e) => setBhk(e.target.value)}
            placeholder="e.g. 2BHK"
            className="h-9"
          />
        </Row>
      )}

      <Row label="Rent (₹/mo)" htmlFor="rent_inr">
        <Input id="rent_inr" name="rent_inr" type="number" min={1} required defaultValue={prev.rent_inr || ""} className="h-9 max-w-48" />
      </Row>

      <Row label="Area (sq ft)" htmlFor="area_sqft">
        <Input id="area_sqft" name="area_sqft" type="number" min={0} defaultValue={prev.area_sqft || ""} placeholder="optional" className="h-9 max-w-48" />
      </Row>

      <Row label="Furnishing" htmlFor="furnishing">
        <Select name="furnishing" items={FURNISHING_ITEMS} defaultValue={prev.furnishing || ""}>
          <SelectTrigger id="furnishing" className="h-9 w-full max-w-72">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FURNISHING_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Status" htmlFor="status">
        <Select name="status" items={STATUS_ITEMS} defaultValue={prev.status || "available"}>
          <SelectTrigger id="status" className="h-9 w-full max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row label="Landmark" htmlFor="landmark">
        <Input id="landmark" name="landmark" defaultValue={prev.landmark || ""} placeholder="optional" className="h-9" />
      </Row>

      <Row
        label="Slug"
        htmlFor="slug"
        hint={
          slugEdited
            ? "Public URL: /rent/<slug>. Must be unique — a number is appended if taken."
            : "Auto-generated from your inputs. Edit to customize; a number is appended if taken."
        }
      >
        <Input
          id="slug"
          name="slug"
          ref={slugRef}
          value={slugValue}
          onChange={(e) => {
            setSlugEdited(true)
            setSlug(e.target.value)
          }}
          placeholder="auto-generated"
          className="h-9 font-mono"
        />
      </Row>

      <Row label="Description" htmlFor="description">
        <Textarea id="description" name="description" defaultValue={prev.description || ""} placeholder="optional" />
      </Row>

      <Row
        label="Map URL"
        htmlFor="map_url"
        hint={
          <>
            Paste the <code>src</code> from Google Maps → Share → <b>Embed a map</b>. Blank = auto area map.
          </>
        }
      >
        <Input id="map_url" name="map_url" defaultValue={prev.map_url || ""} placeholder="optional" className="h-9" />
      </Row>

      <Row label="Flags">
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center gap-2.5">
            <Switch id="featured" name="featured" aria-label="Featured" defaultChecked={prev.featured === "on"} />
            <label htmlFor="featured" className="cursor-pointer text-sm font-medium">Featured</label>
          </div>
          <div className="flex items-center gap-2.5">
            <Switch id="published" name="published" aria-label="Published" defaultChecked={prev.published === "on"} />
            <label htmlFor="published" className="cursor-pointer text-sm font-medium">
              Published <span className="font-normal text-muted-foreground">(off = draft; add photos first)</span>
            </label>
          </div>
        </div>
      </Row>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={submitting} className="h-10 px-6 text-sm">
          {submitting ? "Creating…" : "Create listing"}
        </Button>
        <span className="text-xs text-muted-foreground">You'll add photos on the next screen.</span>
      </div>
    </form>
  )
}

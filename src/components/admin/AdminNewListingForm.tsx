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

export interface AdminNewListingFormProps {
  neighbourhoods: { slug: string; name: string }[]
  /** Server-computed next "#NN" — shown read-only; the server assigns it on submit. */
  suggestedDisplayId: string
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
  const [segment, setSegment] = React.useState("residential")
  const [neighbourhood, setNeighbourhood] = React.useState(props.neighbourhoods[0]?.slug ?? "")
  const [propertyType, setPropertyType] = React.useState("")
  const [bhk, setBhk] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugEdited, setSlugEdited] = React.useState(false)

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
    >
      <Row label="Display ID">
        <div className="flex h-9 items-center font-mono text-sm text-muted-foreground">
          {props.suggestedDisplayId}
          <span className="ml-2 text-xs">(assigned automatically)</span>
        </div>
      </Row>

      <Row label="Segment" htmlFor="segment">
        <Select name="segment" value={segment} onValueChange={(v) => setSegment(String(v))}>
          <SelectTrigger id="segment" className="h-9 w-full max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="residential">Residential</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
            <SelectItem value="industrial">Industrial</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Neighbourhood" htmlFor="neighbourhood" hint="Determines the area map and browse filters.">
        <Select
          name="neighbourhood_slug"
          value={neighbourhood}
          onValueChange={(v) => setNeighbourhood(String(v))}
        >
          <SelectTrigger id="neighbourhood" className="h-9 w-full max-w-72">
            <SelectValue />
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
            value={bhk}
            onChange={(e) => setBhk(e.target.value)}
            placeholder="e.g. 2BHK"
            className="h-9"
          />
        </Row>
      )}

      <Row label="Rent (₹/mo)" htmlFor="rent_inr">
        <Input id="rent_inr" name="rent_inr" type="number" min={1} required defaultValue="" className="h-9 max-w-48" />
      </Row>

      <Row label="Area (sq ft)" htmlFor="area_sqft">
        <Input id="area_sqft" name="area_sqft" type="number" min={0} defaultValue="" placeholder="optional" className="h-9 max-w-48" />
      </Row>

      <Row label="Furnishing" htmlFor="furnishing">
        <Select name="furnishing" defaultValue="">
          <SelectTrigger id="furnishing" className="h-9 w-full max-w-72">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">—</SelectItem>
            <SelectItem value="furnished">Furnished</SelectItem>
            <SelectItem value="semi-furnished">Semi-furnished</SelectItem>
            <SelectItem value="unfurnished">Unfurnished</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Status" htmlFor="status">
        <Select name="status" defaultValue="available">
          <SelectTrigger id="status" className="h-9 w-full max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="on-hold">On hold</SelectItem>
            <SelectItem value="rented">Rented out (hidden from site)</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Landmark" htmlFor="landmark">
        <Input id="landmark" name="landmark" defaultValue="" placeholder="optional" className="h-9" />
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
        <Textarea id="description" name="description" defaultValue="" placeholder="optional" />
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
        <Input id="map_url" name="map_url" defaultValue="" placeholder="optional" className="h-9" />
      </Row>

      <Row label="Flags">
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center gap-2.5">
            <Switch id="featured" name="featured" aria-label="Featured" />
            <label htmlFor="featured" className="cursor-pointer text-sm font-medium">Featured</label>
          </div>
          <div className="flex items-center gap-2.5">
            <Switch id="published" name="published" aria-label="Published" />
            <label htmlFor="published" className="cursor-pointer text-sm font-medium">
              Published <span className="font-normal text-muted-foreground">(off = draft; add photos first)</span>
            </label>
          </div>
        </div>
      </Row>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="submit" className="h-10 px-6 text-sm">
          Create listing
        </Button>
        <span className="text-xs text-muted-foreground">You'll add photos on the next screen.</span>
      </div>
    </form>
  )
}

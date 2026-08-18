import * as React from "react"

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

// Value → label for the selects, passed to <Select items> and used to render the options.
// Without `items`, Base UI's <Select.Value> falls back to the raw value ("semi-furnished"),
// and SSR/client disagree once the popup registers the real labels (hydration mismatch).
const FURNISHING_ITEMS: Record<string, string> = {
  "": "—",
  furnished: "Furnished",
  "semi-furnished": "Semi-furnished",
  unfurnished: "Unfurnished",
}
const STATUS_ITEMS: Record<string, string> = {
  available: "Available",
  rented: "Rented out (hidden from site)",
  "on-hold": "On hold",
}

export interface AdminListingFormProps {
  rentInr: number
  status: string
  propertyType: string
  bhkType: string
  furnishing: string
  landmark: string
  description: string
  mapUrl: string
  featured: boolean
  published: boolean
  /** True when the page loaded with ?saved=1 (post-save redirect). */
  saved?: boolean
  /** True when the page loaded with ?created=1 (redirected here from the new-listing flow). */
  created?: boolean
}

function Row({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
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

export function AdminListingForm(props: AdminListingFormProps) {
  // Surface the post-save / post-create redirect as a Sonner toast, then strip the
  // query flag so a reload doesn't re-toast. sonner is dynamically imported so it never
  // loads during SSR (its module top-level breaks React in the Cloudflare/workerd SSR);
  // the effect runs client-only. The <Toaster/> lives in AdminLayout (client:only).
  React.useEffect(() => {
    const msg = props.created
      ? { title: "Listing created", description: "Add photos below, then flip Published when ready." }
      : props.saved
        ? { title: "Changes saved", description: "Your edits are live on the site." }
        : null
    if (!msg) return
    void import("sonner").then(({ toast }) => toast.success(msg.title, { description: msg.description }))
    const url = new URL(window.location.href)
    url.searchParams.delete("saved")
    url.searchParams.delete("created")
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""))
  }, [props.saved, props.created])

  return (
    <form
      method="POST"
      className="mb-6 rounded-xl border border-border bg-card p-5 shadow-[var(--elev-1)] sm:p-6"
    >
      <Row label="Rent (₹/mo)" htmlFor="rent_inr">
        <Input
          id="rent_inr"
          name="rent_inr"
          type="number"
          min={0}
          defaultValue={props.rentInr}
          className="h-9 max-w-48"
        />
      </Row>

      <Row
        label="Status"
        htmlFor="status"
        hint="Rented-out listings are hidden from the public site."
      >
        <Select name="status" items={STATUS_ITEMS} defaultValue={props.status}>
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

      <Row label="Type" htmlFor="property_type">
        <Input id="property_type" name="property_type" defaultValue={props.propertyType} className="h-9" />
      </Row>

      <Row label="BHK" htmlFor="bhk_type">
        <Input
          id="bhk_type"
          name="bhk_type"
          defaultValue={props.bhkType}
          placeholder="e.g. 2BHK (residential only)"
          className="h-9"
        />
      </Row>

      <Row label="Furnishing" htmlFor="furnishing">
        <Select name="furnishing" items={FURNISHING_ITEMS} defaultValue={props.furnishing}>
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

      <Row label="Landmark" htmlFor="landmark">
        <Input id="landmark" name="landmark" defaultValue={props.landmark} className="h-9" />
      </Row>

      <Row label="Description" htmlFor="description">
        <Textarea id="description" name="description" defaultValue={props.description} />
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
        <Input
          id="map_url"
          name="map_url"
          defaultValue={props.mapUrl}
          placeholder="Google Maps embed src, or blank for area map"
          className="h-9"
        />
      </Row>

      <Row label="Flags">
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center gap-2.5">
            <Switch id="featured" name="featured" aria-label="Featured" defaultChecked={props.featured} />
            <label htmlFor="featured" className="cursor-pointer text-sm font-medium">Featured</label>
          </div>
          <div className="flex items-center gap-2.5">
            <Switch id="published" name="published" aria-label="Published" defaultChecked={props.published} />
            <label htmlFor="published" className="cursor-pointer text-sm font-medium">Published</label>
          </div>
        </div>
      </Row>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="submit" className="h-10 px-6 text-sm">
          Save changes
        </Button>
        <span className="text-xs text-muted-foreground">Changes go live immediately.</span>
      </div>
    </form>
  )
}

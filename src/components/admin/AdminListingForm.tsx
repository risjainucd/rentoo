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
  // Surface the post-save redirect as a Sonner toast, then strip ?saved=1 so a
  // reload doesn't re-toast. sonner is dynamically imported so it never loads
  // during SSR (its module top-level breaks React in the Cloudflare/workerd SSR);
  // the effect runs client-only. The <Toaster/> lives in AdminLayout (client:only).
  React.useEffect(() => {
    if (!props.saved) return
    void import("sonner").then(({ toast }) => {
      toast.success("Changes saved", { description: "Your edits are live on the site." })
    })
    const url = new URL(window.location.href)
    url.searchParams.delete("saved")
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""))
  }, [props.saved])

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
        <Select name="status" defaultValue={props.status}>
          <SelectTrigger id="status" className="h-9 w-full max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="rented">Rented out (hidden from site)</SelectItem>
            <SelectItem value="on-hold">On hold</SelectItem>
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
        <Select name="furnishing" defaultValue={props.furnishing}>
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
            <Switch name="featured" defaultChecked={props.featured} />
            <span className="text-sm font-medium">Featured</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Switch name="published" defaultChecked={props.published} />
            <span className="text-sm font-medium">Published</span>
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

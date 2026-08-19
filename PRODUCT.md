# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: tenants searching for a place in Jaipur who arrive already in contact with Rentoo** — referred through WhatsApp or Instagram rather than cold search. The site is the catalog they browse *between* messages: they typically land on a specific listing or segment, scan available stock, and return to the thread to ask about one. They are mid-conversation, not being persuaded from scratch.

Mobile is the dominant device on this path — a WhatsApp or Instagram referral opens in an in-app browser on a phone.

**Internal: Rentoo staff**, who create and manage listings and photos through `/admin`.

Property owners are not currently an audience the site is designed around.

## Product Purpose

Rentoo is a Jaipur brokerage firm. The site is a server-rendered catalog of hand-verified residential, commercial, and industrial rental properties. Rentoo visits each property, writes the listing itself, photographs it, and publishes it with a direct contact path.

Success is a tenant finding a property worth asking about and opening or continuing a WhatsApp conversation about it.

## Positioning

Verified, transparent, and human as **one inseparable promise** (confirmed by the user — future work must not keep one facet while breaking another):

- Rentoo visits and writes every listing itself, rather than syndicating broker copy.
- The brokerage arrangement is stated before a viewing, not negotiated after it.
- Contact reaches a named person on the team, not a lead-capture funnel.

A neighbouring aggregator could copy the catalog format but not the claim that a person visited and wrote each entry.

## Operating Context

- Traffic arrives mid-conversation from WhatsApp/Instagram, mostly on phones, often in in-app browsers.
- One number serves as both phone and WhatsApp (+91 87400 00854; `connect@rentoo.in`). Messages reach Satvik or the team directly.
- Stated hours: open all week, 10:00–20:00 IST.
- Listings are produced offline, not authored in the app: a spreadsheet import (`scripts/import-excel.mjs`) plus watermark/upload pipelines (`scripts/watermark-upload.mjs`, `scripts/video-upload.mjs`) feed D1 and R2.
- Photos are watermarked before publication to deter reposting by other brokers.

## Capabilities and Constraints

**Segments:** residential (`/rent`), commercial (`/commercial`), industrial (`/industrial`). Industrial was split out of commercial in `migrations/0002_segment_industrial.sql`.

**Listings** carry `display_id` (`#NN`), bhk/type, rent, area, furnishing, status (`available`/`rented`/`on-hold`), neighbourhood, map URL, description, slug, and a `published` flag.

**Neighbourhoods** roll granular sub-tags up under ~16 real Jaipur major areas (`major_slug`/`major_area`, migration 0003) so filters show main areas while detail pages keep the specific tag.

**Media:** photos and videos share `property_media`, discriminated by `kind`. Photos render at card/gallery/full WebP sizes. The `/media` endpoint is referer-gated, immutably cached, and supports HTTP Range (required for inline video on iOS Safari).

**Engagement:** likes and views are stored in D1.

### Explicitly NOT constraints

The user confirmed these are current implementation, open to change — do not treat them as commitments:

- **WhatsApp-first contact** is the present mechanism, not a fixed commitment.
- **Photo watermarking** is current practice, not locked.
- **Placement of brokerage information** is not locked.

### Undecided — do not resolve by inventing

- **Whether tenants pay brokerage is currently self-contradictory on the live site.** The homepage proof stat reads "₹0 — Brokerage charged to tenants. Ever.", while homepage body copy and `/about` say the fee is "agreed up front", "same rate for everyone", and known "before you ever see the flat". Confirm with the client before any surface restates it.

## Brand Commitments

**Fixed (confirmed by the user):** the Rentoo wordmark and icon (`public/Rentooicon.svg|png`, favicon and app icons) and **Geist Variable** as the sans family. Settled — not to be reopened.

**Voice, as written on the live site:** plain, direct, first-person, unhedged. Short declaratives, no marketing inflation. "A Jaipur brokerage firm. Run by people who pick up the phone." / "We write the listing ourselves."

**Named contact persona:** Satvik.

## Evidence on Hand

**Real:** 149 live listings in D1. 64 have watermarked photo galleries (705 photos); 29 listings are video-only; commercial listings had no photos as of milestone 1. Source inventory lives in the gitignored `inventory 2026/`, `data/`, and `seed/`.

**Published claims with unverified provenance** — treat as client-supplied; do not restate as verified, extend, or add siblings: "247 families placed since 2021" and "26 min median WhatsApp response (last 30 days)" (hardcoded `NumberTicker` values on the homepage), "we visit every property", and "replies within 30 minutes".

**Real, client-supplied:** the three homepage testimonials (Priya S., Ankit M., Rohit K. — `index.astro:158`) are genuine; confirmed by the user 2026-08-19. They describe different service paths — one had Satvik attend the viewings, another needed no site visits — which is real variation in how clients are served, not an inconsistency to reconcile.

**Absent — must not be fabricated:** press coverage, awards, partner logos, ratings, and any testimonial beyond the three already confirmed.

## Product Principles

1. **Design for a reader mid-conversation, not a cold visitor.** Someone arrives from a message about one property. Getting them to that property and back to the thread beats a full persuasion arc.
2. **Verified, transparent, human is one promise.** No change may strengthen one facet by weakening another.
3. **The listing is the product.** Rentoo's own words and photographs are the differentiator; presentation serves them rather than competing with them.
4. **Phone-first is literal.** The in-app mobile browser is the real device; desktop is secondary.
5. **Never invent proof.** Counts, response times, and fee terms come from the client or stay off the page.

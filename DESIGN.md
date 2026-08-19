---
name: Rentoo
description: A precise, civic catalog of hand-verified Jaipur rentals — navy ink on warm paper.
colors:
  jaipur-navy: "#082746"
  midnight-tile: "#133A60"
  terracotta: "#B5532E"
  terracotta-mist: "#F5E4DA"
  paper: "#FAF7EE"
  paper-warm: "#F2EDE0"
  paper-snow: "#FFFFFF"
  haze-tint: "#E4ECF5"
  ink: "#0F172A"
  ink-muted: "#475569"
  ink-soft: "#94A3B8"
  line: "#E5E0D5"
  ok-green: "#16A34A"
  ok-mist: "#DCFCE7"
  ok-deep: "#0F7A37"
  navy-dawn: "#0C3157"
  navy-abyss: "#061D33"
  danger-red: "#DC2626"
  danger-mist: "#FEE2E2"
  rest-gray: "#64748B"
  rest-mist: "#F1F5F9"
  whatsapp-signal: "#25D366"
  whatsapp-deep: "#1FB958"
  focus-clay: "#EA580C"
typography:
  display:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3.25rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Space Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  ui:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  base:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "ui-monospace, SF Mono, Cascadia Code, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  4xl: "64px"
  5xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.jaipur-navy}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "color-mix(in oklch, #082746, transparent 20%)"
    textColor: "{colors.paper}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  card-listing:
    backgroundColor: "{colors.paper-snow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  input-field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  badge-ok:
    backgroundColor: "{colors.ok-mist}"
    textColor: "#0F7A37"
    rounded: "{rounded.sm}"
    padding: "3px 9px"
    typography: "{typography.label}"
  badge-warn:
    backgroundColor: "{colors.terracotta-mist}"
    textColor: "{colors.terracotta}"
    rounded: "{rounded.sm}"
    padding: "3px 9px"
    typography: "{typography.label}"
---

# Design System: Rentoo

## Overview

**Creative North Star: "The Property Ledger"**

Rentoo looks like a well-kept book of accounts, not a listings portal. Every property enters the system as a numbered entry (`#01`, `#02`) set in monospace, ruled off from its neighbours by a single warm hairline, and stamped with its status. The ground is warm paper (#FAF7EE) rather than screen-white; the ink is a deep Jaipur navy (#082746) rather than black. That pairing does the work that photography and badges do on aggregator sites — it says *someone keeps records here* before a single listing is read.

The register is precise, civic, and trustworthy. Restraint is the trust signal: the system earns credibility by looking accurate rather than by looking expensive or exciting. Density is disciplined but never cramped — a strict 4pt spacing ladder, tight radii (4/8/12px), and hairline borders keep the page orderly, while a warm ground and generous line-height (1.6–1.7 on body prose) keep it from reading as a spreadsheet. Terracotta (#B5532E) is the single warm accent, and its scarcity is the entire point.

Motion is functional and short. Nothing bounces, nothing exceeds 300ms, and every reveal degrades to a static page under `prefers-reduced-motion`. Surfaces sit flat until addressed. This system has four confirmed anti-references and rejects all of them: Indian aggregator portals, generic AI/SaaS styling, luxury real-estate gloss, and undifferentiated Silicon Valley minimal.

**Key Characteristics:**
- Warm paper ground, navy ink — never white-on-black, never pure #000
- Numbered, stamped, ruled: the ledger vocabulary of display-ID tags, status pills, and hairline dividers
- One rationed warm accent against a cool navy-and-paper field
- Flat at rest; depth is a response to intent, not decoration
- Motion under 300ms, fully reduced-motion safe

## Colors

A cool navy-and-paper field with exactly one warm accent, plus a small set of functional signal colors that never appear decoratively.

### Primary
- **Jaipur Navy** (#082746): The ink of the system. Body headings, primary button fills, the focus ring, text selection, and every shadow's tint. Dominant by area on any dark surface.
- **Midnight Tile** (#133A60): A lighter navy for tiled or layered navy surfaces where flat #082746 would read as a void.
- **Navy Dawn** (#0C3157) / **Navy Abyss** (#061D33): the two stops either side of Jaipur Navy in the hero's
  dawn gradient. Ground only — never a fill, a border, or a text colour.

### Secondary
- **Terracotta** (#B5532E): The one warm accent. Marks the single most important thing in a view, and carries "warn/attention" in badges. Never used as a general warming device.
- **Terracotta Mist** (#F5E4DA): The tint ground behind terracotta text in badges and pills.

### Neutral
- **Paper** (#FAF7EE): The page ground. Warm cream, never white.
- **Paper Warm** (#F2EDE0): Recessed and alternate sections; the muted surface.
- **Paper Snow** (#FFFFFF): Raised surfaces only — cards, popovers, dialogs. White is a *layer*, not the page.
- **Haze Tint** (#E4ECF5): Cool atmospheric wash for navy-adjacent zones.
- **Ink** (#0F172A): Primary text.
- **Ink Muted** (#475569): Secondary text and badge labels.
- **Ink Soft** (#94A3B8): Placeholder and de-emphasized text. Never for body copy.
- **Line** (#E5E0D5): The warm hairline. Every rule, divider, and card border.

### Tertiary
Functional signals, each locked to one meaning:
- **OK Green** (#16A34A) / **OK Mist** (#DCFCE7): available status. **OK Deep** (#0F7A37) is the text tone —
  OK Green on OK Mist measures 3.0:1, so labels use the deeper value to clear AA.
- **Danger Red** (#DC2626) / **Danger Mist** (#FEE2E2): destructive actions only.
- **Rest Gray** (#64748B) / **Rest Mist** (#F1F5F9): rented and on-hold — deliberately inert.
- **WhatsApp Signal** (#25D366) / **WhatsApp Deep** (#1FB958): reserved exclusively for WhatsApp affordances. Using it for any other green is a bug.
- **Focus Clay** (#EA580C): the focus-visible outline, chosen to read on both paper and navy.

### Named Rules

**The One Voice Rule.** Terracotta marks one thing per screen. If two elements compete for it, neither gets it. Its rarity is what makes it read as emphasis rather than as brand paint.

**The Warm Ground Rule.** The page is paper (#FAF7EE); white (#FFFFFF) is reserved for surfaces that sit on top of it. A full-bleed white background breaks the system.

**The Reserved Green Rule.** WhatsApp green means WhatsApp. Availability green means available. They are never swapped, blended, or reused for generic success states.

## Typography

**Display Font:** Space Grotesk (500/600/700, with system sans fallback)
**Body Font:** Geist Variable (with system sans fallback)
**Label/Mono Font:** ui-monospace / SF Mono / Cascadia Code / Menlo

**Character:** Space Grotesk's slightly mechanical, squared geometry sets the ledger tone in headings and numerals; Geist carries running text with neutral, highly legible warmth. The mono stack handles anything that behaves like a record entry — IDs, badges, status labels — so numbers and codes read as data rather than prose.

### Hierarchy
- **Display** (700, `clamp(2rem, 5vw, 3.25rem)`, line-height 1.1, tracking -0.025em): Page-opening statements. One per page.
- **Headline** (700, `clamp(1.5rem, 3.5vw, 2.25rem)`, line-height 1.2, tracking -0.015em): Section openers.
- **Title** (700, 1.25rem): Card titles, sub-section heads, admin page titles.
- **Body** (400, 1.0625rem, line-height 1.6): Editorial prose. Keep measure in the 65–75ch range.
- **UI** (400, 0.9375rem, line-height 1.5): Standard interface text — card meta, form labels, list rows. The working default below editorial prose.
- **Base / Small / Caption / Meta** (1rem / 0.875rem / 0.8125rem / 0.75rem): The descending interface steps, in use across every surface.

> **Known weakness.** Six steps (0.75 → 1.0625rem) crowd a 12–17px range, which is more granularity than the system can defend — 0.8125rem in particular sits between two neighbours doing the same job. They are documented here because they are genuinely shipped, and an undocumented ramp turns the detector into noise. Consolidating to three or four steps is worth a dedicated pass.
- **Label** (600, 0.6875rem, tracking 0.02em, uppercase, mono): Status pills, badges, display-ID tags, eyebrow markers.

### Named Rules

**The Two Faces Rule.** Space Grotesk sets, Geist says. Display type never runs body copy, and body type never sets a headline. A page using one face for both has lost the system.

**The Data Is Mono Rule.** Anything that is an identifier, a status, or a count — `#04`, "AVAILABLE", "26 min" — is set in the mono label style, not in body type.

## Layout

A single centered column, max-width 1280px, with a responsive gutter that steps up rather than scaling continuously: 16px on mobile, 24px from 768px, 32px from 1024px. The header is a fixed 64px.

Spacing follows a strict 4pt ladder (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px). Every gap, pad, and stack interval is drawn from it — no arbitrary values. Vertical rhythm between major sections uses the upper end (48–96px), while component interiors live in the 4–16px range, which is what produces the ledger's characteristic tight-inside, generous-between texture.

Mobile is the primary device: traffic arrives from WhatsApp and Instagram in-app browsers. Layouts are designed at the phone width first and allowed to breathe on desktop, never the reverse.

**The Ladder Rule.** If a spacing value is not on the 4pt ladder, it is wrong. Reach for the neighbouring step instead of inventing one.

## Elevation & Depth

Flat by default; depth is a response to intent. Surfaces rest with a barely-there `elev-1` (two stacked 1–3px shadows at 4–6% navy) that reads as a printed edge rather than a float. Real elevation appears only when the pointer addresses an element: cards rise to `elev-3` (0 12px 24px at 10% navy) with a 3px translate and a hairline border shift, then settle to a 1px press on active.

Every shadow is tinted with navy (rgba(8,39,70,…)), never neutral black. That tint is what keeps depth inside the warm-paper world instead of graying it out.

### Shadow Vocabulary
- **elev-1** (`0 1px 2px rgba(8,39,70,.04), 0 1px 3px rgba(8,39,70,.06)`): resting state for cards and raised surfaces.
- **elev-2** (`0 4px 8px rgba(8,39,70,.06), 0 2px 4px rgba(8,39,70,.04)`): mid-level surfaces, sticky bars.
- **elev-3** (`0 12px 24px rgba(8,39,70,.10)`): hover and active overlays only.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadow is a response to the pointer, never decoration. If an element is elevated before the user has addressed it, the hierarchy is being faked.

**The Navy Shadow Rule.** Shadows are tinted navy, never black or neutral gray.

## Shapes

A tight, consistent radius ladder: 4px (`sm`) for pills, badges, and tags; 8px (`md`) for cards and containers; 12px (`lg`) for buttons and inputs. The shadcn base radius is 10px, from which the `xl`–`4xl` steps are derived by multiplier.

Borders are the defining form element: a single 1px hairline in warm Line (#E5E0D5) does most of the structural work that shadow does in other systems. Cards, badges, inputs, and dividers all share it, which is what makes the page read as ruled rather than floating.

**The Hairline Rule.** One pixel, warm, #E5E0D5. Borders never thicken for emphasis — emphasis comes from color and elevation instead.

## Components

### Buttons
- **Shape:** Rounded (12px / `rounded-lg`), compact 32px default height, 10px horizontal padding.
- **Primary:** Jaipur Navy fill, paper text. Hover mixes 20% transparency into the fill.
- **Outline:** Paper ground, warm hairline border, muted fill on hover.
- **Ghost:** No chrome at rest; muted fill on hover.
- **Destructive:** Tinted (10% danger) rather than solid — destructive actions are marked, not shouted.
- **States:** `active` presses 1px down (`translate-y-px`). Focus-visible draws a 3px ring at 50% navy plus a border shift. An optional `.btn-sheen` sweeps one 18% white band across on hover in 850ms, suppressed under reduced motion.

### Chips / Pills
- **Status pills:** uppercase mono at 0.6875rem, 4px radius, 4px/8px padding, each with a leading dot. Available uses OK Mist ground; rented and on-hold use inert Rest tones.
- **Badges:** 3px/9px padding, warm hairline border, mono 11px at weight 600. Variants: `--ok`, `--warn`, `--rest`, `--accent`, `--navy`.
- **Display-ID tag:** the ledger's signature mark — the entry number set in mono.

### Cards / Containers
- **Corner Style:** 8px radius, overflow hidden.
- **Background:** Paper Snow on the paper ground.
- **Border:** 1px Line hairline, shifting to 18% navy on hover.
- **Shadow Strategy:** elev-1 at rest → elev-3 on hover (see Elevation).
- **Motion:** box-shadow, transform, and border-color transition together at 200ms on `ease-out` (cubic-bezier(0.22,0.61,0.36,1)).

### Inputs / Fields
- **Style:** Transparent ground, 12px radius, 32px height, hairline border.
- **Focus:** Border shifts to ring navy plus a 3px 50%-opacity ring.
- **Error:** `aria-invalid` drives a destructive border and ring — never a color-only signal.

### Navigation
Fixed 64px header on the paper ground with a hairline base rule. Mobile collapses to a sheet. Wordmark left, actions right.

### Signature Component: the scroll reveal
Elements marked `[data-reveal]` rise 20px, fade in, and drop a 3px blur over 550ms on `ease-out`, staggered via `--reveal-delay`. The hidden state exists **only** inside `@media (prefers-reduced-motion: no-preference)`, so if the observer never runs or motion is reduced, content renders in its final state. This fail-open construction is the pattern to copy for any future motion.

## Do's and Don'ts

### Do:
- **Do** draw every spacing value from the 4pt ladder (4/8/12/16/24/32/48/64/96px).
- **Do** tint shadows with navy `rgba(8,39,70,…)` and keep surfaces flat until hovered.
- **Do** set identifiers, statuses, and counts in the mono label style at 0.6875rem/600/0.02em uppercase.
- **Do** keep transitions at or under 300ms on `cubic-bezier(0.22,0.61,0.36,1)`, and gate every motion behind `prefers-reduced-motion: no-preference` so it fails open.
- **Do** reserve WhatsApp green (#25D366) exclusively for WhatsApp affordances.
- **Do** use the warm hairline (#E5E0D5) for structure before reaching for elevation.

### Don't:
- **Don't** spend terracotta more than once per screen, or use it as general warmth.
- **Don't** use #FFFFFF as a page background — white is a raised surface on the paper ground.
- **Don't** ship aggregator-portal texture: badge spam, stacked ad rails, shouting CTAs, or stock-photo filler.
- **Don't** introduce purple/violet gradients, glassmorphism, cyan-on-dark, or gradient text on headings.
- **Don't** reach for luxury-real-estate signals: gold-on-black, thin serif capitals, full-bleed video heroes, "exclusive" language.
- **Don't** collapse to undifferentiated minimal — Inter everywhere, all-gray, generic card grids. The warm ground and mono ledger marks are the identity.
- **Don't** use bounce, elastic, or overshoot easing on structural UI; `--ease-spring` is for playful interactive moments only.
- **Don't** thicken borders for emphasis.

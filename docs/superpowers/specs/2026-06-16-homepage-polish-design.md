# Homepage Polish — Design Spec

**Date:** 2026-06-16
**Surface:** Homepage (`src/pages/index.astro`) as the showcase; patterns roll out to listings grid, listing detail/gallery, and global primitives afterward.
**Intensity:** Subtle & editorial — "nothing shouts."

## Goal

Add design grace and polish to the Rentoo site without altering its restrained,
editorial, honest-small-brokerage character. Leverage Magic UI / shadcn where they
earn their keep; otherwise port the *recipes* into the existing scoped-CSS idiom.

## Constraints / principles

- **On-brand restraint.** Keep the Jaipur-navy + terracotta + paper-warm palette,
  Space Grotesk display, mono labels, soft elevation. Motion is quiet (300–500ms,
  existing `--ease-out`), low-amplitude.
- **Astro-first.** Server-rendered markup + scoped CSS is the idiom. Don't wrap the
  whole page in React. Use a React island only where motion is genuinely stateful.
- **Performance.** No layout shift; lazy/`client:visible` hydration only; respect
  `prefers-reduced-motion` with a hard off-switch (instant final state, no transforms).
- **Accessibility preserved.** Existing roles/aria/skip-link/focus order unchanged.

## Technical approach (hybrid)

- **Magic UI component used for real:** `NumberTicker` (`@magicui/number-ticker`,
  uses `motion`) — hydrated `client:visible` for the editorial stats. This is the
  single signature animated moment.
- **Magic UI recipes ported to CSS (zero hydration):**
  - blur-fade scroll reveal (blur + translateY + fade), staggered
  - shimmer / sheen sweep on primary buttons
  - optional shiny-text gradient sweep on a kicker
- **Reveal mechanism:** one small IntersectionObserver script in `BaseLayout.astro`
  that toggles a class on `[data-reveal]` elements; CSS does the animation. Reusable
  across every page. Stagger via `--reveal-delay` inline var or `data-reveal-delay`.

## Reusable kit (added now, reused on other surfaces)

1. **Scroll reveal** — `[data-reveal]` → hidden state (`opacity:0; translateY(16px);
   blur(8px)`) animating to clear when ~12% in view, once. Disabled under
   reduced-motion (elements render in final state immediately).
2. **Focus ring** — global `:focus-visible` ring (navy, 2px offset) replacing default
   outlines; consistent across links/buttons/inputs.
3. **Selection color** — `::selection` navy bg / paper text.
4. **Button shimmer** — `.btn-primary` / WhatsApp CTAs get a one-pass light sweep on
   hover (CSS pseudo-element, `mix-blend` highlight), plus existing color transition.

## Per-section polish (homepage)

- **Hero (navy):** low-opacity radial glow + slow aurora drift behind headline
  (`@media (prefers-reduced-motion: no-preference)`; static otherwise). Staggered
  load-in: byline → h1 → sub → search card → chips. Search card lifts on
  `:focus-within`; "Find homes" gets shimmer + arrow nudge on hover.
- **Featured cards:** grid items stagger-reveal on scroll. Refined hover — softer navy
  glow ring, slightly stronger lift, image bottom-scrim for legibility, smoother zoom.
- **Neighbourhoods:** chips stagger-reveal; existing navy-fill hover retained.
- **Why Rentoo (navy):** section reveals; `NumberTicker` counts up `247` and `26`
  (suffix " min") when scrolled into view; `₹0` stays static.
- **Testimonials:** cards stagger-reveal; faint terracotta quotation-mark accent;
  subtle hover lift.
- **Curator sign-off:** reveals; WhatsApp button shimmer; subtle portrait ring.

## Out of scope (this pass)

- Listings grid, listing detail, gallery, header/footer beyond shared kit — applied
  after the homepage direction is approved live.
- No marquee on navigational neighbourhood chips (hurts usability).
- No content/copy changes; no palette changes.

## Acceptance

- `npm run build` succeeds; no console errors in `npm run dev`.
- Reduced-motion users see a static, fully-legible page (no transforms/animations).
- Visual character unchanged; polish reads as "same site, more refined."

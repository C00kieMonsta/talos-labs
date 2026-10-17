# Warmth and urgency

This file specifies the warmth pass over the Mineral restyle: the moodboard's gradients and grain brought into the app, a gradient score ring and done mark, hero bands on the guided Welcome and end screens, and an end screen that says what to click and why it matters. docs/DESIGN-MINERAL.md stays the token map; where the two disagree (grain, gradients, the ring colour), this file wins because the owner overrode the kit on 2026-10-16 after seeing the running app.

Owner's words: "Use more of the gradient with the noisy colors in general, as it is shown on the moodboard." and, of the row version of the end screen, "this is better, however not easy to see what to click, there is no sense of urgency."

References: `Talos-Labs-Mineral-Design-Kit-v1/Talos Labs Brand System Showcase.png` (sand to terracotta gradients, grain, the gradient ring, the concentric spiral), `preview/site-hero.png` and `website/site.css` (grain tile at .35 multiply, the spiral top-right, the horizon band), `tokens/palette.json`.

Foundations in this pass (done, green): tokens in `apps/desktop/src/styles/tokens.css`, the canvas layers in `src/styles/base.css`, assets in `apps/desktop/brand/mineral/{grain,hero}/`, `src/components/GradientDefs.tsx`, `src/components/Hero.tsx`, `scripts/contrast.ts` and the regenerated `src/styles/CONTRAST.md`. Section 10 lists what the implementers mount and change.

## 1. Material

### 1a. Canvas gradient

The canvas is a vertical gradient, painted once per content column and fixed to the viewport so it does not scroll with the page.

- Light: sand `#f5efe8` at the top to a warm clay `#f2e9e0` at the bottom.
- Dark: espresso `#241b18` at the top to a deeper `#1b1411` at the bottom.
- Token `--gradient-canvas: linear-gradient(180deg, var(--gradient-canvas-start) 0%, var(--gradient-canvas-end) 100%)`.

The light bottom stop is lighter than the kit's clay (`#ebdfd4`) for two measured reasons: the review colour and the tertiary icon colour fail their floors on anything deeper once grain is added (section 9), and the row hover fill `--bg-inset` must still read against the bottom of the canvas (1.09:1 at `#f2e9e0`; it would be 1.05:1 at `#efe5db`).

### 1b. Grain

Grain is the kit tile `marketing/grain-overlay.png`, copied to `brand/mineral/grain/grain-overlay.png`: a 512 px grey noise (values 30 to 230) whose own alpha is 5 to 12 of 255. Because the tile carries that alpha, CSS `opacity: 1` gives a peak darkening of about 4.7 % and a mean of 3.5 %, which is the "about .05" the brief asks for. The site's `.35` would be nearly invisible in a 560 px column.

- Light: `--grain-opacity: 1`, `--grain-blend: multiply`. Peak darkening 4.7 %.
- Dark: `--grain-opacity: 0.75`, `--grain-blend: screen` (the same tile, lightening instead of darkening; no pre-inverted asset is needed). Peak lightening 3.5 %.
- Tile: `--grain-url: url("../../brand/mineral/grain/grain-overlay.png")`, `--grain-size: 512px 512px`. Vite rewrites the url (checked: served as `/brand/mineral/grain/grain-overlay.png`, HTTP 200).

Where grain may appear: the canvas and the hero bands only. Never on cards, inputs, sheets, the sidebar, the title strips, badges, or under text smaller than 13 px that is not already on the canvas. Cards are opaque paper (`--bg-elevated`), so they cover the grain by construction; nothing else is needed.

### 1c. How it is painted

`base.css` (appended, section "Warmth pass") gives `.content` `isolation: isolate` and two fixed pseudo-elements at `z-index: -1`, `pointer-events: none`, spanning from the title strip down and from the sidebar across (`top: var(--toolbar-height); left: var(--sidebar-width)`; `left: 0` under `.guided-shell`):

- `.content::before`: `background: var(--gradient-canvas)`.
- `.content::after`: `background-image: var(--grain-url)` at `--grain-size`, `opacity: var(--grain-opacity)`, `mix-blend-mode: var(--grain-blend)`.

Both shells use `.content` (the guided shell renders `.content.guided-content`), so one rule covers both. Checked in the browser demo at 1100 x 760, light and dark: the layers sit under the text, the strips and the sidebar stay flat, the primary button and cards are untouched. Nothing animates.

Flat surfaces, unchanged: title strips (`--bg-canvas`), sidebar (`--bg-sidebar`), cards (`--bg-elevated`), inputs, sheets, badges.

## 2. Accent gradient

Primary buttons and the progress fill use the accent gradient; the focus ring is unchanged.

- Light: `--gradient-accent: linear-gradient(135deg, #87402d, #aa563d)` (rustInk to rust). Hover and active: `--gradient-accent-hover: linear-gradient(135deg, #693122, #87402d)`.
- Dark: `linear-gradient(135deg, #e6b49d, #d49a80)`; hover `linear-gradient(135deg, #f0cab7, #e6b49d)`.
- Text stays `--accent-fg`. Measured: white on `#aa563d` 5.11:1, on `#87402d` 7.50:1; dark ink on `#d49a80` 7.01:1, on `#e6b49d` 9.14:1.

Apply in `components.css`: `.button-primary { background: var(--gradient-accent); border-color: var(--gradient-accent-start) }`, hover and active `background: var(--gradient-accent-hover); border-color: var(--gradient-accent-hover-start)`; `.progress-bar > div { background: var(--gradient-accent) }`. The guided primary in `guided.css` and the guided progress bar fill take the same two tokens. Disabled states keep their current flat treatment. The one-primary-button rule is unchanged.

## 3. Score ring

The ring's value arc is an SVG `linearGradient`; the track stays a plain circle.

- `GradientDefs.tsx` defines `#talos-ring-gradient` (`RING_GRADIENT_ID`, fill string `RING_GRADIENT_FILL`), objectBoundingBox from (1, 0.5) to (0, 0.5) with stops at 0, 0.55 and 1. The arc is drawn with `rotate(-90)`, so on screen the gradient runs from 12 o'clock (start) through the sides (mid) to 6 o'clock (end). A linear gradient cannot follow the arc, so the highlight is at the bottom of the ring rather than at the arc's tip; this is the moodboard look.
- Light stops: `--gradient-ring-start #87402d`, `--gradient-ring-mid #aa563d`, `--gradient-ring-end #bb6a4c`. The end stop is as light as 3:1 on the track allows (3.11:1 on `--ring-track`, 3.89:1 on paper). A true sand highlight cannot clear 3:1 against anything that sits on paper, so light mode stops at a warm terracotta.
- Dark stops: `#e6b49d`, `#d9906f`, `#f3d9c8` (the sand highlight, 10.77:1 on the card, 6.45:1 on the track).
- Track: `--ring-track` `#ebe2d9` light (lighter than `--border` so the end stop clears it), `#58483f` dark.

Apply in `screens.css`: `.score-meter-value { stroke: url(#talos-ring-gradient) }` and `.score-meter-track { stroke: var(--ring-track) }`. The `grade-*` modifier classes stop setting `--grade-fill` on the ring; `--grade-*` tokens remain for the grade badge, the Overview tile and the sidebar pill. The grade word and icon under the figure carry the grade, so colour never carried it alone. Animation unchanged (900 ms fill, static under reduced motion).
## 4. Hero bands

`Hero.tsx` renders two decorative bands, both `aria-hidden`, `pointer-events: none`, no animation.

### 4a. Spiral band (Welcome and end screens)

- `<Hero kind="spiral" size={560} />`. The kit spiral (`SpiralMark`, the same geometry as the brand mark) in a 560 px square, absolutely positioned `top: -120px; right: -160px` inside `.content`, which is `position: relative` and clips horizontally. `vector-effect: non-scaling-stroke` keeps the line at 1.2 px at any size; the centre dot is 0.5 units.
- Colour `--hero-spiral-stroke`: rust `#aa563d` light, `#e6b49d` dark. Opacity `--hero-spiral-opacity`: 0.10 light, 0.12 dark.
- Placement: at 1100 px the band's left edge is at about x = 700, past the 560 px column's right edge (x = 830 at 1100 wide, so the outer rings cross the column's last 130 px). At 900 px the overlap is about 230 px. The rings are 1.2 px lines at 10 %, so text over them is measured as text over a solid line: `--fg-secondary` on the darkest canvas stop under a line is 4.70:1 (light), 6.86:1 (dark). That is what "never behind the reading area at full strength" means here: the band may cross the column's right edge, the opacity token is the limit, and 0.12 light would fail (4.45:1).
- `z-index: -1` inside the isolated `.content`, after `::before` and before `::after`, so the gradient is under it and the grain is over it.

### 4b. Horizon band (end screen only)

- `<Hero kind="horizon" height={120} />`. The site hero's two dunes in a 1400 x 170 box (`brand/mineral/hero/horizon.svg`; paths `HORIZON_BACK` and `HORIZON_FRONT` in `Hero.tsx`), `preserveAspectRatio="none"`, full width.
- Fills `--horizon-1` (back dune, `#ebdfd4` light, `#2f2521` dark) and `--horizon-2` at 50 % (front dune, `#d8bba9` light, `#3a2e29` dark).
- In flow, not absolute: the last child of the guided column with `margin-top: auto`, so it sits at the bottom of the viewport when the screen is short and after the content when it scrolls. No text sits on it. `--fg` and the accent link clear 4.5:1 on both dunes in case the "Check again" link ever meets it; `--fg-secondary` does not (4.16:1 on the front dune), so secondary text may never sit on the band.

### 4c. Rings band (available, not mounted)

- `<Hero kind="rings" size={560} />`: the site hero's seven concentric circles and centre dot (`brand/mineral/hero/rings.svg`; `RINGS_RADII` in `Hero.tsx`), in the same place as the spiral band with the same stroke token, opacity token and 1.2 px non-scaling line. Imported from the kit on 2026-10-17 so a screen can take the site's hero instead of the mark; no screen does yet. The `canvas-spiral` contrast row covers it: text over a ring is text over a line at `--hero-spiral-opacity`.

## 5. Status mark

The 56 px done disc above "Your Mac is safer than it was." and "Your Mac is in good shape." becomes a gradient disc: `GradientDefs` defines `#talos-mark-gradient` (`MARK_GRADIENT_ID`, fill string `MARK_GRADIENT_FILL`), the accent gradient at 135deg. The tick is drawn in `--accent-fg` (white on rust 5.11:1 at the lightest stop; dark ink on `#d49a80` 7.01:1). The drawn-tick animation is unchanged.

## 6. Urgency and clickability on the guided end screen

Base: the row version (labelled groups, one 44 px row per item, leading kit icon, trailing chevron, hairlines), not the comma-joined `EndSummary`. Revert `EndScreen.tsx` to rows, then apply the following. The existing test ids and the `END` strings stay; new strings are listed here.

### 6a. Groups, in this order

1. "Do this next" (new label): one highlighted card, section 6b.
2. "Still waiting" (`END.waiting`): `plan.later`.
3. "In the full version" (`END.locked`): `plan.locked`.
4. "Things I left alone" (`END.leftAlone`): `plan.leftAlone`.
5. "For a technical person" (`END.technical`): `plan.technical`.
6. "Couldn't check" (new label): one row, "I couldn't check N areas." (existing sentence), opens Findings.

A group is omitted when empty. The item chosen for "Do this next" is removed from its own group so it is not listed twice.

### 6b. "Do this next"

Selection: among `plan.later`, `plan.locked` and the critical or high rules in `plan.leftAlone` (never `technical`, never unreadable, never a low or medium rule the person chose to leave alone), the finding with the highest `result.points`; ties go to catalogue order (the same order `packages/core/src/guided/plan.ts` uses). When nothing qualifies the group is omitted and the screen reads as today, so "Your Mac is in good shape." is never followed by a nudge about a minor item.

Rendering, on paper: a `.guided-next-card` with `background: var(--bg-elevated)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-md)`, padding 16 px 20 px 20 px, and a severity cue on the left edge: a 3 px bar inset 10 px from the top and bottom, `--sev-cue-critical` for a critical rule, `--sev-cue-high` for high, none otherwise. Inside, top to bottom:

- the headline, `guidedFor(id).headline`, `--text-guided-list` at 600;
- one line of why, the rule's `guided.why`, `--text-guided-meta` in `--fg-secondary`;
- the step's primary button inline, 44 px, `--gradient-accent`, 220 to 320 px wide: "Show me where" when the step is a show step, "Fix it for me" when the app can fix it, "Unlock" for a locked rule (opens the paywall step as "Buy the full version" does today). This is the screen's one primary button; "Check again" stays the text link under the groups.

Clicking the button does what the step did: run the fix, open the show step, or open the paywall. The card itself is not a button; only its primary is.

### 6c. Rows

Each item is one `button.guided-end-row`, 44 px, full column width: a 20 px kit icon in `--fg-secondary` (waiting `watch`, locked `licence`, left alone lucide `EyeOff`, technical `developer`, couldn't check `CircleQuestionMark`), the headline in `--text-guided-list` `--fg`, and a trailing chevron in `--fg-secondary` (the kit's `ChevronRightIcon`, from `brand/mineral/icons/chevron-right.svg`). Rows in a group are separated by 1 px `--border` hairlines; the group label sits above in `--text-guided-meta` `--fg-secondary`, margin 24 px 0 4 px. States: hover `--bg-inset`, pressed `--bg-pressed`, `cursor: pointer`, `border-radius: var(--radius-sm)`, the global `:focus-visible` ring. One rule opens its finding; the "Couldn't check" row opens Findings (as today).

### 6d. Urgency sentence

Under the headline, after the "N things fixed today." line where there is one:

- a critical rule remains in waiting, locked or left alone: "<guided.headline>. That is the biggest risk left." (for example "Your disk is not locked. That is the biggest risk left.");
- otherwise a high rule remains: "<guided.headline>." (for example "The firewall is still off.");
- otherwise the calm sentence `END.nextTime` ("I'll check again next time you open me."), which the all-done and nothing states already show.

Rules may override the automatic sentence with an optional `guided.urgent` string in the catalogue; add it only where the headline does not read as a sentence.

### 6e. Plan screen

"Show me the list" does not get the card. The plan screen ("I found N things to fix.") gets one line directly under its headline when a critical rule is in `plan.steps`: "One of these is urgent.", `--text-guided-body` at 600 in `--fg`, with the critical icon (16 px, `--sev-critical-fg`) leading so colour does not carry it alone.

## 7. Expert Overview

The "Next three fixes" rows (`FindingCard` inside `.finding-rows`) gain the left-edge severity cue for critical (`--sev-cue-critical`) and high (`--sev-cue-high`): the same 3 px bar inset 8 px top and bottom, drawn by a `::before` so the card radius is kept. Hover `--bg-inset`, pressed `--bg-pressed`, cursor pointer, focus ring as today. Measured: both cues clear 3:1 on paper and on the hover fill, light and dark.

## 8. Domain

- `apps/desktop/src-tauri/src/commands.rs`: `BUY_URL` becomes `https://taloslabs.si/shop`. `cargo test` must stay green (a test may pin the constant).
- Settings, About section (`AboutSection` in `src/screens/Settings.tsx`): add a "Website" row reading `taloslabs.si`, plain text, next to Version and Core.
- `README.md`: name the domain in the opening section ("Talos Labs lives at taloslabs.si; the shop is https://taloslabs.si/shop.").
- `docs/LICENSING.md`, the "Buy a licence" bullet: name the fixed URL, `https://taloslabs.si/shop`.
## 9. Tokens and contrast

All tokens are appended to `tokens.css` in a second `:root` block and a second dark media block (append-only; `scripts/contrast.ts` reads every `:root` block and lets later blocks override earlier ones, as the cascade does). Gradient stops are separate hex tokens so the script can measure them.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--gradient-canvas-start` | `#f5efe8` | `#241b18` | top of the canvas |
| `--gradient-canvas-end` | `#f2e9e0` | `#1b1411` | bottom of the canvas |
| `--gradient-canvas` | `linear-gradient(180deg, start 0%, end 100%)` | same | `.content::before` |
| `--grain-url` | `url("../../brand/mineral/grain/grain-overlay.png")` | same | `.content::after` |
| `--grain-size` | `512px 512px` | same | tile size |
| `--grain-opacity` | `1` | `0.75` | peak 4.7 % darkening / 3.5 % lightening |
| `--grain-blend` | `multiply` | `screen` | `mix-blend-mode` |
| `--gradient-accent-start` | `#87402d` | `#e6b49d` | primary, progress fill, done disc |
| `--gradient-accent-end` | `#aa563d` | `#d49a80` | |
| `--gradient-accent` | `linear-gradient(135deg, start, end)` | same | |
| `--gradient-accent-hover-start` | `#693122` | `#f0cab7` | hover and active |
| `--gradient-accent-hover-end` | `#87402d` | `#e6b49d` | |
| `--gradient-accent-hover` | `linear-gradient(135deg, start, end)` | same | |
| `--gradient-ring-start` | `#87402d` | `#e6b49d` | ring, 12 o'clock |
| `--gradient-ring-mid` | `#aa563d` | `#d9906f` | ring, offset 0.55 |
| `--gradient-ring-end` | `#bb6a4c` | `#f3d9c8` | ring, 6 o'clock |
| `--ring-track` | `#ebe2d9` | `#58483f` | ring track |
| `--hero-spiral-stroke` | `#aa563d` | `#e6b49d` | spiral band |
| `--hero-spiral-opacity` | `0.1` | `0.12` | spiral band |
| `--horizon-1` | `#ebdfd4` | `#2f2521` | back dune |
| `--horizon-2` | `#d8bba9` | `#3a2e29` | front dune, drawn at 50 % |
| `--sev-cue-critical` | `#9b403b` | `#f1aaa4` | cue bar |
| `--sev-cue-high` | `#6e2a1f` | `#eca48c` | cue bar |

Two kit colours are darkened one more step in light mode, because they fail their floors at the bottom of the canvas with grain composited. Dark is unchanged.

| Token | Was | Now | Why |
|---|---|---|---|
| `--fg-tertiary` | `#9e8575` | `#927968` | icons were 2.63:1 on the composited bottom; now 3.10:1 (3.57:1 on sand, 3.98:1 on paper) |
| `--notice-fg`, `--sev-medium-fg`, `--grade-fair` | `#83643f` | `#785a37` | review text was 4.14:1 on the composited bottom; now 4.81:1 (5.42:1 on its tint, 4.99:1 on the fair track) |

DESIGN-MINERAL.md section 2 lists the kit's review colour as `#83643f`; this file supersedes that row for light mode.

### 9a. Contrast table

`pnpm exec tsx scripts/contrast.ts` (from `apps/desktop`) rewrites `src/styles/CONTRAST.md` and exits non-zero on any failure. It now also:

- decodes `brand/mineral/grain/grain-overlay.png` itself (8-bit PNG, all five filters) to get the tile's darkest and lightest grey and its peak alpha, so a swapped tile is measured and not assumed;
- derives four backgrounds per scheme: `canvas-darkest` (the darker canvas stop with the darkest grain pixel composited at peak alpha times `--grain-opacity`, multiply in light, screen in dark), `canvas-lightest` (the lighter stop with the lightest grain pixel), `canvas-spiral` (the darker stop under a spiral line at `--hero-spiral-opacity`) and `horizon-front` (`--horizon-2` at 50 % over `--horizon-1`);
- measures every text colour that can sit on the canvas against `canvas-darkest` and `canvas-lightest`; `--fg`, `--fg-secondary` and the accent against `canvas-spiral`; `--accent-fg` against all four accent stops; the three ring stops against the card, the track and the canvas at 3:1; the cue bars against paper and the hover fill at 3:1; `--fg` and the accent against both dunes.

Worst cases, light (all pass; the full table is CONTRAST.md): `--fg-secondary` on `canvas-darkest #e8dfd7` 4.85:1; `--fg-tertiary` 3.10:1; `--notice-fg` 4.81:1; `--sev-low-fg` 4.74:1; `--grade-poor` 4.14:1 (3:1 floor); `--fg-secondary` on `canvas-spiral #ebdad0` 4.70:1; `--accent-fg` on `--gradient-accent-end` 5.11:1; `--gradient-ring-end` on `--ring-track` 3.11:1 and on `canvas-darkest` 3.02:1; `--gradient-accent-end` on `--bg-canvas` 4.48:1 (3:1 floor). Dark: the lowest non-text pair is `--gradient-ring-mid` on `--ring-track` at 3.38:1; every dark text pair on the new backgrounds (`canvas-*`, `canvas-spiral`, the dunes, the accent stops) is above 6:1. The lowest dark text pair in the whole table is the pre-existing `--sev-info-fg` on its tint, 4.93:1.

Reading the table: the `canvas-*` rows are the brief's "text on grain" and "text on gradient" samples. `canvas-darkest` is the darkest point under any text in light mode; `canvas-lightest` is the lightest point in dark mode. Grain is composited from the real tile, not approximated.

### 9b. Reduced motion

Nothing in this pass animates. Gradients and grain are static layers; the spiral and horizon are static SVG. The existing motion table in DESIGN-MINERAL.md section 5 is unchanged.
## 10. Foundations and what the implementers mount

Delivered in this pass, all checked (`pnpm --filter @talos/desktop typecheck`, `pnpm --filter @talos/desktop test` 475 passing, `pnpm exec tsx scripts/contrast.ts` all pairs pass, browser demo screenshots light and dark):

| Path | What |
|---|---|
| `apps/desktop/src/styles/tokens.css` | the tokens in section 9, appended |
| `apps/desktop/src/styles/base.css` | `.content` isolation and the two fixed layers; `.hero`, `.hero-spiral`, `.hero-horizon` |
| `apps/desktop/brand/mineral/grain/grain-overlay.png`, `mineral-grain.png` | copied from the kit; the second is carried, not referenced |
| `apps/desktop/brand/mineral/hero/horizon.svg` | the drawn horizon, editable source for `Hero.tsx` |
| `apps/desktop/brand/mineral/README.md` | the two new folders |
| `apps/desktop/src/components/GradientDefs.tsx` | `GradientDefs`, `RING_GRADIENT_ID`, `MARK_GRADIENT_ID`, `RING_GRADIENT_FILL`, `MARK_GRADIENT_FILL` |
| `apps/desktop/src/components/Hero.tsx` | `Hero` with `kind`, `size`, `height`, `className`, `style`; `HORIZON_VIEWBOX`, `HORIZON_BACK`, `HORIZON_FRONT` |
| `apps/desktop/scripts/contrast.ts`, `src/styles/CONTRAST.md` | the extended script and the regenerated table |

Not touched, by assignment: `components.css`, `screens.css`, `guided.css`, any screen or guided component, Rust, README, LICENSING.

### 10a. Mounting

1. `GradientDefs`: in `src/App.tsx`, render `<GradientDefs />` as the first child inside `<AppContext.Provider>`, before any shell, so both shells share one copy and `url(#talos-ring-gradient)` and `url(#talos-mark-gradient)` resolve everywhere.
2. Score ring: `screens.css` `.score-meter-value { stroke: url(#talos-ring-gradient) }`, `.score-meter-track { stroke: var(--ring-track) }`; remove `--grade-fill` from the ring (keep the `grade-*` classes for the centre text if they are used there). Update `ScoreMeter.test.ts` if it asserts the stroke.
3. Done disc: in `StepFrame.tsx`, inside `.guided-status-mark`, add an absolutely positioned `<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="28" fill={MARK_GRADIENT_FILL} /></svg>` under the tick; `guided.css` sets `.guided-status-mark { position: relative; background: none; color: var(--accent-fg) }`.
4. Spiral band: `GuidedShell` takes an optional `hero?: ReactNode` and renders it as the first child of `.content.guided-content`, before `<main class="guided">`. `GuidedWelcome` and `EndScreen` pass `<Hero kind="spiral" />`. `.content` already has `position: relative` and `overflow-x: hidden`.
5. Horizon: `EndScreen` renders `<Hero kind="horizon" />` after `StepFrame`. `guided.css`: `.guided-content { display: flex; flex-direction: column }` and, on the band, `margin-left: -42px; margin-right: -42px; width: calc(100% + 84px)` to bleed past the column padding. `base.css` already gives it `margin-top: auto`.
6. Primary buttons and progress fills: section 2.
7. End screen, plan line, Overview rows, domain: sections 6, 7, 8.

### 10b. Checks for the implementers

- `pnpm --filter @talos/desktop typecheck && pnpm --filter @talos/desktop test`; `cargo test` after the Rust change.
- `pnpm exec tsx scripts/contrast.ts` after any token change. New colour pairs go into `PAIRS`.
- `qa/snap.ts` and `qa/axe.ts` in demo mode; re-snap `guided-end-*`, `guided-welcome`, `guided-plan*`, `overview-*` at 900 and 1100, light and dark. Check at 900 x 600 that the "Do this next" card, its button and the first group fit without the horizon covering a row.
- Confirm in Tauri (final agent only) that the fixed layers stay put while the content scrolls and that the gradient survives `tauri build` (Vite hashes the tile into `dist/assets`).

### 10c. Known limits

- The ring highlight sits at the bottom of the ring, not at the arc's tip (section 3).
- Light mode cannot reach a sand highlight on the ring without breaking 3:1; dark mode does.
- The spiral band crosses the right edge of the 560 px column at 1100 px and more at 900 px; the opacity tokens are the measured limit.
- The grain tile is grey, so the dark scheme lightens with `screen`; a warmer dark grain would need a tinted tile.
- `mineral-grain.png` (1000 x 700, opaque, sandy) is copied but unused; it is a candidate for a stronger hero texture if the owner wants more than the overlay tile.

# Mineral design

The Mineral design kit is the visual source of truth for the app. This file records where the kit lives, which of its assets the app carries, how its names map onto the app's tokens, how the severity and grade scales were derived from its three status colours, the icon policy and the rules the kit sets. docs/DESIGN-V02.md section 2 ("Visual system") is superseded by this file; the rest of DESIGN-V02.md (screens, states, scanning pacing, on-device AI) and all of DESIGN-V03.md still apply.

## 1. The kit

The kit was supplied by the owner on 2026-10-16 and sits at the repo root: `Talos-Labs-Mineral-Design-Kit-v1/`. Read in this order:

- `docs/README.md` and `docs/component-inventory.md`: the rules and the component set.
- `tokens/talos-tokens.css`, `tokens/type-scale.json`, `tokens/palette.json`: the values.
- `app/app.css` and `app/app.js`: the prototype's measurements for the guided and expert screens.
- `preview/*.png` and `Talos Labs Brand System Showcase.png`: rendered references.

The prototype opens in a browser at `file:///<repo>/Talos-Labs-Mineral-Design-Kit-v1/app/index.html?screen=plan`. Screens: `welcome`, `plan`, `single`, `batch`, `show`, `permission`, `paywall`, `end`, `overview`, `findings`, `finding`, `settings`, `ask`; add `&theme=dark` or `&width=900`. It is a design study and does nothing to the Mac.

Nothing in the app imports from the kit folder. The assets the app needs were copied into `apps/desktop/brand/mineral/` (see its `README.md`):

| Copied to | From the kit | Used by |
|---|---|---|
| `brand/mineral/icons/*.svg` (33 files) | `icons/svg/` | `scripts/gen-icons.ts`, which writes `src/components/icons/<Name>Icon.tsx` |
| `brand/mineral/logos/spiral-mark-{light,dark,rust}.svg`, `wordmark-{light,dark}.svg` | `brand/logos/` | `gen-icons.ts` emits `SpiralMark.tsx` from the dark mark; `Brand.tsx` renders it in `currentColor` |
| `brand/mineral/app-icon/icon-1024.png`, `Talos-Labs.icns` | `brand/app-icon/` | `pnpm tauri icon` writes `src-tauri/icons/`; the `.icns` then overwrites `icon.icns` |
| `brand/mineral/installer/dmg-background.png` | `installer/` | copied to `src-tauri/assets/dmg-background.png`, named by `bundle.macOS.dmg.background` in `tauri.conf.json` |

Paths in the table are relative to `apps/desktop/`. The kit's `website/`, `marketing/` (grain textures) and `installer/dmg-background.svg` stay in the kit; the app never shows grain.

## 2. Tokens

Tokens live in `apps/desktop/src/styles/tokens.css`. Names did not change from v0.2; values did. New tokens: `--bg-sidebar` (the old `--bg-sidebar-fallback` now aliases it), `--brand-mark`, `--control-guided` (44 px), `--guided-width` (560 px) and the five `--text-guided-*` fonts.

| Kit name (`talos-tokens.css` / `palette.json`) | App token | Light | Dark |
|---|---|---|---|
| `--canvas` (sand) | `--bg-canvas` | `#f5efe8` | `#241b18` |
| `--card` (paper) | `--bg-elevated` | `#fffcf8` | `#312723` |
| `--sidebar` | `--bg-sidebar` | `#f0e7df` | `#2b211e` |
| `--inset` (clay) | `--bg-inset`, `--sidebar-selection` | `#ebdfd4` | `#41352f` |
| slate | `--bg-pressed` | `#ddd0c4` | `#41352f` |
| (between clay and slate, app only) | `--bg-hover` | `#e5d8cb` | `#3a2e29` |
| `--fg` (ink) | `--fg` | `#2c211c` | `#f6ede6` |
| `--fg-secondary` | `--fg-secondary` | `#6f5b52` (adjusted) | `#c8b8ad` |
| stone | `--fg-tertiary` (icons only, never text) | `#9e8575` (adjusted) | `#af9788` |
| `--border` (hairline) | `--border` | `#d6c6b9` | `#58483f` |
| taupe | `--border-strong` | `#79665c` | `#8c7a6e` |
| espresso / paper | `--brand-mark` | `#35241f` | `#fffcf8` |
| `--accent` (rust ink) | `--accent` | `#87402d` | `#e6b49d` |
| `--accent-hover` | `--accent-hover` | `#693122` | `#f0cab7` |
| `--accent-contrast` | `--accent-fg` | `#ffffff` | `#241b18` |
| `--focus` | `--focus`; `--focus-halo` is the same colour at 25 % (30 % dark) | `#a55c44` | `#e3ad92` |
| `--success-fg` | `--success-fg`, `--grade-good` | `#32624e` | `#a6d5b6` |
| `--review-fg` | `--notice-fg`, `--sev-medium-fg`, `--grade-fair` | `#83643f` | `#e3c48b` |
| `--critical-fg` | `--danger`, `--sev-critical-fg`, `--grade-at_risk` | `#9b403b` | `#f1aaa4` |
| `--radius-control` / `-card` / `-sheet` | `--radius-sm` / `-md` / `-lg` | 7 / 12 / 16 px | same |
| `--motion-fast` / `-base` / `-slow` | same names | 150 / 200 / 250 ms | same; 0 ms under reduced motion |
| `--grain-opacity` | not carried | | |

Spacing keeps the app's own `--space-0` to `--space-8` (4, 8, 16, 24, 32, 40, 48, 64 px); the kit's 12 px step is not used. Type comes from `type-scale.json`: guided `title`, `body`, `list`, `meta`, `button` are `--text-guided-title` (600 26px/1.2), `--text-guided-body` (400 17px/1.5), `--text-guided-list` (400 16px/1.45), `--text-guided-meta` (500 14px/1.3) and `--text-guided-button` (600 17px/1.25); expert `body`, `caption`, `meta`, `cardHeading`, `headline` are `--text-body` (13), `--text-caption` (11), `--text-meta` (12), `--text-title3` (17) and `--text-title2` (20). `--text-reading` (14), `--text-title1` (28) and `--text-hero` (48) are not in the kit and keep their v0.2 use. Layout: `--toolbar-height` 52 px, `--sidebar-width` 220 px, `--guided-width` 560 px with 72 px top padding, `--control` 32 px, `--control-guided` 44 px. Elevation: hairline borders; the only shadow is `--shadow-sheet`; `--card-highlight` is `none`.

Four kit colours were adjusted so every pair clears WCAG AA. The reasons are also in comments in `tokens.css`:

- `--fg-secondary`: kit `#756158` was 4.45:1 on clay; app uses `#6f5b52` (4.87:1 on clay, 4.56:1 on hover).
- `--fg-tertiary` (light): kit stone `#af9788` failed 3:1 for icons; app uses `#9e8575` (3.03:1 on canvas). Dark keeps `#af9788`.
- `--notice-bg` and `--sev-medium-bg`: kit review `#83643f` on the kit tint `#f3e8d6` was 4.49:1; the tint is `#f6ecde` (4.66:1).
- `--sev-info-fg`: stone on clay is 2:1 and cannot be text; app uses `#6b5c55` (4.88:1).

The measured table is `apps/desktop/src/styles/CONTRAST.md`, written by `pnpm exec tsx scripts/contrast.ts` from `apps/desktop`. The script reads `tokens.css`, rewrites the file and exits non-zero when any pair fails (text 4.5:1, icons, meter fills, rings and strong borders 3:1). New foreground/background combinations go into `PAIRS` in `scripts/contrast.ts`.

## 3. Severity and grades

The kit gives three status colours: success `#32624e`, review `#83643f`, critical `#9b403b`. The app needs five severities and four grades, so the rest are derived in the same hue family and measured. The rust accent is never one of them. Ratios below are light, from CONTRAST.md; "tint" is the badge text on its own `--sev-*-bg`, then on the card (`--bg-elevated`) and the canvas.

| Severity | fg / bg (light) | tint / card / canvas | fg / bg (dark) | tint |
|---|---|---|---|---|
| critical | `#9b403b` / `#f7e4e1` (kit critical) | 5.37 / 6.44 / 5.77 | `#f1aaa4` / `#4a2a28` | 6.67 |
| high | `#6e2a1f` / `#f5e6de` (darker brown-red than critical; not the accent) | 8.57 / 10.19 / 9.13 | `#eca48c` / `#452b22` | 6.32 |
| medium | `#83643f` / `#f6ecde` (kit review, adjusted tint) | 4.66 / 5.32 / 4.77 | `#e3c48b` / `#3f3322` | 7.34 |
| low | `#6f5d53` / `#ebdfd4` (warm grey on clay) | 4.76 / 6.10 / 5.46 | `#c8b8ad` / `#41352f` | 6.15 |
| info | `#6b5c55` / `#ebdfd4` (warm grey on clay) | 4.88 / 6.25 / 5.60 | `#b9a396` / `#41352f` | 4.93 |

Tokens `--sev-<name>-fg` and `--sev-<name>-bg`. A badge always pairs the word with an icon (section 4), so colour never carries the meaning alone.

| Grade | fill / track (light) | fill on track / on card | fill / track (dark) | fill on track |
|---|---|---|---|---|
| good | `#32624e` / `#d5e6dc` (kit success) | 5.41 / 6.86 | `#a6d5b6` / `#1f3a2e` | 7.52 |
| fair | `#83643f` / `#efe3cf` (kit review) | 4.29 / 5.32 | `#e3c48b` / `#3f3322` | 7.34 |
| poor | `#9a5a1f` / `#f3e2cc` (amber between review and critical, app only) | 4.29 / 5.32 | `#e8a371` / `#45301e` | 5.85 |
| at_risk | `#9b403b` / `#f2d8d4` (kit critical) | 4.87 / 6.44 | `#f1aaa4` / `#4a2a28` | 6.67 |

Tokens `--grade-<name>` and `--grade-<name>-track`. The score meter in `ScoreMeter.tsx` keeps the v0.2 anatomy (ring, ticks, `role="meter"`, 900 ms fill, static under reduced motion); only the colours changed.

## 4. Icons

Kit icons first, lucide only where the kit has no glyph. All icons go through `apps/desktop/src/components/Icon.tsx` (`<Icon icon={...} size={16 | 20} label? />`), which sets `strokeWidth` 1.5, `aria-hidden` when there is no label and `role="img"` with `aria-label` when there is. `IconComponent` covers both kinds, so a kit icon and a lucide icon take the same props.

- Kit icons: the 33 SVGs in `brand/mineral/icons/` become `src/components/icons/<Name>Icon.tsx` (for example `CheckUpIcon`, `ArrowUpRightIcon`) plus `SpiralMark.tsx`, all generated by `pnpm exec tsx scripts/gen-icons.ts` and never edited by hand. `KIT_ICON_NAMES` in `src/components/icons/index.ts` feeds the icons test.
- Registry: `apps/desktop/src/app/icons.ts` maps nav, sections, severities, grades, fix cost and the `ICONS` names. Keys added for the kit: `pause`, `arrowLeft`, `watch`, `checkup`, `mac`, `privacy`, `licence`, `developer`, `terminal`, `extensions`, `shield`.
- Lucide fallback (the full list is `LUCIDE_NAMES` in `icons.ts`, checked by the export test): `Bug` (malwareProtection), `ScreenShare` (remoteAccess), `Repeat` (persistence), `LogIn` (loginItems), `Globe` (browsers), `FileCode` (dotfiles), `OctagonAlert` (critical), `CircleAlert` (medium, `alert`), `ShieldCheck` / `Shield` / `ShieldAlert` / `ShieldOff` (grades good, fair, poor, at_risk, kept as one family so the four grades share an outline), `Wrench` (in-app fix), `EyeOff`, `CircleQuestionMark`, `LoaderCircle`, `FolderSearch`, `Download`, `Cpu`, `Square` (stop), `ChevronLeft`, `Copy`.
- Severity icons: critical `OctagonAlert`, high kit `WarningIcon`, medium `CircleAlert`, low and info kit `InfoIcon`. Section choices worth knowing: passwordPolicy `KeyIcon`, ssh `TerminalIcon`, platformIntegrity `ShieldIcon`.
- Brand: `src/components/Brand.tsx` renders the spiral in `currentColor` (from `--brand-mark`) with the 13/600 wordmark, at size 20 (sidebar) or 24. The light, dark and rust marks share one geometry, so only the dark SVG is turned into code.

## 5. Rules the kit sets

- Warm mineral surfaces (sand, paper, clay). Hairline 1 px borders in `--border`, never shadows, except the sheet.
- The rust accent is an action colour: primary button, links, focus. It is never a severity or status colour.
- Status always has a word and an icon. Unknown readings say "Couldn't check". An incomplete score is labelled.
- No grain inside the app (the kit's grain is for marketing only), no glow, no neon, no 3D, no metallic gradients, no ambient looping motion.
- System font only; no font binaries shipped.
- Guided: one 560 px column, 72 px top padding, type 26/17/16/14, one 44 px primary button per step, "Details" as a link.
- Expert: 13 pt body, 52 px title strip, 220 px sidebar, content scrolls alone.
- Radii 7 (controls), 12 (cards), 16 (sheets).
- Native shell 1100 x 760 by default, 900 x 600 minimum; the guided buttons must fit at 900 x 600.
- Privilege dialogs are native macOS; the app never draws a password field.
- AI text is on-device, optional and labelled "Not verified".
- British English in every string.

Motion (tokens 150 / 200 / 250 ms; `prefers-reduced-motion: reduce` sets them to 0 ms):

| Event | Regular | Reduced motion |
|---|---|---|
| Hover, press | 150 ms | immediate |
| Guided screen change | 200 ms crossfade, no transform | immediate |
| Sheet in / out (expert) | 200 ms opacity | immediate |
| Screen transitions, list reveal | 250 ms | immediate |
| Scan reveal | sequential, at least 6 s | same order, at least 4.5 s |
| Score value and ring | 900 ms fill | final value at once |
| Fix success | 240 ms tick, hold 1400 ms | static tick, hold 1800 ms |
| AI text | field by field with a Stop control | no typewriter; legible updates |

## 6. Checks

`pnpm exec tsx scripts/contrast.ts` must exit zero. The Playwright harness in `apps/desktop/qa/` (`snap.ts`, `axe.ts`, demo mode `VITE_TALOS_DEMO=1`) keeps its assertions; the baseline shots in `qa/screenshots/v03` are re-snapped after a colour change. `src/components/Icon.test.ts`, `Brand.test.ts` and `src/app/icons.test.ts` cover the icon registry and the generated components.

# Talos Labs — Mineral design kit v1

A usable, editable first-pass asset package inspired by the approved warm, sandy, subtly grainy direction. **No neon, glow, metallic gradients, 3D shields or ornamental dashboards.** The spiral is a quiet signal of repeated checks, not an alarm symbol.

## Start here

- `preview/`: rendered contact sheet and full-size page/screenshots.
- `brand/app-icon/`: default, dark, tinted SVG and PNG exports (16–1024 px); `brand/app-icon/background.svg` and `foreground.svg` are **layer sources** for subsequent Icon Composer import, **not** an exported `.icon` project.
- `brand/logos/`: editable spiral marks and wordmarks in SVG. The SVG wordmark uses a system font. Convert text to outlines in your final vector editor if your distribution pipeline requires deterministic glyphs.
- `icons/svg/`: 33 matching, 24×24, 1.5 px line icons. SVGs use `currentColor`. These are original simple outline drawings and can be recoloured using CSS. The native Mac equivalent may also use SF Symbols after a separate licence review.
- `tokens/`: palette, type scale, CSS custom properties with light and dark theme variants.
- `app/index.html`: click-through webview design study. Try `?screen=welcome`, `?screen=plan`, `?screen=single`, `?screen=batch`, `?screen=show`, `?screen=permission`, `?screen=paywall`, `?screen=end`, `?screen=overview`, `?screen=findings`, `?screen=finding`, `?screen=settings`, `?screen=ask`, `?theme=dark`, `?width=900`. It is **a design demonstration**; it cannot scan or change Mac settings.
- `website/`: complete responsive static mockups of home, privacy, FAQ, shop, and download. **Not a production deployment.** Checkout, pricing, download destination, support and legal details must be provided before launch.
- `website/email/`: responsive HTML + text licence email templates, with replaceable placeholders.
- `installer/`: 660×400 and 1320×800 disk-image background with drag indicator.
- `marketing/`: two mineral grain textures for campaign and site use. Grain is intentionally omitted from app content, ensuring legibility.

## Design foundations

| Usage | Colour |
|---|---|
| Canvas | `#F5EFE8` |
| Surface | `#FFFCF8` |
| Inset / clay | `#EBDFD4` |
| Primary text | `#2C211C` |
| Secondary text | `#756158` |
| Borders | `#D6C6B9` |
| Primary action | `#87402D` |
| Success | `#32624E` |
| Warnings | `#83643F` |
| Critical | `#9B403B` |

The muted rust is an action accent, not a severity colour. The app's semantic status colours remain distinct. Use words and icons, not colour alone. Avoid grain behind controls or small type. Prefer 1 px borders over elevation and excessive cards.

The source briefing specifies **SF Pro** and the macOS system type scale. The preview references the system font through CSS (`-apple-system`); **no font binaries are redistributed**. For the website, use system fonts now or obtain a separately licensed web font for production.

The **v0.3 guided path is the primary experience** and its layout uses the prescribed 560 px centred column, 52 px title strip, 26/17/16/14 type scale, 44 px primary button, progress status and one primary action. The **v0.2 expert screens remain accessible via Details**. Content is based on the supplied DESIGN-BRIEF and DESIGN-V03 with representative sample states, not a substitute for the complete v0.2 QA fixture. User permissions and real administrator password entry stay native to macOS; no password dialog is mocked as a Talos-owned input.

## Production notes and review gates

1. Wire the design to the actual Tauri application and its signed, testable native flows; UI demo buttons do **not** perform fixes, scans or purchases.
2. Run accessibility and contrast tests on every status and state in both modes. Verify reduced motion, keyboard focus and VoiceOver. Verify guided buttons fit at 900×600.
3. Implement the full error-state inventory and every rule from `DESIGN-V02.md` and `RULES.md`; these files were referenced but not attached here. The screens included here are representative, **not** a complete state-by-state Figma component library.
4. Source marketing claims carefully: licence terms, business seats, support contact, update window and pricing are unresolved. Templates intentionally use placeholders.
5. Check final macOS Icon Composer guidelines and export a compiled `.icon` using Apple's tooling. Provided layers and PNGs are an authoring starting point.
6. The brand spiral is a custom visual direction, not a security certification or a promise of invulnerability.

## Motion spec (no flashing)

| Event | Regular | Reduced motion |
|---|---|---|
| Guided screen change | Subtle 200ms crossfade; no transform | Immediate |
| Scan reveal | Sequential information, minimum 6 seconds | Same sequence, minimum 4.5 seconds |
| Score value/ring | 900ms measured fill | Instant final value |
| Fix success | 240ms tick drawing, hold 1400ms | Static tick, hold 1800ms |
| Sheet in/out (expert) | 200ms opacity, within window | Immediate |
| Optional AI text | Incremental field-by-field, Stop control | No typewriter decoration; legible updates |

No ambient looping motion, shine, glow, sweeping radar beams or aggressive animations.

## Brand boundaries

- Keep the exact product function: a local macOS security check, plain-language explanations, guided fixes that ask first.
- Do not drift into unrelated “data wallet”, consumer tracking or cloud AI promises.
- Do not copy the Emerge visual identity or the archival spiral image. This is an original reinterpretation of abstract concentric line work.
- Preserve English product copy and confirmed product capabilities. Use British English in implementation.

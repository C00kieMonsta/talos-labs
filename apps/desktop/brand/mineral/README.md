# Mineral brand assets

Copied from `Talos-Labs-Mineral-Design-Kit-v1/` (supplied by the owner, 2026-10-16). The app reads only from this folder; nothing imports from the kit at runtime.

- `icons/`: the 33 kit line icons, 24 x 24, 1.5 px stroke, `currentColor`. `scripts/gen-icons.ts` turns them into `src/components/icons/*.tsx`.
- `logos/`: spiral marks (light, dark, rust) and wordmarks. `scripts/gen-icons.ts` also emits `SpiralMark.tsx` from `spiral-mark-dark.svg`.
- `app-icon/`: `icon-1024.png` feeds `pnpm tauri icon`; `Talos-Labs.icns` overwrites the generated `src-tauri/icons/icon.icns`.
- `installer/`: the DMG background, copied to `src-tauri/assets/dmg-background.png`.

Regenerate icons with `pnpm exec tsx scripts/gen-icons.ts` from `apps/desktop`.

Warmth pass (docs/DESIGN-WARMTH.md):

- `grain/grain-overlay.png`: the kit's 512 px grey noise tile (values 30 to 230, alpha 5 to 12 of 255). `tokens.css` points `--grain-url` at it; `base.css` paints it over the canvas gradient. `grain/mineral-grain.png` (1000 x 700, opaque sandy texture) is carried for completeness and is not referenced by any stylesheet.
- `hero/horizon.svg`: the site hero's horizon, two quadratic dunes in a 1400 x 170 box. `src/components/Hero.tsx` carries the same two paths inline with token fills; this file is the editable source.

# Mineral brand assets

Copied from `Talos-Labs-Mineral-Design-Kit-v1/` (supplied by the owner, 2026-10-16). The app reads only from this folder; nothing imports from the kit at runtime.

- `icons/`: the 33 kit line icons, 24 x 24, 1.5 px stroke, `currentColor`. `scripts/gen-icons.ts` turns them into `src/components/icons/*.tsx`.
- `logos/`: spiral marks (light, dark, rust) and wordmarks. `scripts/gen-icons.ts` also emits `SpiralMark.tsx` from `spiral-mark-dark.svg`.
- `app-icon/`: `icon-1024.png` feeds `pnpm tauri icon`; `Talos-Labs.icns` overwrites the generated `src-tauri/icons/icon.icns`.
- `installer/`: the DMG background, copied to `src-tauri/assets/dmg-background.png`.

Regenerate icons with `pnpm exec tsx scripts/gen-icons.ts` from `apps/desktop`.

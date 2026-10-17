# Talos Labs playful interactions: motion and delight within Mineral

The app today moves in six places: a 200 ms crossfade between guided steps (`apps/desktop/src/styles/guided.css:71-83`) and between expert screens (`styles/screens.css:35-44`), the progress bar's width (`guided.css:114`), the 240 ms drawn tick on a done step (`guided.css:194-208`), the score ring's 900 ms fill (`src/components/ScoreMeter.tsx:11-48`), the sheet fade (`styles/components.css:460-530`), the spinner, the skeleton shimmer and the model caret (`components.css:560-565`, `614-631`, `1463-1482`). Everything else is still. DESIGN-WARMTH section 9b says so on purpose: "Nothing in this pass animates." The owner now asks for playful interactions. This document is the motion and delight system for a calm product used by adults with no computer skills: a small vocabulary, fourteen moments, and the rule that makes them safe to ship, which is that every moment looks right frozen.

This document extends `docs/DESIGN-MINERAL.md` (section 5, the motion table), `docs/DESIGN-WARMTH.md` (sections 4, 5, 6 and 9b), `docs/DESIGN-V03.md` (the paced scan and the done hold), `docs/DESIGN-CHAT.md` (section 3, the streaming turn), `docs/DESIGN-WATCH-WINDOW.md` (section 2, the calm row) and `docs/DESIGN-AI-PRESENCE.md` (moment 1, the plan reading). Everything in `docs/SECURITY-MODEL.md` holds untouched: nothing here sends, stores or reads anything new, no model call is added, no notification is added, no Rust command is added, no model text becomes a control, and the app is complete with AI off. The build is CSS in `apps/desktop/src/styles/`, one small TypeScript module, a handful of component props, two authored string blocks under the banned-word test in `apps/desktop/src/guided/copy.test.ts`, and a motion smoke test in `apps/desktop/qa/`. British English throughout. Facts about the tree were checked on 2026-10-17 against the files named; line numbers in `components.css` and `guided.css` may move with other work.

The owner's words, verbatim (2026-10-17): "Keep iterating on the talos UI -- the chat is bad, we need a better chat interface that you would have on a real modern agent driven app -- we need more playful interactions -- we need more of the threat detection strategies in place -- adding more agentic capabilities -- add threat detection strategies and interpretation of daily checks". Earlier: "Use more of the gradient with the noisy colors in general, as it is shown on the moodboard." and "not easy to see what to click, there is no sense of urgency." This file answers "more playful interactions"; the chat, the detection strategies and the daily interpretation have their own documents, and this file names where its moments land in them.

Decisions taken where the brief left room:

- **Every motion is bound to an event. Nothing moves while the app waits.** DESIGN-MINERAL section 5 forbids "ambient looping motion". That rule stands, with one named exception: the spiral band breathes while a model request runs (`explain.kind === "running"`, `apps/desktop/src/scan/machine.ts:33-44`) and stops within one cycle of `ready` or `failed`. A request has a Stop control, so the motion is pausable (WCAG 2.2.2). An idle screen never moves.
- **Opacity and transform only.** No animated colour as the only cue, no animated layout (height, width, margin) except the two progress fills that exist. A moment that is cut to 0 ms by the reduced-motion rule (`styles/base.css:201-207`) must leave the screen in its final state with nothing missing, so every keyframe ends on the resting values and every count-up writes the final number to the accessibility tree at once.
- **Three new duration tokens, no new easing.** `--motion-settle` 600 ms, `--motion-fill` 900 ms and `--motion-breathe` 3000 ms join `--motion-fast`, `--motion-base` and `--motion-slow` in `styles/tokens.css:41-45` and are zeroed by the same `prefers-reduced-motion` block (`tokens.css:161-166`). `--ease-out` and `--ease-standard` are enough.
- **Count-ups go up. Never down.** The ring fills from 0 every mount (as `useAnimatedValue` does today, `ScoreMeter.tsx:24-48`), so a lower score than last time is never shown as a fall. "3 things fixed today" counts 0 to 3. Nothing counts down, nothing is a countdown.
- **Press scale, no hover lift.** Mineral has no shadows except the sheet (DESIGN-MINERAL section 5), and a card that rises one pixel with no shadow reads as a jitter. Primaries and rows get a 150 ms `scale(0.98)` on press and the hover fill they have today (`components.css:23-29`, `guided.css:547-553`). The "Do this next" card is not a control (DESIGN-WARMTH 6b) and does not react to the pointer at all.
- **The spiral breathes by fading, never by brightening.** DESIGN-WARMTH 4a measured `--hero-spiral-opacity` 0.10 as the limit for `--fg-secondary` over a line (0.12 fails at 4.45:1). The breath runs from the token down to half of it and back, so the contrast table's worst case is unchanged and `scripts/contrast.ts` needs no new row.
- **The calm streak is a number in a sentence, drawn only when it is two or more.** "Day 12 of nothing changed." No flame, no badge, no "streak lost", no notification. On a change day the sentence is simply the change sentence; the count restarts in silence. Day one reads "No change since yesterday." and under a day the existing lines stand. The watch window keeps DESIGN-WATCH-WINDOW's "No change in 3 days." form (open question 3).
- **The weather pair is three authored words plus one clause from counts.** "Calm", "Worth a look", "Act now", each with the glyph the watch window already uses for that rating (`src/watch/WatchWindow.tsx:33-36`: kit `check-up`, kit `info`, lucide `OctagonAlert`). The clause is built from counts and headlines the app owns. Never "safe", "protected", "secure", "clean", "fine". The model's paragraph, when the daily-check design provides one, sits under the pair with its full badge and never above it.
- **Copy smiles by being short, not by joking.** No exclamation marks, no emoji, no "oops", no play on the risk. "Done.", "That's all for today.", "A quiet week." Every new string goes under the banned-word list and the 1.6 syllable ceiling in `copy.test.ts:7-18`.
- **The scanning screen keeps its bar and dots; no second ring.** The pattern brief offered a ring that fills `revealed / 17`. The guided scan already has a 3 px bar (`src/screens/Scanning.tsx`, `guided && bar`) and 17 dots; two progress readings of one process is noise. The dots get the moment instead (section 3.2). Open question 2.
- **The harness stays frozen; motion gets its own smoke test.** `UNROLL_CSS` (`apps/desktop/qa/harness.ts:593`) already sets `transition: none; animation: none` for every shot, and the new `motionOff()` rule makes JavaScript count-ups jump under `pace=0`, so every existing shot stays byte-stable. A separate `qa/motion.ts` measures each moment at `pace=1` and again under `reducedMotion: "reduce"`.
- **No sound, ever, and no badge on the tray icon.** macOS tints the template rasters (DESIGN-MINERAL section 4) and the three rasters are the whole tray vocabulary. No bounce on a security state: the act-now word appears with the same 200 ms crossfade as the calm word.

## 1. Principles

- **Still by default.** A screen that has finished arriving does not move. Motion marks an arrival, a completion, a press, or a request in flight, and then stops.
- **Short.** Hover and press 150 ms; arrivals 200 to 250 ms; settles 600 ms; the one long fill 900 ms. Nothing a person could wait for.
- **Honest.** The dot ticks when the area is read, the disc draws when the fix passed, the number counts to the number that is true. No motion stands in for progress the app does not have (DESIGN-CHAT: "never a fake progress bar").
- **Frozen is complete.** Under Reduce Motion, at demo `pace=0`, and in every screenshot, the final frame is the whole design. No moment carries information its last frame does not.
- **Warm, not loud.** Fades and small scales on the kit's own marks and colours. No confetti, no particles, no bounce, no shake, no sound, no count-downs, no flames, no "level up", no colour alone (every state keeps its word and icon, DESIGN-MINERAL section 5).
- **One thing moves at a time.** A screen's arrival may stagger two or three elements by 100 ms; two independent animations never run on one screen at once, except the caret, which is a 1 px line.
- **The security surfaces are the calmest.** The act-now word, the fishy screens and the password lines get the plain crossfade and nothing else. Delight belongs to the done disc, the ring, the welcome and the calm days.

## 2. Vocabulary

### Tokens (`apps/desktop/src/styles/tokens.css`, appended to the `:root` block at line 41 and the reduced-motion block at line 161)

| Token | Value | Reduced motion | Used by |
|---|---|---|---|
| `--motion-fast` | 150 ms (exists) | 0 ms | hover, press scale, dot settle, disc scale |
| `--motion-base` | 200 ms (exists) | 0 ms | crossfades, counter fade, status word swap |
| `--motion-slow` | 250 ms (exists) | 0 ms | horizon rise, cue bar draw |
| `--motion-settle` | 600 ms (new) | 0 ms | count-ups after the first, the grade word |
| `--motion-fill` | 900 ms (new) | 0 ms | the first ring fill, the welcome drift |
| `--motion-breathe` | 3000 ms (new) | 0 ms | the spiral while a request runs |
| `--press-scale` | 0.98 (new) | 1 | `:active` on primaries and rows |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` (exists) | same | arrivals, settles |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` (exists) | same | hover, crossfades |

Distances: a drift is 12 px, a rise is 24 px, a press is 2 % (`scale(0.98)`), a pop is 8 % (`scale(1.08)` back to 1), a disc arrives from `scale(0.92)`. Nothing travels further than 24 px.

### The module (`apps/desktop/src/app/motion.ts`, new)

- `MOTION = { fast: 150, base: 200, slow: 250, settle: 600, fill: 900, breathe: 3000 } as const`; `motion.test.ts` reads `tokens.css` and asserts each value equals the token, the way `scripts/contrast.ts` reads the file.
- `motionOff(): boolean`: true when `matchMedia("(prefers-reduced-motion: reduce)").matches` or `window.__talosDemoPace === 0` (`src/app/demo-boot.ts:231`). `reducedMotion()` in `ScoreMeter.tsx:18-22` moves here and gains the pace clause.
- `useEased(target: number, firstMs = MOTION.fill, laterMs = MOTION.settle): number`: `useAnimatedValue` from `ScoreMeter.tsx:24-48` moved and renamed, jumping to `target` when `motionOff()`. Used by the ring and by `CountUp`.
- `<CountUp value={n} />` (`src/components/CountUp.tsx`, new): renders `<span aria-hidden="true">{Math.round(shown)}</span><span className="visually-hidden">{n}</span>`, so assistive tech reads the final number once and never the frames. Replaces the figure in "3 things fixed today." (section 3.3).

### The reduced-motion rule, per moment

Three layers, all already in the tree: `tokens.css:161-166` zeroes the duration tokens; `base.css:201-207` forces every animation and transition to 0.001 ms; `guided.css:830-834` and `components.css:1480-1484` set `animation: none` where a 0.001 ms run would still paint a wrong first frame (an SVG dash). Every new keyframe below is listed in one of the two `animation: none` blocks or ends on its resting values, and every JavaScript motion checks `motionOff()`. Sections 3.x each state what a person with Reduce Motion on sees.

### Never

Confetti or particles; bounce, shake, wobble or spring easings; sound; a badge, dot or animation on the tray icon; a count-down; a flame, a streak badge or a trophy; motion as the only cue for a state; a transform on a security word (act now, the fishy headlines) beyond the crossfade; an animation that outlives its event; a typewriter effect (text streams in whole fields, DESIGN-MINERAL section 5); motion on the password sentence or while macOS's dialog is up; emoji or exclamation marks in copy; animated model text beyond the caret.

## 3. The moments

Each moment: where it lives, what the person sees, the CSS or code, the component that changes, the reduced-motion result, and the smoke-test name (section 6). Keyframes go in the file that owns the class: `guided.css` for guided classes, `components.css` for shared ones, `base.css` for the hero bands, `watch.css` for the window, `chat.css` (DESIGN-CHAT, not built) for the chat.

### 3.1 Welcome: the spiral drifts in

Where: `GuidedWelcome` (`src/guided/GuidedWelcome.tsx:13`, `useGuidedHero(true, false)`) and every other screen that mounts `<Hero kind="spiral" />` through `GuidedShell` (`src/guided/GuidedShell.tsx:54`). The band is mounted when a screen asks for it and unmounted when the screen leaves, so the drift runs once per arrival on a spiral screen and never between two steps.

What the person sees: the big spiral top right fades in from nothing and slides 12 px down-left into place over 900 ms, settling as the headline lands. The headline, body and primary are already there (the step crossfade is 200 ms). On a later launch it is the same, quieter because it is familiar.

```css
/* base.css, after .hero-spiral (line 272) */
.guided-content > .hero-spiral { animation: hero-drift var(--motion-fill) var(--ease-out) both; }
@keyframes hero-drift {
  from { opacity: 0; transform: translate(12px, -12px); }
  to { opacity: var(--hero-spiral-opacity); transform: none; }
}
```

Reduced motion: `animation: none` added to the `guided.css:830` block for `.hero-spiral`; the band is at its token opacity from the first frame. Smoke: `motion-welcome-drift`.

### 3.2 The paced scan: dots that tick

Where: `Scanning` in guided mode (`src/screens/Scanning.tsx`, the `scan-dot` branch), driven by `useScanPacer` (`src/scan/useScanPacer.ts:19-29`, 270 ms per row, 6 s floor, 200 ms rows and 4.5 s under reduced motion). The pacer's schedule is unchanged.

What the person sees: as each area is read, its 7 px dot fills (green passed, rust active, the critical colour for found, dashed for could-not-check, `guided.css:715-744`) and pops once, 8 % larger and back, over 150 ms. The "1 thing to fix so far" counter, which already remounts per change (`Scanning.tsx`, `key={pacer.found.attention}`), fades in over 200 ms instead of snapping.

```css
/* guided.css, after .scan-dot-unavailable (line 742) */
.scanning-guided .scan-dot-passed, .scanning-guided .scan-dot-found,
.scanning-guided .scan-dot-review, .scanning-guided .scan-dot-unavailable {
  animation: dot-settle var(--motion-fast) var(--ease-out);
}
@keyframes dot-settle { from { transform: scale(1.08); } to { transform: none; } }
.scanning-guided .counter-number { animation: fade-in var(--motion-base) var(--ease-standard); }
```

The active (checking) dot does not pulse: a pulse would run as long as a slow collector, which is the ambient motion the principles forbid. `fade-in` is the sheet's keyframe (`components.css:525`), reused. Reduced motion: both animations at 0.001 ms, end states identical. Smoke: `motion-scan-dot`.

### 3.3 The score ring, the count-up and the grade word

Where: `ScoreMeter` (`src/components/ScoreMeter.tsx`) on the expert Overview, and the "N things fixed today." line on the end screen (`src/guided/EndScreen.tsx`, `things(fixed.length)`).

What the person sees: the ring fills from 12 o'clock over 900 ms with the gradient arc (DESIGN-WARMTH 3) while the figure counts 0 to 72; the grade word ("Fair") under the figure fades in as the fill ends, so the word arrives when the number is true. On the end screen "3 things fixed today." counts 0 to 3 over 600 ms.

Code: `ScoreMeterRing` calls `useEased(clamped)` from `motion.ts` (the hook is moved, not changed; `FIRST_MS` and `LATER_MS` are re-exported from `MOTION.fill` and `MOTION.settle` so `ScoreMeter.test.ts` keeps its imports). `aria-valuenow` and `aria-valuetext` keep the final value from the first frame (`ScoreMeter.tsx:71-78` already does this), and the centre is `aria-hidden`. The end screen's body becomes `<p><CountUp value={fixed.length} /> {fixed.length === 1 ? "thing" : "things"} fixed today.</p>` with the string moved to `END.fixedToday` ("{n} fixed today." is the template; the noun is chosen in code).

```css
/* screens.css, after .score-meter-grade (line 200) */
.score-meter-grade { animation: fade-in var(--motion-base) var(--ease-standard) both; animation-delay: var(--motion-fill); }
```

Reduced motion: `useEased` returns the target at once, the word's delay is 0 ms, the ring is full on the first paint (as today). Smoke: `motion-ring-fill`, `motion-fixed-count`.

### 3.4 The done disc: a pop and a drawn tick

Where: `StepFrame` with `done` or `mark` (`src/guided/StepFrame.tsx:95-100`): the fix done screen, the batch done screen, the show-me-where passed screen, the end screen's partial and all-done states.

What the person sees: the 56 px gradient disc arrives from 92 % and no opacity to full over 150 ms, then the tick draws over 240 ms (the existing `guided-tick`, `guided.css:194-208`), all inside the 1400 ms hold before auto-advance (`src/guided/timing.ts:3-4`). Total 390 ms; the headline is already in place because the step crossfade finished first.

```css
/* guided.css, replacing the .guided-tick animation line (198) */
.guided-status-disc { animation: disc-in var(--motion-fast) var(--ease-out) both; }
@keyframes disc-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
.guided-tick { animation: guided-tick 240ms var(--ease-out) both; animation-delay: var(--motion-fast); }
```

`.guided-status-mark` keeps `position: relative` so the disc scales about its centre; add `transform-origin: center` on `.guided-status-disc`. Reduced motion: `.guided-status-disc` joins `.guided-tick` in the `animation: none` block at `guided.css:830`; the hold is 1800 ms as today. Smoke: `motion-done-disc`.

### 3.5 The "Do this next" cue bar

Where: `NextCard` and `ActNowCard` (`EndScreen.tsx:69-100`), the 3 px bar drawn by `.guided-next-card::before` (`guided.css:585-602`).

What the person sees: 200 ms after the end screen lands, the bar draws from the top down over 250 ms. It is the one thing on the screen that moves after the crossfade, which is what points the eye at the card.

```css
/* guided.css, after .guided-next-card::before (line 585) */
.guided-next-card::before { transform-origin: top; animation: cue-draw var(--motion-slow) var(--ease-out) both; animation-delay: var(--motion-base); }
@keyframes cue-draw { from { transform: scaleY(0); } to { transform: none; } }
```

The card itself does not move and has no hover state (it is not a control). Reduced motion: 0.001 ms, bar present from the first frame. Smoke: `motion-cue-bar`.

### 3.6 Press scale on primaries and rows

Where: `.button-primary` (`components.css:38-54`), `.guided-primary` (`guided.css`), `.guided-end-row` (`guided.css:524-558`), `.finding-row` (`components.css:840-856`), `.watch-primary` and `.watch-link` (`watch.css`), and DESIGN-CHAT's `button.chat-chip` and card primaries.

What the person sees: the button shrinks 2 % while the mouse is down and springs back on release, 150 ms each way, in addition to the hover fill it has. Hover is unchanged: fill to `--bg-inset` on rows, the deeper gradient on primaries. No lift anywhere (decision above).

```css
/* components.css, in the .button transition list (line 19) add: transform var(--motion-fast) var(--ease-standard); */
.button-primary:active:not(:disabled):not([aria-disabled="true"]) { transform: scale(var(--press-scale)); }
/* guided.css, next to .guided-end-row:active (line 551) */
.guided-end-row:active { transform: scale(var(--press-scale)); }
.guided-end-row { transition: background var(--motion-fast) var(--ease-standard), transform var(--motion-fast) var(--ease-standard); }
```

`.finding-row` scales its `::before` fill only, not the text, so the row's text does not blur: `.finding-row:active::before { transform: scale(var(--press-scale)); }`. Reduced motion: `--press-scale` is 1 and the transition is 0 ms; only the fill changes. Smoke: `motion-press`.

### 3.7 The end screen's horizon rises

Where: `<Hero kind="horizon" />` mounted by `GuidedShell` when `EndScreen` asks (`EndScreen.tsx`, `useGuidedHero(true, true)`); `.hero-horizon` at `base.css:299-310`.

What the person sees: as the end screen crossfades in, the dunes at the foot rise 24 px into place over 250 ms. One rise per arrival on the end screen, nothing after.

```css
/* base.css, after .hero-horizon (line 299) */
.guided-content > .hero-horizon { animation: horizon-rise var(--motion-slow) var(--ease-out) both; }
@keyframes horizon-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
```

Reduced motion: 0.001 ms. Smoke: `motion-horizon`.

### 3.8 The chat's caret and the breathing spiral

Where: every surface that streams model text: `ModelText caret` (`src/components/ModelText.tsx`) in the Explain disclosure (`src/guided/ExplainPanel.tsx:189`), the AI card, the Ask screen today (`src/screens/Ask.tsx`) and the chat's model turn when DESIGN-CHAT is built. The spiral band is wherever `GuidedShell` mounts it; the chat home asks `useGuidedHero(true, false)` so the mark is present on the screen where streaming happens most.

What the person sees: the 1 px caret blinks at 1 Hz at the end of the growing text (as built, `components.css:1463-1482`, text arriving in whole fields, never a typewriter). While the request runs, the big spiral top right breathes: it fades from its token opacity to half and back every 3 s, with `ease-in-out`. The moment the text is complete, or Stop is pressed, or the request fails, the breath stops at the token opacity within one transition.

```css
/* base.css, after hero-drift */
.hero-spiral[data-breathing="true"] { animation: spiral-breathe var(--motion-breathe) ease-in-out infinite; }
@keyframes spiral-breathe { 50% { opacity: calc(var(--hero-spiral-opacity) * 0.5); } }
```

Code: `GuidedShell` reads `scan.explain.kind === "running"` from `useApp()` (the one explain slot, `src/scan/useScan.ts:310`) and passes `breathing` to `Hero`, which sets `data-breathing`. The chat's `useChat` busy flag (DESIGN-CHAT section 7) feeds the same prop when the chat exists; the watch window never breathes (it has no band). Because the drift of 3.1 and the breath both animate `opacity` on the same element, the breath class must not be set until the drift has ended; `GuidedShell` delays the prop by `MOTION.fill` after the band mounts, or at once under `motionOff()`. Reduced motion: `animation: none` for `.hero-spiral[data-breathing]` in the `guided.css:830` block; the caret is already `none` (`components.css:1480-1484`); the status line "Writing" (`ExplainPanel.tsx`, `AiCard.tsx:162-164`) carries the state in words. Smoke: `motion-breathe`, `motion-caret`.

### 3.9 The watch window: a state change

Where: `WatchWindow` (`src/watch/WatchWindow.tsx:30-40`, `StatusLine`), `watch.css`.

What the person sees: when the rating changes while the window is open (a "Check now" that finds something, or an acknowledgement that clears it), the icon and word crossfade over 200 ms. The row does not slide, grow or flash; "Act now" arrives exactly as quietly as "Nothing changed". The height change is the window's own (`tray::window_height`, Rust) and is not animated.

Code: `StatusLine` takes `key={state.rating}` so React remounts the row on a rating change, and `.watch-status { animation: fade-in var(--motion-base) var(--ease-standard); }` in `watch.css` after line 23. The "Checking now" spinner stays static (DESIGN-WATCH-WINDOW section 2, row 2). The tray raster swaps with no animation (macOS owns the item). Reduced motion: 0.001 ms. Smoke: `motion-watch-status`.

### 3.10 Calm days

Where: the daily reading card (3.11) in the main window; the watch window keeps its own calm line (DESIGN-WATCH-WINDOW section 2, row 3).

What the person sees: under the weather pair, on a calm day two or more days after the last change: "Day 12 of nothing changed." At seven days and more the line gains a second sentence, "A quiet week."; at thirty, "A quiet month." On day one: "No change since yesterday." Under a day: nothing (the pair's clause already says "Nothing changed."). On a change day the line is absent and the clause names the change. No motion of its own beyond the card's arrival; the number is plain text, never a count-up, because a streak that counts up is a scoreboard.

Code: `calmDays(lastChangeAt: string | null, now: Date): number | null` in `src/watch/relative-time.ts`, whole days by local midnight (not 24 h blocks, so "Day 2" is true the morning after the first calm day), `null` when `lastChangeAt` is null. Input is `WatchState.lastChangeAt`, which DESIGN-WATCH-WINDOW section 5 adds to `WatchState`; until that lands the line is not drawn. Strings in `copy.ts` under `READING` (section 4). Never a notification, never on the tray tooltip.

### 3.11 The daily reading: a weather-style pair

Where: the opening of the chat (DESIGN-CHAT section 3, "The opening message") when built; the plan screen (`src/guided/screens/PlanScreen.tsx`) under the body until then; the content lines of the card (what changed, what held, the trend) are the daily-check interpretation design's and are not specified here. This file owns the pair, its glyph and its motion.

> ◎ **Calm.** Nothing changed since yesterday.
> Day 12 of nothing changed. A quiet week.

> ⓘ **Worth a look.** One thing to look at.

> ⛔ **Act now.** A new program started running on its own.

Code: `readingFor(watch: WatchState | null, diff: ReportDiff | null): Reading` in `src/guided/reading.ts` (new), returning `{ rating: "calm" | "look" | "act", word, clause, glyph }`. `word` is `READING.word[rating]`; `clause` is `READING.clause.calm` ("Nothing changed since yesterday.") or `READING.clause.calmFirst` ("Nothing changed.") on the first day, `WATCH.lookOne` or `WATCH.lookMany` with the item count, or `FISHY.noticed.headline[kind]` plus a full stop for act (`copy.ts`, the same strings the window uses). `glyph` is `ICONS.checkup`, `ICONS.info` or `SEVERITY_ICONS.critical` (`src/app/icons.ts`). With no watch (unlicensed, off, or no state yet) the pair is built from the plan alone: "Calm" when `nextAction` is null, "Worth a look" otherwise, never "Act now" (only the watch may say it). The model's paragraph (the `checkup` summary of DESIGN-AI-PRESENCE moment 1, or the judge's `ratingReason` once DESIGN-WATCH-WINDOW lands) sits under the authored lines in `div.guided-model` with its badge, exactly as moment 1 draws it, and is never the pair.

Motion: the glyph and word fade in over 200 ms as the card lands; the clause and the calm-days line follow 100 ms later (`animation-delay: 100ms`). Under reduced motion, all at once. Rendering: `p.guided-reading` with the 20 px icon through `Icon`, the word at `--text-guided-list` 600, the clause at `--text-guided-list` 400 on the same line, the calm-days line at `--text-guided-meta` in `--fg-secondary`. The act word is in `--sev-critical-fg` with the octagon, as in the window (`watch.css:31-33`). Smoke: `motion-reading`.

### 3.12 The first-run hello

Where: the very first launch, `settings.onboarded === false` on the guided home (`src/App.tsx`, `launchScan` reads `onboarded`), the Welcome screen of 3.1.

What the person sees: the spiral drifts in (3.1), then the headline "Let's check your Mac." fades in at 200 ms, the body at 300 ms, "Start" at 400 ms, each over 200 ms. The whole hello is under a second and ends with the one primary in place. Later launches skip the stagger: everything arrives with the step crossfade.

Code: `GuidedWelcome` passes `className="guided-welcome guided-welcome-first"` when `!settings.onboarded`; `guided.css` gives `.guided-welcome-first .guided-title`, `.guided-body` and `.guided-actions` the `fade-in` keyframe at `--motion-base` with `animation-fill-mode: both` and delays of 200, 300 and 400 ms. No new string: `WELCOME.title` already says hello the way this product does. Reduced motion: no delays, no fades. Smoke: `motion-hello`.

### 3.13 Copy that smiles

New strings, all in `apps/desktop/src/guided/copy.ts`, walked by `copy.test.ts`:

- `READING.word`: `calm: "Calm"`, `look: "Worth a look"`, `act: "Act now"`.
- `READING.clause`: `calmFirst: "Nothing changed."`, `calm: "Nothing changed since yesterday."`.
- `READING.calmDay`: `"Day {n} of nothing changed."`; `READING.calmOne`: `"No change since yesterday."`; `READING.quietWeek`: `"A quiet week."`; `READING.quietMonth`: `"A quiet month."`.
- `END.fixedToday`: `"{n} fixed today."` (the noun is added in code, section 3.3); `END.allDoneLine`: `"That's all for today."`, the second sentence under `END.allDone` on the all-done end screen, replacing the calm line there.
- `MOMENTS.sorted`: `"Done. That one's sorted."`, the done line of a single fix when the rule's own `guided.done` line is absent (today `DONE_PREFIX` plus the headline, `copy.ts`, `DONE_PREFIX`; the headline form stays wherever the catalogue gives one).

Rules: full stops, no exclamation marks, no emoji, no joke about the risk, no "oops", no "yay", no praise of the person ("well done" is out: the app did the work). Every string under the banned list and the 1.6 counter; `READING.word.look` is three one-syllable words.

### 3.14 Model text

Unchanged: streamed in whole fields through `ModelText` with the caret, the badge under it, text nodes only (`SECURITY-MODEL.md`, "Rendering"). No fade per field, no highlight on arrival, no motion on the badge. The breathing spiral (3.8) is the whole of the AI's presence in motion.

# Talos Labs playful interactions: motion and delight within Mineral

The app today moves in six places: a 200 ms crossfade between guided steps (`apps/desktop/src/styles/guided.css:71-83`) and between expert screens (`styles/screens.css:35-44`), the progress bar's width (`guided.css:114`), the 240 ms drawn tick on a done step (`guided.css:194-208`), the score ring's 900 ms fill (`src/components/ScoreMeter.tsx:11-48`), the sheet fade (`styles/components.css:460-530`), the spinner, the skeleton shimmer and the model caret (`components.css:560-565`, `614-631`, `1463-1482`). Everything else is still. DESIGN-WARMTH section 9b says so on purpose: "Nothing in this pass animates." The owner now asks for playful interactions. This document is the motion and delight system for a calm product used by adults with no computer skills: a small vocabulary, thirteen moments, and the rule that makes them safe to ship, which is that every moment looks right frozen.

This document extends `docs/DESIGN-MINERAL.md` (section 5, the motion table), `docs/DESIGN-WARMTH.md` (sections 4, 5, 6 and 9b), `docs/DESIGN-V03.md` (the paced scan and the done hold), `docs/DESIGN-CHAT.md` (section 3, the streaming turn), `docs/DESIGN-WATCH-WINDOW.md` (section 2, the calm row) and `docs/DESIGN-DAILY.md` (section 3, the reading card, whose motion it owns). Everything in `docs/SECURITY-MODEL.md` holds untouched: nothing here sends, stores or reads anything new, no model call is added, no notification is added, no Rust command is added, no model text becomes a control, and the app is complete with AI off. The build is CSS in `apps/desktop/src/styles/`, one small TypeScript module, a handful of component props, one authored string under the banned-word test in `apps/desktop/src/guided/copy.test.ts`, and a motion smoke test in `apps/desktop/qa/`. British English throughout. Facts about the tree were checked on 2026-10-17 against the files named; line numbers in `components.css` and `guided.css` may move with other work.

The owner's words, verbatim (2026-10-17): "Keep iterating on the talos UI -- the chat is bad, we need a better chat interface that you would have on a real modern agent driven app -- we need more playful interactions -- we need more of the threat detection strategies in place -- adding more agentic capabilities -- add threat detection strategies and interpretation of daily checks". Earlier: "Use more of the gradient with the noisy colors in general, as it is shown on the moodboard." and "not easy to see what to click, there is no sense of urgency." This file answers "more playful interactions"; the chat (`docs/DESIGN-CHAT-UI.md`), the agentic capabilities (`docs/DESIGN-AGENT.md`), the detection strategies (`docs/DESIGN-THREATS-V2.md`) and the daily interpretation (`docs/DESIGN-DAILY.md`) have their own documents, and this file names where its moments land in them.

Decisions taken where the brief left room:

- **Every motion is bound to an event. Nothing moves while the app waits.** DESIGN-MINERAL section 5 forbids "ambient looping motion". That rule stands, with one named exception: the spiral band breathes while a model request runs (`explain.kind === "running"`, `apps/desktop/src/scan/machine.ts:33-44`) and stops at once on `ready` or `failed`. A request has a Stop control, so the motion is pausable (WCAG 2.2.2). An idle screen never moves.
- **"Interactions" here means two things: the app's replies to the person's taps, and its arrivals.** The replies are the press scale (3.6), the tap on the ring (3.11), the done disc after a fix (3.4), the chip echoing as the person's bubble and the card landing under it (`docs/DESIGN-CHAT-UI.md` section 2), and the Overview card's "Your week" link (`docs/DESIGN-DAILY.md` section 3). The arrivals are the rest. This file adds one reply of its own (the ring) and names the others so the owner can see the interaction half in one place.
- **Opacity and transform only.** No animated colour as the only cue, no animated layout (height, width, margin) except the two progress fills that exist. A moment that is cut to 0 ms by the reduced-motion rule (`styles/base.css:201-207`) must leave the screen in its final state with nothing missing, so every keyframe ends on the resting values and every count-up writes the final number to the accessibility tree at once.
- **Three new duration tokens, no new easing.** `--motion-settle` 600 ms, `--motion-fill` 900 ms and `--motion-breathe` 3000 ms join `--motion-fast`, `--motion-base` and `--motion-slow` in `styles/tokens.css:41-45` and are zeroed by the same `prefers-reduced-motion` block (`tokens.css:161-166`). `--ease-out` and `--ease-standard` are enough.
- **Count-ups go up, never down, and only from ten.** The ring fills from 0 every mount (as `useAnimatedValue` does today, `ScoreMeter.tsx:24-48`), so a lower score than last time is never shown as a fall. A figure under ten is drawn whole: "3 things fixed today." counting 0, 1, 2, 3 in 600 ms is three untrue sentences and a stutter, not delight. Nothing counts down, nothing is a countdown.
- **Press scale, no hover lift.** Mineral has no shadows except the sheet (DESIGN-MINERAL section 5), and a card that rises one pixel with no shadow reads as a jitter. Primaries and rows get a 150 ms `scale(0.98)` on press and the hover fill they have today (`components.css:23-29`, `guided.css:547-553`). The "Do this next" card is not a control (DESIGN-WARMTH 6b) and does not react to the pointer at all.
- **The spiral breathes by fading, never by brightening.** DESIGN-WARMTH 4a measured `--hero-spiral-opacity` 0.10 as the limit for `--fg-secondary` over a line (0.12 fails at 4.45:1). The breath runs from the token down to half of it and back, so the contrast table's worst case is unchanged and `apps/desktop/scripts/contrast.ts` needs no new row.
- **The daily reading is DESIGN-DAILY's; this file moves it and nothing more.** The words ("Calm.", "Worth a look.", "Act now.", "Couldn't check.", "Checked."), the clause, the streak clause "Day {n} of nothing changed." from `DayDocument.calmStreak` (read in core from the rows of `daily.json`, `docs/DESIGN-DAILY.md` sections 2, 3 and 6), the `DailyReading` type, `packages/core/src/daily/reading.ts` and `DailyCard` are all DAILY's. This file adds no second word set, no second wording for the streak and no second day rule. No flame, no badge, no "streak lost", no notification: a streak that ends restarts in silence, which DAILY already says.
- **Copy smiles by being short, not by joking.** No exclamation marks, no emoji, no "oops", no play on the risk. "Done.", "That's all for today." Every new string goes under the banned-word list in `copy.test.ts:9` (`BANNED`), and every new sentence also under the 1.6 syllable counter at `copy.test.ts:19` (`syllablesPerWord`; the counter applies to sentences and headlines, not to the status words, as today).
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
- **The security surfaces are the calmest.** The act-now word, the fishy headlines and the password lines get the plain crossfade and nothing else. The one exception is the cue-bar draw of 3.5, which also runs on the end screen's `ActNowCard` and on the fishy noticed screen's card (`src/guided/FishyFlow.tsx`), because it points at the one primary and never touches the headline; that is the whole of motion on a security surface. Delight belongs to the done disc, the ring, the hello and the reading's arrival.

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

- `MOTION = { fast: 150, base: 200, slow: 250, settle: 600, fill: 900, breathe: 3000 } as const`; `motion.test.ts` reads `tokens.css` and asserts each value equals the token, the way `apps/desktop/scripts/contrast.ts` reads the file.
- `motionOff(): boolean`: true when `matchMedia("(prefers-reduced-motion: reduce)").matches` or `window.__talosDemoPace === 0` (`src/app/demo-boot.ts:231`). `reducedMotion()` in `ScoreMeter.tsx:18-22` moves here and gains the pace clause.
- `useEased(target: number, firstMs = MOTION.fill, laterMs = MOTION.settle): number`: `useAnimatedValue` from `ScoreMeter.tsx:24-48` moved and renamed, jumping to `target` when `motionOff()`. Used by the ring and by `CountUp`.
- `<CountUp value={n} />` (`src/components/CountUp.tsx`, new): renders `<span aria-hidden="true">{Math.round(shown)}</span><span className="visually-hidden">{n}</span>`, so assistive tech reads the final number once and never the frames. Counts only when `value >= 10`; below that `shown` is `value` from the first render. Replaces the figure in "N things fixed today." (section 3.3).

### The reduced-motion rule, per moment

Three layers, all already in the tree: `tokens.css:161-166` zeroes the duration tokens; `base.css:201-207` forces every animation and transition to 0.001 ms; `guided.css:830-834` and `components.css:1480-1484` set `animation: none` where a 0.001 ms run would still paint a wrong first frame (an SVG dash). Every new keyframe below is listed in one of the two `animation: none` blocks or ends on its resting values, and every JavaScript motion checks `motionOff()`. Sections 3.x each state what a person with Reduce Motion on sees.

### Never

Confetti or particles; bounce, shake, wobble or spring easings; sound; a badge, dot or animation on the tray icon; a count-down; a flame, a streak badge or a trophy; motion as the only cue for a state; a transform on a security word (act now, the fishy headlines) beyond the crossfade; an animation that outlives its event; a typewriter effect (text streams in whole fields, DESIGN-MINERAL section 5); motion on the password sentence or while macOS's dialog is up; emoji or exclamation marks in copy; animated model text beyond the caret.

## 3. The moments

Each moment: where it lives, what the person sees, the CSS or code, the component that changes, the reduced-motion result, and the smoke-test name (section 6). Keyframes go in the file that owns the class: `guided.css` for guided classes, `components.css` for shared ones, `base.css` for the hero bands, `watch.css` for the window, `chat.css` (DESIGN-CHAT, not built) for the chat.

### 3.1 The first-run hello: the spiral drifts in, the words follow

Where: `GuidedWelcome` (`src/guided/GuidedWelcome.tsx:13`, `useGuidedHero(true, false)`), the one Welcome a person ever sees: "Start" writes `onboarded: true` (`src/App.tsx:371-372`) and every later launch opens on the paced scan (`App.tsx:217`, DESIGN-V03 section 7 "Welcome once, then scanning on every mount"). The drift repeats wherever `GuidedShell` mounts the spiral band (`src/guided/GuidedShell.tsx:55`): today the end screen (`src/guided/EndScreen.tsx:142`), and the chat home when built. Nothing else mounts it; `ConnectScreen.tsx:59` and `FishyFlow.tsx:22` ask for the horizon only. The band is mounted when a screen asks for it and unmounted when the screen leaves, so the drift runs once per arrival on a spiral screen and never between two steps.

What the person sees, on the first launch: the big spiral top right fades in from nothing and slides 12 px down-left into place over 900 ms; the headline "Let's check your Mac." fades in at 200 ms, the body at 300 ms, "Start" at 400 ms, each over 200 ms. The whole hello is under a second and ends with the one primary in place. On the end screen only the drift runs; the text arrives with the step crossfade.

```css
/* base.css, after .hero-spiral (line 272) */
.guided-content > .hero-spiral { animation: hero-drift var(--motion-fill) var(--ease-out) both; }
@keyframes hero-drift {
  from { opacity: 0; transform: translate(12px, -12px); }
  to { opacity: var(--hero-spiral-opacity); transform: none; }
}
/* guided.css, after .guided-welcome */
.guided-welcome-first .guided-title, .guided-welcome-first .guided-body, .guided-welcome-first .guided-actions { animation: fade-in var(--motion-base) var(--ease-standard) both; }
.guided-welcome-first .guided-title { animation-delay: 200ms; }
.guided-welcome-first .guided-body { animation-delay: 300ms; }
.guided-welcome-first .guided-actions { animation-delay: 400ms; }
```

Code: `GuidedWelcome` passes `className="guided-welcome guided-welcome-first"` when `!settings.onboarded`. No new string: `WELCOME.title` already says hello the way this product does. Reduced motion: `animation: none` added to the `guided.css:830` block for `.hero-spiral`, so the band is at its token opacity from the first frame; the three delays are 0 ms and the fades 0.001 ms. Smoke: `motion-welcome-drift`, `motion-hello`.

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

What the person sees: the ring fills from 12 o'clock over 900 ms with the gradient arc (DESIGN-WARMTH 3) while the figure counts 0 to 72; the grade word ("Fair") under the figure fades in as the fill ends, so the word arrives when the number is true. On the end screen "12 things fixed today." counts 0 to 12 over 600 ms; "3 things fixed today." is drawn whole and fades in with the step crossfade (the decision above: `CountUp` counts only when `value >= 10`).

Code: `ScoreMeterRing` calls `useEased(clamped)` from `motion.ts` (the hook is moved, not changed; `FIRST_MS` and `LATER_MS` are re-exported from `MOTION.fill` and `MOTION.settle` so `ScoreMeter.test.ts` keeps its imports). `aria-valuenow` and `aria-valuetext` keep the final value from the first frame (`ScoreMeter.tsx:71-78` already does this), and the centre is `aria-hidden`. The end screen's line (`EndScreen.tsx:177`, inline today) becomes `<p><CountUp value={fixed.length} /> {fixed.length === 1 ? "thing" : "things"} fixed today.</p>`; the noun is chosen from the final value, so no frame reads "0 thing". No new string: the sentence stays inline and untested as today.

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

What the person sees: 200 ms after the end screen lands, the bar draws from the top down over 250 ms. It is the one thing on the screen that moves after the crossfade, which is what points the eye at the card. The bar exists only for a critical or high next step (`.guided-next-critical`, `.guided-next-high`; the `::before` is `background: transparent` otherwise, `guided.css:585-602`), so on a medium or low card nothing draws and the card's place under "Do this next" is the cue. `ActNowCard` renders `guided-next-card guided-next-critical guided-next-watch` (`EndScreen.tsx:93`), so the draw runs on the act-now card too, and on the fishy noticed screen's card; that is allowed (section 1) because the bar points at the primary and the headline itself never moves.

```css
/* guided.css, after .guided-next-card::before (line 585) */
.guided-next-card::before { transform-origin: top; animation: cue-draw var(--motion-slow) var(--ease-out) both; animation-delay: var(--motion-base); }
@keyframes cue-draw { from { transform: scaleY(0); } to { transform: none; } }
```

The card itself does not move and has no hover state (it is not a control). Reduced motion: 0.001 ms, bar present from the first frame. Smoke: `motion-cue-bar`, `motion-cue-bar-act`.

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

`.guided-primary` is also `.button-primary` (`src/guided/StepFrame.tsx:118`, `button button-primary guided-primary`), so the one rule covers it; `.guided-primary:active` at `guided.css:256` keeps its own background and gains no transform of its own. `.watch-primary` is also `.button-primary` (`WatchWindow.tsx:115`) but `watch.css:78` has no transition list, so it gains `.watch-primary:active { transform: scale(var(--press-scale)); }` and `transition: transform var(--motion-fast) var(--ease-standard);` there. `.finding-row` scales its `::before` fill only, not the text, so the row's text does not blur: `.finding-row:active::before { transform: scale(var(--press-scale)); }`. Reduced motion: `--press-scale` is 1 and the transition is 0 ms; only the fill changes. Smoke: `motion-press`.

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

Where the caret lives: every surface that streams model text: `ModelText caret` (`src/components/ModelText.tsx`) in the Explain disclosure (`src/guided/ExplainPanel.tsx:189`, mounted by `StepFrame.tsx:7` on the step screens), the AI card and the chat's model turn (`src/chat/ChatModel.tsx`).

Where the breath lives: only where the spiral band is mounted. The step screens do not mount it (3.1), so until the chat is built the Explain disclosure has nothing to breathe and no band is added to the step screens for it (that would also fire the drift on every step). The breath lands with the chat home (`useGuidedHero(true, false)` there, DESIGN-CHAT-UI section 2) and with the end screen's AI block (DESIGN-AI-PRESENCE moment 3, the end brief, while its request is `running`). The watch window never breathes (it has no band).

What the person sees: the 1 px caret blinks at 1 Hz at the end of the growing text (as built, `components.css:1463-1482`, text arriving in whole fields, never a typewriter). While the request runs, the big spiral top right breathes: it fades from its token opacity to half and back every 3 s, with `ease-in-out`. When the text is complete, or Stop is pressed, or the request fails, `data-writing` is removed and the breath stops at once; the band's resting opacity returns on the next frame. A 5 % opacity step on a 1.2 px line is accepted and not transitioned.

```css
/* base.css, after hero-drift: the breath is on the inner mark, so it never replaces the band's drift */
.hero-spiral[data-writing="true"] svg { animation: spiral-breathe var(--motion-breathe) ease-in-out infinite; }
@keyframes spiral-breathe { 50% { opacity: 0.5; } }
```

The band (`div.hero-spiral`, `src/components/Hero.tsx:37`) keeps `hero-drift` on its own `animation` property and the svg inside it (`.hero-spiral svg`, `base.css:280`) carries the breath, so the two never contend for one shorthand and the drift never restarts when a request ends. The svg's opacity multiplies the band's token opacity, so the worst case is still half the token and the two animations may overlap. Code: `GuidedShell` reads `const { router, scan } = useApp(); const writing = scan.scan.explain.kind === "running";` (`useApp().scan` is a `ScanController`, `src/app/context.ts:18`; the explain slot is on `ScanController.scan`, `src/scan/useScan.ts`) and passes `writing` to `Hero`, which sets `data-writing` on the spiral band only. No delay. The chat's `useChat` busy flag (DESIGN-CHAT-UI section 5, `GuidedHero.writing`) feeds the same prop when the chat exists. Reduced motion: `.hero-spiral[data-writing] svg { animation: none; }` in the `guided.css:830` block; the caret is already `none` (`components.css:1480-1484`); the status line "Writing" (`ExplainPanel.tsx`, `AiCard.tsx:162-164`) carries the state in words. Smoke: `motion-breathe` (skipped until the chat exists), `motion-caret`.

### 3.9 The watch window: a state change

Where: `WatchWindow` (`src/watch/WatchWindow.tsx:30-40`, `StatusLine`), `watch.css`.

What the person sees: when the rating changes while the window is open (a "Check now" that finds something, or an acknowledgement that clears it), the icon and word crossfade over 200 ms. The row does not slide, grow or flash; "Act now" arrives exactly as quietly as "Nothing changed". The height change is the window's own (`tray::window_height`, Rust) and is not animated.

Code: `StatusLine` (`WatchWindow.tsx:31-39`) renders `div.watch-status[role="status"]` today and a rating change updates its text in place, which VoiceOver announces. That node stays stable (a remounted live region arrives with its content already present and is not announced); only an inner wrapper is keyed: `<div className={...} role="status"><span key={state.rating} className="watch-status-inner">{icon}{word}</span></div>`, with `.watch-status-inner { display: inline-flex; align-items: center; gap: var(--space-1); animation: fade-in var(--motion-base) var(--ease-standard); }` in `watch.css` after line 29 (the `gap` moves from `.watch-status` to the inner span). The "Checking now" spinner stays static (DESIGN-WATCH-WINDOW section 2, row 2). The tray raster swaps with no animation (macOS owns the item). Reduced motion: 0.001 ms. Smoke: `motion-watch-status`.

### 3.10 The daily reading's arrival

Where: DESIGN-DAILY's `DailyCard` (`apps/desktop/src/daily/DailyCard.tsx`, designed, not built) in its three sizes: the `line` (`p.guided-daily`, a meta line under the body on the plan screen and the first line of the chat's opening message), the `card` on the Overview, the `full` reading on "Your week" (`docs/DESIGN-DAILY.md` section 3). The words, the clause, the streak clause, the glyph rule, the `DailyReading` type and `reading.ts` are DAILY's; this file owns only the motion. The end screen and the watch window draw nothing new (DAILY section 3), so nothing of this moment runs there.

What the person sees: the kit icon and the word fade in over 200 ms as the screen lands; the clause follows 100 ms later. In `card` and `full`, the 7-day bars grow from the baseline once over 600 ms with `--ease-out` (DAILY section 3, "The bars", deferred to this file; its 600 ms figure is `--motion-settle`). Nothing else on the card moves; the streak number is plain text, never a count-up, because a streak that counts up is a scoreboard. The `line` is not a control and has no press state; the Overview card's "Your week" is a text link and, as open question 5 treats text links, does not scale.

```css
/* daily.css (with DESIGN-DAILY) */
.daily-word { animation: fade-in var(--motion-base) var(--ease-standard) both; }
.daily-clause { animation: fade-in var(--motion-base) var(--ease-standard) both; animation-delay: 100ms; }
.daily-bars rect { transform-origin: bottom; transform-box: fill-box; animation: bar-grow var(--motion-settle) var(--ease-out) both; }
@keyframes bar-grow { from { transform: scaleY(0); } to { transform: none; } }
```

Code: none beyond the classes; `TrendBars.tsx` draws each bar as a `rect` with its final height, so the SVG `<title>` and the `aria-label` are true from the first frame. Reduced motion: the delay is 0 ms, the fades 0.001 ms, and `.daily-bars rect { animation: none; }` joins the `guided.css:830` block so a 0.001 ms `scaleY(0)` never paints. Smoke: `motion-reading` (on `.guided-daily`, skipped until DAILY is built).

### 3.11 Tap the ring

Where: the score ring on the expert Overview (`src/components/ScoreMeter.tsx`, `role="meter"` at line 75).

What the person sees: a click, or Enter with the ring focused, replays the 900 ms fill and the count-up once. The grade word stays. It is the one place the person can ask for a moment again; it costs nothing and tells nothing new, which is why it is allowed. No new string, no tooltip, no cursor change (the ring is not a button; it is a meter that happens to replay).

Code: `ScoreMeterRing` gains `tabIndex={0}` and an `onClick` and `onKeyDown` (Enter) that bump a `replay` counter passed as the `key` of the inner `useEased` consumer, so the hook restarts from 0 with `firstMs`. `role="meter"`, `aria-valuenow` and `aria-valuetext` keep the final value throughout. Under `motionOff()` the tap does nothing. Smoke: `motion-ring-replay`.

### 3.12 Copy that smiles

One new string, in `apps/desktop/src/guided/copy.ts`, walked by `copy.test.ts`:

- `END.allDoneLine`: `"That's all for today."`, drawn on the all-done end screen between `END.allDone` and the calm line, only when the watch is off: "Your Mac is in good shape. That's all for today. I'll check again next time you open me." With the watch on the body stays `WATCH_ON.nextTime` ("I'll keep checking from the menu bar.", `urgencyLine`, `EndScreen.tsx:28-35`, pinned in `copy.test.ts:112-116`) and `allDoneLine` is not drawn, because that line is where the person learns the watch is on (DESIGN-WATCH).

Not added: a generic "Done. That one's sorted." line. Every rule carries its own `done` string starting with "Done." (DESIGN-V03 section 6's catalogue test; `runBatch.ts:74` strips `DONE_PREFIX` from a string that is always present), so a fallback would have nowhere to render and would replace the one fact the person reads on that screen. The reading's words are DAILY's (section 6 there).

Rules: full stops, no exclamation marks, no emoji, no joke about the risk, no "oops", no "yay", no praise of the person ("well done" is out: the app did the work). The string goes under the banned list and the 1.6 counter ("That's all for today." scores 1.25).

### 3.13 Model text

Unchanged: streamed in whole fields through `ModelText` with the caret, the badge under it, text nodes only (`SECURITY-MODEL.md`, "Rendering"). No fade per field, no highlight on arrival, no motion on the badge. The breathing spiral (3.8) is the whole of the AI's presence in motion.

## 4. Contracts

### Tokens and CSS

- `styles/tokens.css`: `--motion-settle`, `--motion-fill`, `--motion-breathe`, `--press-scale` in the first `:root` block (after line 43) and their reduced values in the block at line 161.
- `styles/base.css`: `hero-drift`, `horizon-rise`, `spiral-breathe` keyframes and the three rules of 3.1, 3.7 and 3.8; the breath selector is `.hero-spiral[data-writing="true"] svg` (DESIGN-CHAT-UI names the band; the svg is the corrected target, see Docs touched).
- `styles/guided.css`: `dot-settle`, `disc-in`, `cue-draw` keyframes; the `.scan-dot-*`, `.counter-number`, `.guided-status-disc`, `.guided-tick` (delay), `.guided-next-card::before`, `.guided-end-row` (press) and `.guided-welcome-first` (stagger) rules; the reduced-motion block at line 830 gains `.hero-spiral`, `.hero-spiral[data-writing] svg`, `.guided-status-disc`, `.daily-bars rect`.
- `styles/components.css`: `transform` in the `.button` transition list (line 19), the `.button-primary:active` scale, `.finding-row:active::before`.
- `styles/screens.css`: `.score-meter-grade` delay.
- `styles/watch.css`: `.watch-status-inner` fade and gap; `.watch-primary:active` scale and its transition.
- `styles/daily.css` (with DESIGN-DAILY): `.daily-word`, `.daily-clause`, `.daily-bars rect` and `bar-grow` from 3.10.
- `styles/chat.css` (with DESIGN-CHAT-UI): the chip and card press scale; nothing else from this file.

### Core (`packages/core`)

Nothing. No type, port, schema, validator or fixture changes.

### Desktop (`apps/desktop/src`)

- `app/motion.ts` (new): `MOTION`, `motionOff()`, `useEased()`. `components/ScoreMeter.tsx` imports from it; `FIRST_MS` and `LATER_MS` stay exported for the test.
- `components/CountUp.tsx` (new): `{ value: number }`; counts only from 10.
- `components/Hero.tsx`: `writing?: boolean` prop, rendered as `data-writing` on the spiral band only.
- `components/ScoreMeter.tsx`: the replay tap of 3.11 (`tabIndex`, `onClick`, Enter).
- `guided/GuidedShell.tsx`: `const { router, scan } = useApp(); const writing = scan.scan.explain.kind === "running";` (today it destructures `router` only, `GuidedShell.tsx:28`), plus the chat's busy flag when the chat exists; no delay.
- `guided/GuidedWelcome.tsx`: the `guided-welcome-first` class from `settings.onboarded`.
- `guided/EndScreen.tsx`: `CountUp` in the inline fixed line (`EndScreen.tsx:177`); `END.allDoneLine` between the all-done title and `END.nextTime` when the watch is off.
- `daily/DailyCard.tsx`, `daily/TrendBars.tsx` (DESIGN-DAILY's, not built): the classes of 3.10 and nothing else.
- `watch/WatchWindow.tsx`: `span.watch-status-inner` keyed by `state.rating` inside the stable `div[role="status"]`.
- `guided/copy.ts`: `END.allDoneLine`.

### Rust

Nothing. No command, no event, no field.

### Demo params (`app/demo-boot.ts`, `adapters/demo-watch.ts`)

- `pace=0` (exists) now also freezes the JavaScript count-ups through `motionOff()`.
- `onboarded=0` (exists, the default without `onboarded=1`) reaches the first-run hello.
- No param for the streak: DESIGN-DAILY's `daily=` param (`adapters/demo-daily.ts`) seeds the history the streak is read from.
- No new call is recorded on `window.__talosDemoCalls`; nothing here calls an adapter.

### Docs touched by the build

- `docs/DESIGN-MINERAL.md` section 5: the motion table gains rows for the welcome drift (900 ms / static), the dot settle (150 ms / immediate), the done disc (150 ms then the 240 ms tick / static), the cue bar (250 ms after 200 ms / immediate), press (150 ms scale / fill only), the horizon (250 ms / immediate), the breathing spiral (3 s cycle while a request runs / static) and the count-ups (600 ms / final value); the sentence "no ambient looping motion" gains "except the spiral band while a model request runs, which stops when the request does".
- `docs/DESIGN-WARMTH.md` section 9b: "Nothing in this pass animates." gains "Motion over these layers is specified in docs/DESIGN-PLAYFUL.md; the spiral band's breath runs from the token opacity down, never up, so the measured limits hold."
- `docs/DESIGN-CHAT-UI.md`: nothing further. Its spiral bullet carries the svg selector and the downward breath, its disc is 0.92 with the fade and its card fade is `--motion-base`, aligned on 2026-10-17.
- `docs/DESIGN-DAILY.md` section 3: the card's arrival and the bars' growth are DESIGN-PLAYFUL 3.10; the 600 ms figure becomes `--motion-settle`. Its words, clause, streak clause and `calmStreak` are unchanged.
- `docs/DESIGN-WATCH.md`, the three swapped strings: unchanged; `END.allDoneLine` sits before `END.nextTime` only, never before `WATCH_ON.nextTime`.
- `apps/desktop/qa/README.md`: the motion smoke test and its moments (section 6).
- `docs/TASKS.md`: one row, "Playful interactions (DESIGN-PLAYFUL): designed, not built".

## 5. Call budget and caching

Zero model calls, zero new storage. The reading this file animates is DESIGN-DAILY's, built from the day document and `WatchState` already in memory; its paragraph is the brief other documents already pay for (DESIGN-AI-PRESENCE section 3), shown only when present and never requested by this file. Nothing is persisted: no streak record, no "last reading" file, no replay count, no motion preference (the OS setting is the preference). The breathing band reads the explain slot and never touches it.

## 6. Tests and QA

**Unit (vitest, jsdom).**

- `app/motion.test.ts`: `MOTION` equals the six `--motion-*` tokens read from `tokens.css`; `motionOff()` is true under the reduce media query, true at `__talosDemoPace === 0`, false otherwise; `useEased` with a fake `requestAnimationFrame` reaches the target by `firstMs` and never overshoots, and returns the target on the first render when `motionOff()`.
- `components/CountUp.test.ts`: the hidden span holds the final value from the first render; the visible span is `aria-hidden`; at `value` 3 the visible span reads 3 on the first render; at 12 it reads 0 then 12.
- `components/ScoreMeter.test.ts` (exists): unchanged assertions pass against the moved hook; `aria-valuenow` is the final value on the first render; a click restarts the fill from 0 and leaves `aria-valuenow` unchanged; under `motionOff()` a click changes nothing.
- `guided/copy.test.ts` (exists): walks `END.allDoneLine` under the banned list and the 1.6 counter; the DAILY words stay under DAILY's own `copy.test.ts` entry, which also asserts none of "safe", "protected", "secure", "clean", "fine".
- `guided/EndScreen.test.ts` (exists): the fixed line renders "3 things fixed today." with the hidden span holding 3; the all-done screen with the watch off reads `END.allDone`, `END.allDoneLine`, `END.nextTime` in that order; with the watch on it reads `END.allDone` then `WATCH_ON.nextTime` and no `allDoneLine`.
- `components/Hero.test.ts` (exists): `writing` sets `data-writing` on the spiral only, never on rings or the horizon.
- `guided/GuidedShell.test.tsx` (new; `guided/shell.test.ts` tests the expert shell's guided entry points, not `GuidedShell`): `data-writing` appears while `scan.scan.explain.kind === "running"` and is gone on `ready`.
- `watch/WatchWindow.test.tsx` (exists): the `div[role="status"]` is the same DOM node across a rating change; its inner span is new.

**Harness (`qa/snap.ts`, `qa/axe.ts`).** No shot changes: `UNROLL_CSS` (`harness.ts:593`) freezes every animation and `pace=0` freezes the count-ups, so the baseline folders stay stable. No shot is added: `guided-end-all-done` runs with `licensed=1` and the watch setting on by default (`settings/index.ts:81`, `watchActive` in `app/gate.ts:18`), so its body stays `WATCH_ON.nextTime` and the baseline is unchanged; the watch-off form of the all-done body is covered in jsdom only, because no demo param turns the watch setting off and this file adds none. The reading's shots are DESIGN-DAILY's.

**Motion smoke (`qa/motion.ts`, new entry point, `--port` as the others).** Runs the demo at `pace=1` without `UNROLL_CSS`, light scheme, 1100x760. For each moment it navigates, reads `getComputedStyle(el)` at the first frame after the trigger and again after the moment's duration plus 50 ms, and asserts the start and end values; then repeats the moment under `page.emulateMedia({ reducedMotion: "reduce" })` and asserts `animationName === "none"` or a 0.001 ms duration and the resting values at the first frame. Moments and their elements: `motion-welcome-drift` (`[data-testid="hero-spiral"]`, opacity 0 then the token), `motion-hello` (`onboarded=0`, the primary's opacity 0 then 1 by 600 ms), `motion-scan-dot` (the first `.scan-dot-passed`, `animationName` `dot-settle`), `motion-ring-fill` (`guided=0`, `.score-meter-figure` text below the final then equal by 950 ms, `aria-valuenow` final throughout), `motion-fixed-count` (`fix=ok&fix_delay=0`: the dev-machine walk fixes fewer than ten, so this covers the fade only: the hidden span final throughout, the visible span equal to it on the first frame; a count-up fixture needs ten fixes and is not in the demo), `motion-done-disc` (`.guided-status-disc` `animationName` `disc-in`, `.guided-tick` `animationDelay` 150 ms), `motion-cue-bar` (`.guided-next-card::before` via `getComputedStyle(el, "::before")`, transform `scaleY(0)` then none), `motion-press` (`page.mouse.down()` on the primary, transform `matrix(0.98, …)`, then none on `up`), `motion-horizon` (`[data-testid="hero-horizon"]`, opacity 0 then 1), `motion-breathe` (skipped until the chat exists; then `chat=1&provider=chatgpt&ai=available`, type a turn: `data-writing="true"` on `[data-testid="hero-spiral"]` and `animationName` `spiral-breathe` on its `svg` while streaming, gone on the first frame after the demo stream's end, and never present on the idle chat home for 5 s), `motion-caret` (`.caret` `animationName` `caret-blink`, 1 Hz), `motion-watch-status` (`watch.html?watch=calm` then `Check now` on the look fixture: the same `.watch-status` node, a new `.watch-status-inner` span with `animationName` `fade-in`), `motion-cue-bar-act` (`watch=act&licensed=1`, the `ActNowCard`'s `::before` as above, the headline's `animationName` `none` throughout), `motion-ring-replay` (`guided=0`, click `[role="meter"]` after the first fill: `.score-meter-figure` text below the final then equal by 950 ms, `aria-valuenow` final throughout), `motion-reading` (skipped until DESIGN-DAILY is built; then `daily=calm` on the plan screen: `.guided-daily .daily-word` opacity 0 then 1, `.daily-clause` 100 ms behind). Exit 1 on any failure; progress to stderr. It also asserts the WCAG facts: no animation on an idle screen after 5 s (`document.getAnimations()` empty), no flash above 3 Hz (the only infinite animations are `caret-blink` at 1 Hz, `spiral-breathe` at 0.33 Hz, `spin` and `shimmer`).

**Axe.** axe-core has no motion rule; what it checks here is unchanged by motion as long as the final frames are the shots. The relevant facts for assistive tech are tested in jsdom: the count-up's visible span is `aria-hidden` and the final number is in the tree from the first render; `role="meter"` carries the final value throughout the fill and a replay; the watch's `div[role="status"]` is never remounted, so a rating change is announced as today; the reading row is DESIGN-DAILY's button and keeps its name while its inner spans fade; the caret sits inside the `aria-live="off"` model block (DESIGN-CHAT section 3). WCAG 2.3.1 (three flashes) and 2.2.2 (pause, stop, hide: the breath has Stop) are satisfied by construction and asserted by the smoke test.

**Only on a real Mac.** Whether WKWebView flips `prefers-reduced-motion` live when System Settings > Accessibility > Display > Reduce motion is toggled with the app open (Chromium does; a relaunch may be needed in WebKit); the 0.001 ms animation rule on SVG `stroke-dashoffset` in WebKit (whether the tick paints its end frame); whether WebKit transitions out of a removed animation or snaps (3.8 accepts the snap); `transform-box: fill-box` on the bars' `rect` in WebKit; frame pacing of `useEased` on a 120 Hz display; the watch panel's own show animation under `NSPanel` layered with the status crossfade; energy impact of the 3 s breath over a two-minute Claude turn in Activity Monitor; dark-mode switch mid-fill.

## 7. Out of scope

A motion preference inside the app (the OS setting is the only switch); sound; haptics; a tray icon that animates or badges; confetti and particles; a typewriter; page transitions with movement (the crossfades stay); animated charts beyond DESIGN-DAILY's one-time bar growth, which this file owns as 3.10 and times with `--motion-settle`; a second word set, streak wording or day rule for the reading (DAILY's); Lottie or any animation library (CSS and one rAF hook only); gestures; motion on the password sentence, the fishy screens beyond the crossfade, or any security word; a streak record on disk; notifications of any kind; Windows and Linux.

## 8. What the owner should see tomorrow

Open the app. For six seconds the seventeen dots fill one by one with a small pop each, and "1 thing to fix so far" fades in when it changes. On the plan screen nothing moves after the crossfade (the reading line under the body, when DESIGN-DAILY lands, fades its word in and its clause a beat later). Press "Let's go": the button dips under the pointer. Fix the firewall: the disc pops in and the tick draws, 390 ms in all, then the next step. On the end screen the spiral drifts into the top right over most of a second, the dunes rise at the foot, "3 things fixed today." fades in whole, and the rust bar on "Do this next" draws down a beat after the screen lands. Open Details: the ring fills and the score counts up; click the ring and it does it again. Click the menu bar: "Nothing changed", and after "Check now" the word crossfades, nothing jumps. On a fresh Mac (or `onboarded=0` in the demo): the spiral drifts in, then the headline, the sentence and "Start" arrive one after the other, and the screen is still. On the chat home, when built: the spiral breathes slowly while ChatGPT writes and stops when the paragraph is complete. Turn on Reduce motion in System Settings and do it again: every screen is identical, with nothing missing, and nothing moves.

## Open questions for the owner

1. **The done disc's scale.** This file and DESIGN-CHAT-UI both say 0.92 with an opacity fade (aligned 2026-10-17); the plainer alternative is 0.96 with no fade. One value holds on the guided steps and the chat cards. Default here: 0.92 with the fade.
2. **A ring on the scanning screen.** The pattern brief offered a ring that fills as the 17 areas are read. The guided scan already has a bar and the dots; a second gauge for one process reads as noise. Default here: no ring; the dots pop.
3. **Tap the ring (3.11).** It is the one moment the person can replay, and a meter that reacts to a click is unusual. It can be dropped with no other change. Default here: keep; it is the cheapest reply the app can give to a tap.
4. **The breath direction.** Fading down keeps the measured contrast; brightening (an earlier draft's 1.6x; DESIGN-CHAT-UI now says down) is more visible but puts a 0.16 line under the right edge of the column at 1100 px, which DESIGN-WARMTH 4a says fails. Default here: down.
5. **Press scale on the watch window's links.** `.watch-link` is a text link; a scale on text reads as a wobble. Default here: the primary scales, the links underline as today.

## Checked on this Mac (2026-10-17, read-only)

`defaults read com.apple.universalaccess reduceMotion`: key absent (Reduce Motion off); `reduceTransparency`: absent; `defaults read -g AppleInterfaceStyle`: Dark; `sw_vers`: macOS 27.0.1 (26A434). Not checked: the running app, the tray item, WKWebView's live media-query flip, any screenshot of motion. No git command was run; no file outside `docs/DESIGN-PLAYFUL.md` was written.

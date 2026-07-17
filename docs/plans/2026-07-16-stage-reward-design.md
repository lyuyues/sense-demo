# Per-Stage Reward — Design

> 2026-07-16. Status: agreed, implementing.

Each of the 5 canvas stages (`add-elements`, `color`, `light`, `sound-studio`,
`animate` — `TAB_ORDER`, `app.js:854`) awards one collectible item. The item is
chosen by the caregiver at setup: either a preset or an AI-generated image from
free text.

## Why the reward is non-contingent

SENSE elicits preferences; no stage has a correct answer. A reward that appears
contingent on performance invites the child to optimize for the reward rather
than reveal a preference — contaminating the only thing the probe collects.

Therefore: **one item per stage, awarded on leaving the stage, unconditionally.**
Not scored on how much was drawn, how many elements added, or how the drum was
played. A child who does nothing in a stage still earns the item — "did nothing"
is itself a valid preference signal (e.g. adding no sound may be auditory
avoidance) and must not be penalized.

## Reward item: preset or generated

Caregiver picks on the **welcome screen** (already the de-facto setup area — it
holds Start plus 3 dev-skip buttons, and the caregiver is there anyway).

**Presets (8).** Grounded in the circumscribed-interests literature (South &
Ozonoff 2005; Turner-Brown et al. 2011; Anthony et al. 2013): vehicles/trains,
dinosaurs, animals are most common, and symbolic interests (letters, numbers) are
distinctively elevated in autism vs. NT children — a category generic children's
apps usually miss.

train · dinosaur · car · cat · numbers · letters · space · star (star = default)

Presets are **pre-generated once** through the same Imagen pipeline and committed
as PNGs under `assets/rewards/`. This buys style consistency with generated
items (same `STICKER_STYLE`), zero latency, and — critically — it works on
GitHub Pages.

**Text → AI.** Reuses `/api/generate-sticker` (`server.py:163`) unchanged:
name → Imagen 4 → `rembg` background removal → 300px transparent PNG → base64
data URL. Pass `event: ''` to get the neutral default context (we want a
standalone object, not one staged inside the scene).

## Deployment constraint

`app.js:355`: on GitHub Pages `API_BASE = ''` — there is no server.py, so live
generation 404s. Text generation therefore works **only on a local server**
(which is where the study runs, on a tablet). Presets are static and always work.

Degradation: Pages / generation failure / caregiver skipped the picker → default
star. A collectible always flies; the bar never shows a hole.

## Data flow

```
welcome:  [presets…] [✏️ custom text]
              ↓ selection fires generation, NOT awaited
          state.rewardReady = Promise<{src, label}>   ← runs in background
              ↓
photo (2 captures) → event (pick scenario) → canvas
              ↓
stage 1 ends → await state.rewardReady  (long since resolved)
              ↓
item flies from canvas centre → next empty slot
```

Fire-and-forget is what makes the 3–5s generation invisible: the child passes
through the photo and event screens first, so the image is ready well before the
first award. One generation per session; all 5 stages reuse the same item.

## Sound

The celebration plays a synthesized ascending arpeggio (C5–E5–G5–C6) on pop-in
and a soft rising tick on landing. Yue decided to include it after the
contamination risk was raised.

The risk is real but bounded: it is an uncontrolled auditory stimulus at a stage
boundary, immediately adjacent to the Sound stage that elicits auditory
preferences. Two properties keep it a constant rather than a confound — it is
identical at all five boundaries, and it fires only after the leaving stage's
data has been captured. Mute `playRewardChime` / `playRewardLand` if a pilot
shows children reacting to it.

## Collection bar

5 slots above `phase-tabs` in `.canvas-topbar`. Item flies from canvas centre to
the next empty slot, lands with a pop. The 5th landing coincides with leaving
`animate`, which already leads into `processing → transition → video` — so a full
bar becomes the video unlock without inventing a new ceremony.

Yue chose a separate bar over merging badges into `phase-tab`, accepting that
tabs and bar both express 5-stage progress.

## Idempotence

`phase-tab`s are clickable navigation (`app.js:867`) — the child can jump back to
an earlier stage. Awarding on stage-exit alone would let repeated visits farm
extra items and desync the bar from real progress. Track awarded stage ids in
`state.rewardsAwarded = new Set()`; each id awards exactly once; revisits award
nothing.

## Files touched

| file | change |
|---|---|
| `index.html` | welcome: preset gallery + text input. canvas: collection bar above the topbar |
| `app.js` | `REWARD_PRESETS`, `setRewardItem()`, `awardRewardFor()`, `rewardsAwarded` Set, fly animation |
| `style.css` | picker, collection bar, fly/land animation, short-landscape compaction |
| `assets/rewards/` | 8 pre-generated PNGs |
| `generate_reward_presets.py` | new — regenerates the presets |
| `server.py` | **no change** — `/api/generate-sticker` reused as-is |

## Notes from implementation

- **The 5th award hangs off the drum, not a button.** `#btn-animate-done` no
  longer exists (`animate-bar` is an empty placeholder), so its `?.`-guarded
  handler is dead code. The live path is `finishDrum()` inside
  `setupAnimatePhase()`, whose existing 1200ms hold before
  `goToPhase('processing')` is enough for the collectible to land.
- **Award uses the real previous sub-phase**, not the `order[newIdx-1]`
  inference already in `setCanvasSubPhase` — that inference assumes forward
  navigation and names the wrong stage on a backward tab jump.
- **Welcome layout**: the picker adds ~135px and overflowed every landscape
  tablet. `.welcome-content` is `overflow:hidden` on purpose (it clips the
  floating decorations), so the fix compacts rather than scrolls, and needs
  id-specificity + `!important` to beat `style-handdrawn.css`.
- `generate_reward_presets.py` does **not** copy server.py's `.env` path — that
  hardcoded `../` chain is off by one and only works via the env var.

## Verified (2026-07-16, Playwright)

- 8 presets render; selection sets `state.rewardItem`.
- Walking the 5 stages fills 5 slots in order; flyer animates; no JS errors.
- Idempotence: 6 backward bounces between paid stages → set stays at 5, exactly
  5 slot images, 0 stray flyers on `body`.
- Real drum (3×30 taps) → `finishDrum` → 5th lands while still on canvas, then
  `processing`.
- Custom text with server.py: "Peppa Pig" → generated transparent PNG in 6.8s;
  child reached the event screen at t+0.9s with generation still running.
- Fallback without `/api` (mimics Pages): status tells the caregiver, item falls
  back to star, a collectible still flies.
- Fits all iPad sizes portrait + landscape (legacy 1024×768 clips ~2px of the
  dev-only buttons).

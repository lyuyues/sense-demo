# SENSE Difficulty System — UI Implementation Spec

Date: 2026-05-21
Status: Ready to implement
Source brainstorm: SENSE channel axes + 3-level difficulty system

This spec instructs another session to implement the UI for a 3-level difficulty system (Protective / Normal / Challenge) on top of the existing channel-axes infrastructure.

## 1. Background (1 minute read)

The web demo already extracts per-channel preferences from Stage 1 (drum/color/sound/spatial) and applies them to the Stage 2 video via `applyVideoPreferences()`. Today, the canvas-calibrated baseline is the only value used.

We are adding a **difficulty layer** between baseline and final applied value:

```
Stage 1 canvas signal → baseline (per channel)
                          ↓
              Difficulty level (Protective / Normal / Challenge)
                          ↓
              Effective per-channel value (passed to applyVideoPreferences)
```

The child picks **one** difficulty at the start of Stage 2. The caregiver can fine-tune per-channel via a settings icon during video playback.

## 2. Decided design (locked, do not redesign)

### 2.1 Direction rule

For each continuous channel, with `baseline ∈ [0, 1]` in norm space:

```
TOLERANCE         = 0.05
PROTECTIVE_STEP   = 0.15  // larger — generous accommodation
CHALLENGE_STEP    = 0.05  // smaller — gentle push toward typical
```

```js
function computeLevelValue(baseline, level) {
  // Middle-range child: no displacement
  if (Math.abs(baseline - 0.5) <= TOLERANCE) return baseline;
  if (level === 'normal') return baseline;

  // baseline < 0.5 → child on hyper / far / slow side
  // baseline > 0.5 → child on hypo / close / fast side
  const onLowSide = baseline < 0.5;

  if (level === 'protective') {
    // Move further FROM typical (toward child's extreme)
    return clamp(baseline + (onLowSide ? -PROTECTIVE_STEP : +PROTECTIVE_STEP), 0, 1);
  }
  if (level === 'challenge') {
    // Move TOWARD typical (toward real-world stimulus level)
    return clamp(baseline + (onLowSide ? +CHALLENGE_STEP : -CHALLENGE_STEP), 0, 1);
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
```

### 2.2 Bucket channels (spatial, prep_interval)

These are discrete (3 anchors). The rule:

| Baseline bucket | Protective | Normal | Challenge |
|---|---|---|---|
| extreme-low (e.g., far / 1.5s) | = baseline (no headroom) | = baseline | step toward middle |
| middle (e.g., mid / 1.0s) | = baseline (no displacement) | = baseline | = baseline |
| extreme-high (e.g., close / 0.5s) | = baseline (no headroom) | = baseline | step toward middle |

For spatial: Protective at extreme = stays at extreme video file (no 4th file available).
For prep: same logic.

### 2.3 Worked examples (informative — for QA / dev verification)

Three example child profiles. Values are norm-space (0..1) → actual playback parameter. Direction reverses on hypo side (baseline > 0.55).

**Hyper child — baseline = 0.20**

| Channel | Baseline | Protective | Normal | Challenge |
|---|---|---|---|---|
| Brightness | 0.20 → CSS 0.70 | **0.05** → CSS 0.55 | 0.20 → CSS 0.70 | **0.25** → CSS 0.75 |
| Saturation | 0.20 → sat 0.58 | **0.05** → sat 0.37 | 0.20 → sat 0.58 | **0.25** → sat 0.65 |
| Pitch lowpass | 0.20 → 1840 Hz | **0.05** → 685 Hz | 0.20 → 1840 Hz | **0.25** → 2225 Hz |
| Voice gain | 0.20 → 0.38 | **0.05** → 0.17 | 0.20 → 0.38 | **0.25** → 0.45 |
| BGM gain | 0.20 → 0.38 | **0.05** → 0.17 | 0.20 → 0.38 | **0.25** → 0.45 |
| SFX gain | 0.20 → 0.38 | **0.05** → 0.17 | 0.20 → 0.38 | **0.25** → 0.45 |
| Spatial bucket | far | **far** (no headroom) | far | **mid** |
| Prep interval bucket | 1.5s | **1.5s** (no headroom) | 1.5s | **1.0s** |

**Middle child — baseline = 0.50 (within ±0.05 tolerance)**

All three levels collapse to baseline. Playback identical; only `level_selected` log field differs. This is correct, not a bug.

**Hypo child — baseline = 0.80 (direction reverses)**

| Channel | Baseline | Protective | Normal | Challenge |
|---|---|---|---|---|
| Brightness | 0.80 → CSS 1.30 | **0.95** → CSS 1.45 | 0.80 → CSS 1.30 | **0.75** → CSS 1.25 |
| Saturation | 0.80 → sat 1.42 | **0.95** → sat 1.63 | 0.80 → sat 1.42 | **0.75** → sat 1.35 |
| Pitch lowpass | 0.80 → 6460 Hz | **0.95** → 7615 Hz | 0.80 → 6460 Hz | **0.75** → 6075 Hz |
| Voice / BGM / SFX gain | 0.80 → 1.22 | **0.95** → 1.43 | 0.80 → 1.22 | **0.75** → 1.15 |
| Spatial bucket | close | **close** (no headroom) | close | **mid** |
| Prep interval bucket | 0.5s | **0.5s** (no headroom) | 0.5s | **1.0s** |

For hypo children, Protective amplifies their preferred high-stimulus direction (this is by design — graduated exposure means honoring the comfort zone, not always softening). Challenge pulls toward typical.

**Boundary clamping (quick reference)**

| Situation | Protective behavior | Challenge behavior |
|---|---|---|
| Continuous channel, baseline = 0.05 (extreme hyper) | clamp to 0 (no headroom, ≈ Normal) | +0.05 → 0.10 |
| Continuous channel, baseline = 0.95 (extreme hypo) | clamp to 1.0 (no headroom, ≈ Normal) | −0.05 → 0.90 |
| Bucket channel, baseline at extreme | = own bucket (no 4th bucket) | jump to mid bucket |
| Bucket channel, baseline at mid | = mid | = mid |

### 2.4 Force-choose flow

- New screen `screen-difficulty` inserts BETWEEN Stage 1 outputs and video playback
- 3 large buttons, **child selects**, no skip / no default
- "Continue" button is *disabled* until a choice is made
- After selection: caregiver still has a settings icon on the video screen for per-channel override

### 2.5 Settings icon on video screen

- Position: **bottom-right of video**
- Tap opens an overlay panel with **7 per-channel sliders**
- Opening the panel **pauses video** (resume on close)
- Each slider shows current effective value; adjusting moves channel to "custom"
- See §3.3 for layout

### 2.6 Logging schema (additive)

Extend the existing behavior-JSON export with:

```json
{
  "difficulty": {
    "level_selected": "protective" | "normal" | "challenge",
    "selected_by": "child",
    "selected_at": <ISO timestamp>,
    "baseline_per_channel": {
      "brightness": 0.32,
      "saturation": 0.45,
      "pitch": 0.28,
      "voice": 0.41,
      "bgm": 0.50,
      "sfx": 0.55,
      "spatial": 0.78,
      "prep_interval": "hyper"
    },
    "applied_per_channel": {
      "brightness": 0.17,
      ...
    },
    "manual_adjustments": [
      {
        "ts": "<ISO>",
        "channel": "brightness",
        "from": 0.17,
        "to": 0.30,
        "trigger": "caregiver_settings"
      }
    ]
  }
}
```

Once `manual_adjustments` is non-empty, set a top-level flag `"condition_contaminated": true` so research analysis can filter.

## 3. UI changes (concrete)

### 3.1 New screen: `screen-difficulty`

**Insert** between processing/transition and `screen-video`.

Suggested flow rewrite: `... → screen-processing → screen-difficulty → intro_transition.mp4 → screen-video → screen-wrapup`

**Markup (`index.html`)** — add new `<div class="screen" id="screen-difficulty">`:

```html
<div id="screen-difficulty" class="screen">
  <div class="difficulty-content">
    <h1 class="difficulty-title">How do you want to watch today?</h1>
    <p class="difficulty-subtitle">Pick one. There's no wrong answer.</p>

    <div class="difficulty-grid">
      <button class="difficulty-card" data-level="protective">
        <div class="diff-icon">[ICON_TBD]</div>
        <div class="diff-label">[CHILD_LABEL_TBD]</div>
        <div class="diff-sublabel">Gentle and cozy</div>
      </button>
      <button class="difficulty-card" data-level="normal">
        <div class="diff-icon">[ICON_TBD]</div>
        <div class="diff-label">[CHILD_LABEL_TBD]</div>
        <div class="diff-sublabel">Just right</div>
      </button>
      <button class="difficulty-card" data-level="challenge">
        <div class="diff-icon">[ICON_TBD]</div>
        <div class="diff-label">[CHILD_LABEL_TBD]</div>
        <div class="diff-sublabel">A little brave</div>
      </button>
    </div>

    <button id="btn-difficulty-continue" class="btn-primary" disabled>Continue</button>
  </div>
</div>
```

**Default labels (TBD — see §4.1)**: use `Gentle / Just Right / Brave` (English) and a placeholder colored circle until icons are decided.

**Style**: hand-drawn, follows `style-handdrawn.css` conventions (Patrick Hand / Caveat, irregular borders, hard offset shadow). 3 cards in a row, large tap targets (~200×200 px each on tablet), single-card pressed state with bouncy feedback.

**Behavior (`app.js`)**:
- On screen show, no card selected, Continue disabled
- Tap card → `selected_level` set, card gets `.selected` class, others remove it
- Tap Continue (only enabled after selection) → set `state.difficultyLevel`, compute `state.appliedPerChannel`, log to `state.difficultyMeta`, transition to video
- Log to `state.interactionLog`: `{ts, type: 'difficulty_selected', level, selected_by: 'child'}`

### 3.2 Settings icon + panel on video screen

**Markup (`index.html`)** — add inside `screen-video` next to existing video controls:

```html
<button id="btn-video-settings" class="video-settings-icon" aria-label="Adjust settings">⚙</button>

<div id="settings-panel" class="settings-panel hidden">
  <div class="settings-header">
    <h2>Adjust the video</h2>
    <button id="btn-settings-close" class="settings-close">×</button>
  </div>

  <div class="settings-section" data-category="visual">
    <h3>Visual</h3>
    <div class="settings-row" data-channel="brightness">
      <label>Brightness</label>
      <span class="settings-axis">dim ← → bright</span>
      <input type="range" min="0" max="100" data-channel="brightness">
      <button class="settings-reset" data-channel="brightness" title="Reset to chosen mode">↻</button>
    </div>
    <div class="settings-row" data-channel="saturation">
      <label>Saturation</label>
      <span class="settings-axis">muted ← → vivid</span>
      <input type="range" min="0" max="100" data-channel="saturation">
      <button class="settings-reset" data-channel="saturation">↻</button>
    </div>
  </div>

  <div class="settings-section" data-category="auditory">
    <h3>Sound</h3>
    <div class="settings-row" data-channel="pitch">
      <label>Pitch tone</label>
      <span class="settings-axis">muffled ← → bright</span>
      <input type="range" min="0" max="100" data-channel="pitch">
      <button class="settings-reset" data-channel="pitch">↻</button>
    </div>
    <div class="settings-row" data-channel="voice">
      <label>Voice volume</label>
      <span class="settings-axis">quiet ← → loud</span>
      <input type="range" min="0" max="100" data-channel="voice">
      <button class="settings-reset" data-channel="voice">↻</button>
    </div>
    <div class="settings-row" data-channel="bgm">
      <label>Music volume</label>
      <span class="settings-axis">quiet ← → loud</span>
      <input type="range" min="0" max="100" data-channel="bgm">
      <button class="settings-reset" data-channel="bgm">↻</button>
    </div>
    <div class="settings-row" data-channel="sfx">
      <label>Sound effects</label>
      <span class="settings-axis">quiet ← → loud</span>
      <input type="range" min="0" max="100" data-channel="sfx">
      <button class="settings-reset" data-channel="sfx">↻</button>
    </div>
  </div>

  <div class="settings-section" data-category="spatial">
    <h3>People nearby</h3>
    <div class="settings-row settings-row-bucket" data-channel="spatial">
      <label>Distance from friends</label>
      <span class="settings-axis">far ← → close</span>
      <div class="settings-buckets">
        <button data-channel="spatial" data-bucket="far">far</button>
        <button data-channel="spatial" data-bucket="mid">mid</button>
        <button data-channel="spatial" data-bucket="close">close</button>
      </div>
      <button class="settings-reset" data-channel="spatial">↻</button>
    </div>
  </div>

  <div class="settings-section" data-category="temporal">
    <h3>Pacing</h3>
    <div class="settings-row settings-row-bucket" data-channel="prep_interval">
      <label>Anticipation pause</label>
      <span class="settings-axis">slow ← → fast</span>
      <div class="settings-buckets">
        <button data-channel="prep_interval" data-bucket="hypo">slow (1.5s)</button>
        <button data-channel="prep_interval" data-bucket="typical">normal (1.0s)</button>
        <button data-channel="prep_interval" data-bucket="hyper">fast (0.5s)</button>
      </div>
      <button class="settings-reset" data-channel="prep_interval">↻</button>
    </div>
  </div>

  <div class="settings-footer">
    <button id="btn-settings-reset-all">Reset all to {{selectedLevel}}</button>
  </div>
</div>
```

**Behavior**:
- Tap `#btn-video-settings` → show `#settings-panel`, pause video (`video.pause()` + stem mixer pause if active), set `state.settingsOpen = true`
- Tap `#btn-settings-close` → hide panel, resume video, append a session-level `manual_adjustments` log entry if any change was made
- Slider input → update `devOverrides[channel]`, call `applyVideoPreferences()`, append `manual_adjustments` entry, set `state.condition_contaminated = true`
- Bucket button tap → same as slider; for spatial, also swap video file if applicable
- Reset button (per row) → clear `devOverrides[channel]`, recompute from chosen difficulty level, apply
- Reset-all button → clear all `devOverrides`, recompute from difficulty level
- Slider position on open = current effective value (either difficulty-derived or last-manual-override)

**Style**: hand-drawn overlay (semi-opaque white background, irregular borders). Positioned right side of screen, takes ~40% width on tablet, scrollable internally. Settings icon itself is a hand-drawn gear in the corner, ~48×48 px, with hover/press feedback.

### 3.3 Dev panel: update axis labels (existing `#dev-channel-panel`)

The existing dev panel already has 6 continuous sliders + 1 prep bucket row. Update the row labels to show the **axis hint** per channel:

| Row label (existing) | Add axis hint |
|---|---|
| Brightness | `dim ← → bright` |
| Saturation | `muted ← → vivid` |
| Pitch | `muffled ← → bright` |
| Voice | `quiet ← → loud` |
| BGM | `quiet ← → loud` |
| SFX | `quiet ← → loud` |
| Prep interval | `slow ← → fast` |

This is cosmetic (no behavior change). The dev panel is for testing; the user-facing settings panel is §3.2.

### 3.4 Logging implementation

In `app.js`, add to `state`:

```js
state.difficultyLevel = null;
state.difficultyMeta = {
  level_selected: null,
  selected_by: null,
  selected_at: null,
  baseline_per_channel: {},
  applied_per_channel: {},
  manual_adjustments: [],
};
state.condition_contaminated = false;
```

Existing JSON export should include `difficulty` and `condition_contaminated` keys at the top level (`exportSession()` or whichever function writes the JSON).

### 3.5 Wire to `applyVideoPreferences()`

`applyVideoPreferences()` already reads `devOverrides`. Add a layer: when no override is set for a channel, use the difficulty-adjusted value instead of raw baseline.

Pseudocode:

```js
function getEffectiveChannelValue(channel) {
  if (typeof devOverrides[channel] === 'number') return devOverrides[channel];
  const baseline = state.appliedPerChannel[channel] ?? 0.5; // pre-computed at level-select
  return baseline;
}
```

Replace per-channel reads in `applyVideoPreferences()` (e.g. `videoPreferences.visual.lightBrightness`) with `getEffectiveChannelValue('brightness')`, etc.

## 4. TBD — proposed defaults (note in code as TODO)

These are unanswered design questions. Use the proposed default in implementation; flag with `// TODO(yue): confirm <topic>` comment in code.

### 4.1 Child-facing labels & icons
**Proposed default**: English `Gentle / Just Right / Brave`, with a colored circle placeholder per card (soft pink / soft green / warm orange). Replace with proper hand-drawn icons later.

### 4.2 Caregiver role during child selection
**Proposed default**: spectator only. No caregiver-facing UI on the difficulty screen. Caregiver can still adjust later via settings icon.

### 4.3 Preview vs blind selection
**Proposed default**: blind. No preview shown next to each option (protects condition purity).

### 4.4 Settings icon visibility / lock
**Proposed default**: visible to all but requires a 1-second long-press to open (informal child-resistance, not a real lock).

### 4.5 Pause behavior on settings open
**Proposed default**: pause video + audio on open; resume on close.

### 4.6 Advanced settings layout
**Proposed default**: 4-category accordion (Visual / Auditory / Spatial / Temporal) as in §3.2 markup, all expanded by default.

### 4.7 Manual adjustment → condition label
**Proposed default**: any manual adjustment sets `condition_contaminated = true` but does NOT change `level_selected`. The original child-chosen level is preserved as the primary condition label.

### 4.8 Per-channel "no-challenge" safety cap
**Proposed default**: NONE for v1 (full openness). Add a `channelSafetyCap` config object as a placeholder so it can be added later without restructuring:

```js
const channelSafetyCap = {
  // brightness: { maxChallengeOffset: 0.05 }, // example, currently inactive
};
```

### 4.9 Drum/canvas signal incomplete fallback
**Proposed default**: if `baseline` is undefined or null for a channel, use 0.5 (group mean / middle) and log `"baseline_inferred": ["<channel>"]` in the difficulty meta.

### 4.10 Multi-channel simultaneous challenge cap
**Proposed default**: no cap. All channels move together to Challenge (or Protective) when level is selected.

## 5. File touchpoints

Expected files to modify:

- `index.html`
  - Add `<div id="screen-difficulty">` (§3.1)
  - Add `<button id="btn-video-settings">` and `<div id="settings-panel">` inside `screen-video` (§3.2)
  - Update dev panel row labels with axis hints (§3.3)
- `app.js`
  - Add `goToPhase('difficulty')` branch and `initDifficultyScreen()` (§3.1)
  - Add `computeLevelValue()`, `getEffectiveChannelValue()`, recompute on selection (§2.1)
  - Wire settings panel handlers (§3.2)
  - Extend state model and exportSession with difficulty meta + condition_contaminated (§3.4, §3.5)
- `style-handdrawn.css`
  - `.difficulty-card`, `.difficulty-grid`, `.difficulty-title` (§3.1)
  - `.video-settings-icon`, `.settings-panel`, `.settings-row`, `.settings-section`, `.settings-buckets`, `.settings-reset` (§3.2)
- `style.css`
  - Layout for new screen + settings panel (no theme-specific styles here, just structural)

Estimate: ~600-900 lines added/changed across these 4 files.

## 6. Acceptance criteria

When done, the demo should:

1. After Stage 1, show a difficulty selection screen with 3 cards
2. Continue button only enabled after a card is tapped
3. Tapping Continue plays the video with channel values adjusted per the chosen level
4. A settings gear icon appears at video bottom-right
5. Long-pressing the gear opens an overlay with 7 channel rows + axis hints
6. Adjusting any control immediately reflects in the video (visual change, audio change, etc.)
7. Closing the settings overlay resumes the video
8. Exported behavior JSON contains the full `difficulty` block (§2.5) including any `manual_adjustments`
9. Dev panel rows show axis hints (e.g., "muted ← → vivid")
10. Middle-baseline child (e.g., saturation = 0.5) shows all three difficulty cards but selecting any of them gives the same channel value (no displacement)

## 7. Out of scope for this PR

- Hand-drawn icon assets for the 3 difficulty cards (use placeholders for now)
- Localizing strings to Chinese (English only for v1)
- Real-time caregiver-side voice instruction during selection
- Calibration sweep mini-study tooling (separate research instrumentation, not demo UI)
- Spatial bucket video file generation per Challenge step (the existing 3 videos cover the bucket set; if Challenge of an extreme-baseline child shifts the bucket, just swap to the existing nearer file)

## 8. References (for the implementer)

- Channel axes decision: see memory `project_sense_channel_axes.md`
- Difficulty system decision: see memory `project_sense_difficulty_system.md`
- Customization argument: see memory `project_sense_customization_argument.md`
- Existing demo audio architecture: see memory `project_sense_demo_audio_architecture.md`
- Existing UI style direction: see memory `project_sense_ui_direction.md` (hand-drawn chrome, no icons reintroduced)

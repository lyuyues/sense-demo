# Difficulty System — UI Design Decisions

Date: 2026-05-21
Status: Locked, ready to implement
Companion to: [2026-05-21-difficulty-system-ui-spec.md](./2026-05-21-difficulty-system-ui-spec.md)

This doc records the UI design decisions made in the 2026-05-21 brainstorm. The spec's technical/logging/state decisions remain authoritative; this doc supersedes the spec's UI sections (§3.1, §3.2, §4.x) where they conflict.

## Decision summary

| # | Decision |
|---|---|
| 1 | Difficulty selection is a **pop-up modal**, NOT a new full screen |
| 2 | Modal appears AFTER `intro_transition.mp4` finishes — transition acts as a sensory preview that helps the child feel which level they want |
| 3 | Modal sits on top of `#screen-video` with the video dimmed (paused on first frame) as background |
| 4 | Modal content = title + 3 cards (same `event-card` pattern) + Continue button |
| 5 | Card labels = engineering names: **Protective / Normal / Challenge** (children may not read text; icons carry meaning, deferred) |
| 6 | Confirm flow: tap card → card highlights → Continue button enables → tap Continue → modal dismisses → video plays |
| 7 | Settings panel reuses the **existing `#fab-panel`** (anchored to `#fab-dot` gear in video controls); trigger unchanged |
| 8 | Panel contents change: drop the current Level row + Profile bars, replace with **8 per-channel rows** (same layout as dev A/B panel) |
| 9 | Each continuous-channel row: slider track with three reference marks — **P tick + baseline (★) + C tick** — and one draggable handle |
| 10 | Bucket channels (`spatial`, `prep_interval`) use the same slider form, snapping to 3 positions for visual consistency |
| 11 | Reset (↻) per row goes back to **baseline** (Stage 1 measured value), not to the selected difficulty level |
| 12 | No global level switcher inside the settings panel — difficulty is chosen once via the modal; settings panel is per-channel only |

## Flow diagram

```
Stage 1 → screen-processing → intro_transition.mp4
                                       ↓
                              screen-video (video paused, dimmed)
                                       ↓
                              [Difficulty modal pops up]
                                       ↓ (child taps card → Continue)
                              modal dismisses, dim lifts
                                       ↓
                              video plays
                                       ↓ (anytime during playback)
                              caregiver taps ⚙ → fab-panel opens with 8 per-channel sliders
```

## What the existing dev panel becomes

- **Dev A/B panel (`#dev-channel-panel`)**: unchanged, stays as a dev tool
- **fab-panel (`#fab-panel`)**: rewritten to be the production caregiver settings panel; matches dev panel's row structure but adds baseline/P/C tick marks

## Deferred (细节之后再说)

- Card iconography on the difficulty modal (placeholder colored circles or simple shapes for v1)
- Tick mark colors and exact pixel positions
- Modal entrance/exit animation
- Settings panel title/header text change ("A/B sliders (Dev)" → ?)
- Sensory profile bars (currently in fab-panel): drop for now; revisit if caregiver still wants the readout

## Implementation phases

- **Phase A** — data layer: `state.difficultyLevel`, `difficultyMeta`, `condition_contaminated`, `computeLevelValue()`, `getEffectiveChannelValue()`, hook into `applyVideoPreferences()`
- **Phase B** — difficulty pop-up modal: markup, styling, transition→modal trigger, card selection + Continue, dismiss + video play
- **Phase C** — fab-panel refactor: replace contents with 8 per-channel rows, baseline+P+C tick rendering, drag handlers, reset-to-baseline
- **Phase D** — logging: `difficulty` block in session export, `manual_adjustments` tracking, `condition_contaminated` flag

Each phase verifiable end-to-end before moving to the next.

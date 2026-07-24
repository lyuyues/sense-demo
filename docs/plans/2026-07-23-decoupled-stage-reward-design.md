# Decoupled Stage Reward — Design

> 2026-07-23. Status: agreed, implementing. Supersedes the navigation-gated
> trigger in `docs/plans/2026-07-16-stage-reward-design.md` — everything else
> in that doc (preset/generated item, collection bar, idempotence via
> `rewardsAwarded`, sound) is unchanged.

## Problem

`setCanvasSubPhase()` (app.js:1019-1036) gated **every** stage-leaving action —
Next, phase-tab click, Back — behind the reward-award animation whenever
`rewardPending(leavingStage)` was true. Two symptoms Yue reported:

1. Reward timing was unpredictable: it only ever appeared bundled into
   whatever navigation action happened to leave the stage, with no
   independent signal of its own.
2. Because `rewardsAwarded` is idempotent (one shot per stage), a stray
   tab-tap to peek at another stage consumed that stage's only reward before
   the child had actually engaged with it.

## Fix

**Navigation and reward are now fully decoupled.**

1. Remove the reward-gate block from `setCanvasSubPhase` entirely. Next / tab
   / Back become pure navigation — no interception, no awaiting an animation.
2. Reuse the existing per-stage dwell timer (`STAGE_TIME_LIMITS`, previously
   only used to nudge the Next button), but track it as **cumulative dwell
   time**: time only counts while that sub-phase is the active one, pauses on
   leave, and resumes on return (does not reset on a tab bounce). `light` gets
   a limit added (`60s`) since it previously had none.
3. When cumulative dwell reaches the limit **and** the stage hasn't been
   collected yet, two things appear together: the existing Next-button nudge
   ("Ready? →", unchanged) and a new standalone **🎁 Collect** button next to
   the reward bar. Clicking it calls `awardRewardFor(stageId)` directly — the
   fly-to-bar animation plays in place, on the current stage, no navigation
   happens.
4. `animate` (drum) stage is untouched: its reward already fires from
   `finishDrum()` completion (app.js:4690), not from navigation, and already
   matches this decoupled pattern. `STAGE_TIME_LIMITS.animate` stays `0`
   (dwell timer skipped).

## Consequence accepted (research-design change)

The 2026-07-16 doc's non-contingent-reward section asserted "every stage
guarantees one item, even if the child does nothing." That guarantee is now
**removed**. If a child navigates away before the dwell threshold is reached,
or reaches it but never taps 🎁, that stage's reward is never collected — the
collection bar can end with fewer than 5 items.

Confirmed acceptable: `rewardsAwarded.size` is not read anywhere for gating
(checked via grep) — it only feeds the cosmetic bar-fill animation, so an
empty slot has no functional impact on the video-unlock flow. The reward
remains non-contingent on *performance* (nothing is scored), just no longer
guaranteed regardless of *engagement*.

## Files touched

| file | change |
|---|---|
| `app.js` | remove reward-gate in `setCanvasSubPhase`; `STAGE_TIME_LIMITS.light = 60`; `state.stageDwellMs` cumulative tracking in `startStageTimer`/`clearStageTimer`; new `showRewardCollectButton()`/`hideRewardCollectButton()`; new `#btn-collect-reward` click handler; remove now-dead `rewardPending()` |
| `index.html` | new `#btn-collect-reward` button in `.canvas-topbar`, next to `#reward-bar` |
| `style.css` | `.btn-collect-reward` styling (pop/attention state to match `.nudge`) |

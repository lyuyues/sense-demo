# SENSE Web Demo

Tablet-based research probe for personalizing anticipatory sensory preparation.
Live: https://lyuyues.github.io/sense-demo/ (auto-deployed from `main` via GitHub Pages, ~1 min after push).

## Per-stage reward

Each of the 5 canvas stages awards one collectible into the bar above the tabs.
The caregiver picks it on the welcome screen: one of 8 presets, or free text →
Imagen via `/api/generate-sticker`. Design + rationale:
`docs/plans/2026-07-16-stage-reward-design.md`.

Two things to know before touching it:

- **The award is unconditional.** Leaving a stage is the whole condition — it is
  never scored on what the child made. SENSE elicits preferences and no stage has
  a right answer; a contingent-looking reward makes children optimise for the
  reward instead of revealing a preference. Doing nothing still earns the item.
- **Text generation is local-only.** `API_BASE` is `''` on GitHub Pages, so
  custom items need `server.py`. Presets are static PNGs and always work; any
  failure falls back to the star.
- **The celebration makes a sound** (`playRewardChime` / `playRewardLand`, both
  synthesized). It is an uncontrolled sound at a stage boundary, and the Sound
  stage is where auditory preferences are elicited — so it is deliberately kept
  identical at all five boundaries and fires only after the stage's data is
  captured, making it a constant rather than a per-channel variable. If a pilot
  shows children reacting to it, mute it there before reading anything into the
  auditory data.

Regenerate the presets (only needed if the style changes):

```bash
GEMINI_API_KEY=... python3 generate_reward_presets.py --force
```

## Per-event media architecture

Each scenario (`state.eventType`) drives its own **priming video** and **3 audio stems**.

### Videos (`VIDEO_BY_EVENT` in `app.js`)
| event    | file                       |
|----------|----------------------------|
| dental   | `video/dental.mp4`         |
| grocery  | `video/grocery.mp4`        |
| dining   | `video/dining.mp4`         |
| (default)| `video/birthday_party.mp4` |

Event `.mp4`s carry **no audio track** — all audio comes from stems. Recompress large
renders before committing (dental was 64MB→5.6MB via `ffmpeg -i in.mp4 -c:v libx264 -crf 23 -an out.mp4`;
cartoon content compresses extremely well).

### Audio stems (`STEM_FILES_BY_EVENT` in `app.js`)
Each event needs 3 stems keyed `voice` / `bgm` / `sfx` — the 3 independently-adjustable
auditory channels, mixed through a shared lowpass for auditory personalization.

Naming convention (files live in `video/`, names must match **exactly**):
- **birthday**: `vocals.wav` / `bgm.wav` / `drums.wav` (Demucs output)
- **others**: `{event}_{stem}.m4a` —
  - `dental_voice.m4a`, `dental_bgm.m4a`, `dental_sfx.m4a`
  - `grocery_voice.m4a`, `grocery_bgm.m4a`, `grocery_sfx.m4a`
  - `dining_voice.m4a`, `dining_bgm.m4a`, `dining_sfx.m4a`

Source stems come as `dialogue` / `bgm` / `env` per event → renamed to the demo's
channel keys: **dialogue→voice, bgm→bgm, env→sfx**.

Each stem's duration should match its video (stems start at the video offset and are cut
when the video ends). Missing files 404 gracefully → that channel is silent.
`decodeAudioData` accepts `.m4a`/`.wav`/`.mp3`/`.m4a` — change the extensions in
`STEM_FILES_BY_EVENT` if the format changes.

## Two-machine workflow

- **Dev machine**: edits `app.js`/`index.html`, commits videos. Bump the `app.js?v=NNN`
  cache-bust in `index.html` whenever `app.js` changes.
- **Audio machine**: produces the 9 stem `.wav`s and pushes them —
  ```bash
  git pull origin main                 # get latest code + videos (fast-forward)
  # drop the named .wav files into video/
  git add video/*_voice.wav video/*_bgm.wav video/*_sfx.wav
  git commit -m "feat: add 3-stem audio for <events>"
  git push origin main
  ```
  Confirm the working tree has no un-committed `app.js`/`index.html` edits before pulling.

## Audio credits

Per-event background music (`{event}_bgm.m4a`), trimmed to each video's length and
mixed to background level (~-25 dB), by **Kevin MacLeod** (incompetech.com),
licensed under **Creative Commons Attribution 4.0**:
- grocery — "Local Forecast - Elevator"
- dining — "Bossa Antigua"
- dental — "Healing"

Voice/SFX stems are separated from the Veo renders; bgm above replaces the generic
Veo music per scenario.

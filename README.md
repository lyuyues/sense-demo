# SENSE Web Demo

Tablet-based research probe for personalizing anticipatory sensory preparation.
Live: https://lyuyues.github.io/sense-demo/ (auto-deployed from `main` via GitHub Pages, ~1 min after push).

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
- **others**: `{event}_{stem}.flac` —
  - `dental_voice.flac`, `dental_bgm.flac`, `dental_sfx.flac`
  - `grocery_voice.flac`, `grocery_bgm.flac`, `grocery_sfx.flac`
  - `dining_voice.flac`, `dining_bgm.flac`, `dining_sfx.flac`

Source stems come as `dialogue` / `bgm` / `env` per event → renamed to the demo's
channel keys: **dialogue→voice, bgm→bgm, env→sfx**.

Each stem's duration should match its video (stems start at the video offset and are cut
when the video ends). Missing files 404 gracefully → that channel is silent.
`decodeAudioData` accepts `.flac`/`.wav`/`.mp3`/`.m4a` — change the extensions in
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

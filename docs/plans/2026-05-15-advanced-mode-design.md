# SENSE Demo — Advanced Mode Design

**Date**: 2026-05-15
**Status**: Design (pre-implementation)
**Owner**: Yue Lyu
**Scope marker**: 🧪 Exploratory side-track. NOT on the research-critical path.

---

## 0. Status & Priority

- **Normal Mode** (preset scenes + 4-channel personalization) is the **research demo**. It must stay untouched and behaviorally identical.
- **Advanced Mode** is a separate exploration of "what if `define` becomes generative." It is **additive** to the codebase. If Advanced Mode breaks, Normal Mode still works.
- Verification gate: before merging Advanced Mode, the 6 existing preset scenes must play end-to-end with zero behavioral diff.

---

## 1. Mental Model

Current demo has two layers:

```
DEFINE  (templates/*.json, hand-authored)
   ↓
PLAYBACK (interactive scene + priming video + 4-channel sliders)
```

Advanced Mode swaps `DEFINE` from hand-authored to generated:

```
Normal:    hand-written JSON         →┐
                                       ├→ PLAYBACK (unchanged)
Advanced:  photo + event → 6-step gen →┘
```

The playback layer never knows which path produced its inputs.

---

## 2. Isolation Boundaries

### Shared (one codebase, both modes use)
- Playback code in `app.js` (interactive scene rendering, slider logic)
- 4-channel personalization (saturation / prep interval / etc.)
- Video player + audio sync
- JSON schema (the shape of `templates/*.json`)
- Existing Nano Banana / Imagen utilities in `generate_assets.py`

### Owned by Normal Mode (Advanced never touches)
- `templates/birthday.json` `templates/dental.json` … (6 presets)
- `assets/<preset>_*.png` (hand-curated)
- `video/birthday_party.mp4` `video/base_*.mp4` (pre-rendered)
- Preset picker UI in `index.html`

### Owned by Advanced Mode (Normal never depends on)
- `advanced/` Python module (new): scenario generator, asset generator, video generator, orchestrator
- `templates/custom_<ts>.json` (generated, namespaced with `custom_` prefix)
- `assets/custom_<ts>/*.png` (generated, in subfolder)
- `video/custom_<ts>.mp4` (generated)
- Advanced panel UI in `index.html` (collapsed by default, toggle to open)
- Server endpoints under `/advanced/*` prefix
- `advanced/call_log.jsonl` (separate audit log)

### Contract between them
- Advanced Mode produces **bit-identical-shape outputs** to Normal Mode. Same JSON fields, same asset naming pattern, same mp4 location convention. Playback consumes both via the same code path.
- Filename namespacing (`custom_<ts>` prefix) makes generated artifacts trivially deletable without touching presets.

---

## 3. User Flow

```
[Demo homepage]
  ┌─────────────────────────────────────────┐
  │ Normal Mode (default)                   │
  │  • 6 preset scene tiles                 │
  │  • Click → loads template → playback    │
  ├─────────────────────────────────────────┤
  │ Advanced Mode 🧪 [toggle, collapsed]    │
  │   1. Upload photo                       │
  │   2. Type event (free-text)             │
  │   3. Click "Generate Scenario"          │
  │        → progress: gen scenario_spec    │
  │   4. Review/edit scenario_spec          │
  │        (script, characters, elements)   │
  │   5. Click "Generate Assets"            │
  │        → progress: NB calls (per item)  │
  │   6. Review/swap individual assets      │
  │        (regenerate single element)      │
  │   7. (Optional) Customize sound         │
  │   8. Click "Generate Video"             │
  │        → confirm prompt + quota         │
  │        → Veo Light call                 │
  │   9. Click "Play in Demo"               │
  │        → loads as if it were preset #7  │
  └─────────────────────────────────────────┘
```

Each generate step has a Cancel button. State persists across steps; user can leave and resume.

---

## 4. The 6-Step Pipeline

### Step 1 — Scenario Spec Generation

```python
# advanced/step1_scenario.py
def generate_scenario_spec(photo_path: Path, event_text: str) -> dict:
    """
    Inputs: user photo + free-text event
    Calls: Gemini Vision (analyzes photo + event)
    Returns: scenario_spec dict matching the extended template schema
    """
```

**LLM**: `gemini-2.5-pro` (or current best vision model). Output constrained via JSON schema.

**Output schema** (extends the existing template schema):
```json
{
  "id": "custom_<ts>",
  "name": "<auto from event_text>",
  "icon": "🧪",
  "backgroundImage": "assets/custom_<ts>/bg.png",
  "background": { "shapes": [ ... ] },
  "elements": [ ... ],
  "animations": { ... },

  // Advanced-only extensions (Normal mode ignores these)
  "_generated": {
    "script": ["Step 1: 进门", "Step 2: 看到牙医", ...],
    "phases": [{"t": 0, "phase": "approach", "duration": 3}, ...],
    "characters": [{"role": "dentist", "description": "..."}],
    "sound_design": {"ambient": "...", "voices": [...]},
    "markers": [{"t": 2.5, "sub_dim": "saturation", "value": 0.6}, ...],
    "veo_prompt": "<filled in Step 5>",
    "source_photo": "uploads/photo_<ts>.jpg",
    "source_event": "<original user text>"
  }
}
```

The `_generated` block is purely for Advanced-mode tooling (regeneration, audit). Playback ignores keys it doesn't know.

### Step 2 — Element Assets

```python
# advanced/step2_elements.py
def generate_element_assets(spec: dict, out_dir: Path) -> dict:
    """
    For each element in spec.elements:
      → Nano Banana call: style_anchor=classroom_crayon.png + friend1.png,
                          content prompt from element.description
      → save to out_dir/<element.id>.png
    """
```

Reuses the validated crayon recipe ([reference](../../../Research/.claude/memory/...)) — multi-image with style anchors `classroom_crayon.png` + `friend1.png`.

### Step 3 — Background

```python
# advanced/step3_background.py
def stylize_background(photo_path: Path, scene_desc: str, out_path: Path):
    """
    Nano Banana: style_anchor=classroom_crayon.png + user_photo,
                 prompt="OTS view of child entering <scene_desc>, crayon style"
    """
```

**Key choice**: the background is regenerated in crayon style with the photo as content anchor — preserves environmental cues without photo-realism clashing with the rest of demo style.

### Step 4 — Human review (no code generation, UI only)

User can:
- Regenerate single element (re-call Step 2 for one id)
- Edit script lines / phase timings (text inputs)
- Swap sound (file picker or record)
- Skip if scenario looks OK

### Step 5 — Veo Prompt + Markers

```python
# advanced/step5_veo_prompt.py
def build_veo_prompt(spec: dict) -> tuple[str, list[dict]]:
    """
    Inputs: finalized scenario_spec
    Returns: (veo_prompt_text, frame_markers)

    Prompt template enforces:
      - First-person POV (per feedback_video_pov_rule)
      - OTS arc-in at start, then through-to-POV
      - Environment abstract beyond procedure-relevant items
      - Crayon style cue
    """
```

The prompt template lives in `advanced/prompts.py` (per `feedback_prompt_sync_to_code`).

### Step 6 — Veo Video

```python
# advanced/step6_video.py
def generate_video(spec: dict, prompt: str, first_frame: Path, out_path: Path):
    """
    Veo Light (veo-2.0-generate-001), image-to-video
    First frame = generated bg.png
    Logs to advanced/call_log.jsonl (per feedback_log_api_call_message)
    Requires explicit user confirmation in UI (per feedback_veo_generation_consent)
    """
```

---

## 5. Backend: Server Endpoints

All under `/advanced/*` prefix. Existing `/convert`, `/generate-sticker`, etc. unchanged.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/advanced/upload-photo` | Save photo to `uploads/photo_<ts>.jpg` |
| `POST` | `/advanced/scenario` | Step 1: photo+event → scenario_spec JSON |
| `POST` | `/advanced/regen-element` | Step 4 helper: regenerate one element asset |
| `POST` | `/advanced/assets` | Step 2+3: generate all element + bg assets |
| `POST` | `/advanced/video` | Step 5+6: build Veo prompt + generate video |
| `GET`  | `/advanced/jobs/<id>` | Poll progress for long-running gen jobs |
| `GET`  | `/advanced/log` | Read `call_log.jsonl` for audit |

Each long-running endpoint returns a `job_id`; frontend polls `/advanced/jobs/<id>` every 2s.

---

## 6. Frontend Changes

### `index.html`
- Add mode toggle at top: `[Normal] [Advanced 🧪]`
- Add `<section id="advanced-panel" hidden>` block containing the 8-step UI
- Advanced panel hidden by default; toggle reveals
- When Advanced playback starts, it reuses the existing scene/video components — no separate playback DOM

### `app.js`
- New module `advanced.js` (separate file, ~600 LOC)
- `advanced.js` imports from `app.js` ONLY the playback bootstrap function
- `app.js` itself unchanged

### Files
```
web-demo/
├── advanced.js          (new)
├── advanced/            (new Python module)
│   ├── __init__.py
│   ├── step1_scenario.py
│   ├── step2_elements.py
│   ├── step3_background.py
│   ├── step5_veo_prompt.py
│   ├── step6_video.py
│   ├── prompts.py       (prompt templates, code-of-truth)
│   ├── orchestrator.py  (job runner + state)
│   └── call_log.jsonl   (audit, gitignored)
├── uploads/             (new, gitignored)
├── templates/custom_*.json   (gitignored)
├── assets/custom_*/          (gitignored)
└── video/custom_*.mp4        (gitignored)
```

Gitignore prevents generated artifacts from polluting the repo.

---

## 7. Independent Testing

Three test surfaces, no shared state with Normal Mode:

```bash
# 7a. Single-step CLI (fastest iteration, no quota burn except for the tested step)
python -m advanced.step1_scenario --photo demo.jpg --event "dentist" --out spec.json
python -m advanced.step2_elements --spec spec.json --out-dir assets/test/

# 7b. Full pipeline CLI (no browser needed)
python -m advanced.pipeline --photo demo.jpg --event "dentist" --out-dir out/

# 7c. Browser: open demo, toggle to Advanced, run normally
```

Each step writes intermediate artifacts to disk, so failures are debuggable. The CLI form (7b) is exactly the same code path as the browser form — `orchestrator.py` is the single entry point.

**Smoke test for Normal-Mode isolation**:
```bash
# Run all 6 preset scenes after every Advanced-Mode change
python tests/smoke_normal_mode.py
```

---

## 8. Quota & Cost Budget

| Pipeline run | API calls | Cost (rough) |
|---|---|---|
| Step 1 (Gemini Vision) | 1 | ~$0.01 |
| Step 2 (Nano Banana × elements) | 3-6 | ~$0.06-0.12 |
| Step 3 (Nano Banana × bg) | 1 | ~$0.02 |
| Step 5+6 (Veo Light) | 1 | ~$0.40-1.50 |
| **Total per scenario** | ~6-9 calls | **~$0.50-1.65** |

- Veo Light (`veo-2.0-generate-001`) quota is **TBD** — check Vertex AI dashboard before deploying. Track separately from Veo 3 quota (`reference_veo_quota`).
- Every Veo call gates on UI confirmation (`feedback_veo_generation_consent`).
- All calls logged to `call_log.jsonl` (`feedback_log_api_call_message`).

---

## 9. Open Questions

1. **`scenario_spec.markers` semantics** — should these auto-set the 4-channel sliders when scenario loads, or just be suggestions the user can override? Default: load as suggestions, user can ignore.
2. **Sound generation in Step 4** — generate via Gemini audio? Pre-built library? Record-your-own? Defer until first iteration ships.
3. **Element regeneration on review** — single element re-call vs full batch? Single-element is ~10x cheaper but needs UI plumbing. Start with single.
4. **Multi-shot photo input** — user uploads multiple angles of the room? V1 is single-photo; revisit if scene quality is poor.
5. **Veo 2 quota numbers** — confirm before first run.

---

## 10. Out of Scope (v1)

- Sound generation (use existing demo audio library; user can swap manually)
- Saving custom scenarios to a permanent library (everything is `custom_<ts>` ephemeral; clean up manually for now)
- Editing the `_generated.markers` timing visually (text-only edit in v1)
- Multi-character scenes beyond 3 friends + 1 caregiver figure
- Mobile/tablet responsive layout for Advanced panel (desktop-only)

---

## 11. Code Volume Estimate

| Module | New LOC |
|---|---|
| `advanced/step*.py` (6 files) | ~600 |
| `advanced/orchestrator.py` | ~200 |
| `advanced/prompts.py` | ~150 |
| `server.py` (new endpoints) | ~150 |
| `advanced.js` (frontend) | ~550 |
| `index.html` (Advanced panel markup) | ~80 |
| Tests + smoke checks | ~150 |
| **Total** | **~1,880** |

Reference: current demo is ~7,100 LOC. Advanced Mode adds ~26%, but **0 LOC changed in existing playback code**.

---

## 12. Implementation Order (suggested)

1. **Foundation**: `advanced/` module skeleton, `prompts.py`, `call_log.jsonl` plumbing
2. **Step 1 only**: Gemini Vision → `scenario_spec` JSON, CLI testable
3. **Step 2+3**: Nano Banana asset gen, CLI testable
4. **Step 5+6**: Veo prompt + Veo Light call, CLI testable
5. **Frontend Advanced panel**: minimal UI (upload, event, generate, play)
6. **Polish**: regenerate single element, edit scenario, progress states
7. **Smoke test**: verify all 6 preset scenes still work

Each step is independently shippable; user can stop at any point and Normal Mode is still 100% intact.

---

**End of design.**

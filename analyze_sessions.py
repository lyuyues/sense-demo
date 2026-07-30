#!/usr/bin/env python3
"""Parse session_data/*.json (written by server.py's /api/save-session) into
a per-session summary table and a long-format interaction-event table for the
SENSE evaluation.

Usage:
    python3 analyze_sessions.py [session_data_dir]

Outputs (written next to session_data_dir, default: session_data/):
    sessions_summary.csv   — one row per session
    interaction_events.csv — one row per logged interaction event
    phase_visits.csv       — one row per *visit* to a phase/sub-phase (handles revisits)
    watched_ms_hist.png, pause_count_by_event.png — quick sanity plots

Each session can produce a few files sharing the same sessionId: stage1 at
the elicitation->video boundary, skip if the caregiver bailed out of
elicitation early (mutually exclusive with stage1 — a session gets one or
the other, never both), video-progress autosaved every ~10s while the video
plays (a safety net for a session abandoned mid-video), stage2 on the
video's natural end, and wrapup once the child answers the readiness
question after the video. All of these overwrite the same filename per
session (exportStage in the name), so there's at most one of each on disk.
Only the most complete one per session is used for the summary row —
priority is wrapup > stage2 > video-progress > skip/stage1, since
interactionLog is cumulative and each later checkpoint is a strict superset
of the ones before it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

STAGE_PRIORITY = {"wrapup": 4, "stage2": 3, "video-progress": 2, "skip": 1, "stage1": 0, "unknown": -1}


def load_sessions(session_dir: Path) -> list[dict]:
    """Return one JSON record per sessionId — the most complete stage available."""
    best: dict[str, dict] = {}
    for path in sorted(session_dir.glob("sense-session-*.json")):
        record = json.loads(path.read_text())
        sid = str(record.get("sessionId", path.stem))
        stage = record.get("exportStage", "unknown")
        record["_sourceFile"] = path.name
        current = best.get(sid)
        if current is None or STAGE_PRIORITY.get(stage, -1) > STAGE_PRIORITY.get(current.get("exportStage"), -1):
            best[sid] = record
    return list(best.values())


def build_summary_df(sessions: list[dict]) -> pd.DataFrame:
    """One row per session: elicitation preferences, difficulty choice, video playback stats."""
    rows = []
    for s in sessions:
        prefs = s.get("preferences") or {}
        phase_durations = s.get("phaseDurations") or {}
        difficulty = s.get("difficulty") or {}
        video = s.get("videoPlayback") or {}
        video_phase_ms = phase_durations.get("video", 0)

        row = {
            "session_id": s.get("sessionId"),
            "event_type": s.get("eventType"),
            "timestamp": s.get("timestamp"),
            "completed_video": s.get("exportStage") in ("stage2", "wrapup"),
            "export_stage": s.get("exportStage"),
            "total_duration_s": (s.get("totalDuration") or 0) / 1000,
            "video_phase_duration_s": video_phase_ms / 1000,
            "video_watched_s": (video.get("watchedMs") or 0) / 1000,
            "video_play_count": video.get("playCount", 0),
            "video_pause_count": video.get("pauseCount", 0),
            "video_seek_count": video.get("seekCount", 0),
            "difficulty_level": difficulty.get("level_selected"),
            "difficulty_selected_by": difficulty.get("selected_by"),
            "manual_adjustment_count": len(difficulty.get("manual_adjustments") or []),
            "condition_contaminated": s.get("condition_contaminated"),
            "element_count": len(s.get("placedElements") or []),
            "stroke_count": len(s.get("colorStrokes") or []),
        }
        # Flatten top-level preference scores: pref_visual, pref_auditory, ...
        for dim, val in prefs.items():
            if isinstance(val, dict) and "score" in val:
                row[f"pref_{dim}"] = val["score"]
        # Flatten phase durations: phase_photo_s, phase_canvas_s, ...
        for phase, ms in phase_durations.items():
            row[f"phase_{phase}_s"] = ms / 1000
        # Flatten canvas sub-phase durations: subphase_add-elements_s, ...
        for sub, ms in (s.get("subPhaseDurations") or {}).items():
            row[f"subphase_{sub}_s"] = ms / 1000

        # Watch ratio flags a session where the video was on-screen much longer
        # than it was actually playing (heavy pausing) — useful QA signal.
        # Always set (None if the video phase was never reached) so downstream
        # column selection doesn't KeyError on a session that never got there.
        row["watch_ratio"] = (
            row["video_watched_s"] / row["video_phase_duration_s"]
            if row["video_phase_duration_s"] > 0 else None
        )
        rows.append(row)

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("timestamp").reset_index(drop=True)
    return df


def build_events_df(sessions: list[dict]) -> pd.DataFrame:
    """Long format: one row per logged interaction event, across all sessions."""
    events = []
    for s in sessions:
        sid = s.get("sessionId")
        for e in s.get("interactionLog") or []:
            events.append({"session_id": sid, "event_type_top": s.get("eventType"), **e})
    if not events:
        return pd.DataFrame()
    df = pd.json_normalize(events)
    return df.sort_values(["session_id", "timestamp"]).reset_index(drop=True)


def build_visits_df(sessions: list[dict]) -> pd.DataFrame:
    """One row per *visit* to a phase or canvas sub-phase, reconstructed from
    consecutive phase_change/sub_phase_change timestamps in interactionLog.

    phaseDurations/subPhaseDurations only give a per-session total, collapsing
    a 40s first pass and a 2s accidental revisit into one number. This keeps
    them separate: each visit gets its own enter/exit/duration row, and
    visit_index (0, 1, 2...) says whether it's the first time or a revisit.
    A sub-phase visit is closed out either by the next sub_phase_change, or —
    for whichever sub-phase was active when 'canvas' is left (finishing
    'animate' or a caregiver skip) — by the enclosing phase_change, mirroring
    the goToPhase()/setCanvasSubPhase() bookkeeping in app.js.
    """
    rows = []
    for s in sessions:
        sid = s.get("sessionId")
        log = sorted(s.get("interactionLog") or [], key=lambda e: e.get("timestamp", 0))
        visit_counts: dict[tuple[str, str], int] = {}
        open_phase = None       # (name, enter_ts)
        open_subphase = None    # (name, enter_ts)
        in_canvas = False

        def close(level: str, name: str, enter_ts, exit_ts) -> None:
            key = (level, name)
            idx = visit_counts.get(key, 0)
            visit_counts[key] = idx + 1
            rows.append({
                "session_id": sid, "level": level, "name": name, "visit_index": idx,
                "enter_ts": enter_ts, "exit_ts": exit_ts,
                "duration_s": (exit_ts - enter_ts) / 1000 if exit_ts is not None else None,
            })

        for e in log:
            ts = e.get("timestamp")
            if e.get("event") == "phase_change":
                if open_subphase is not None and in_canvas:
                    close("subphase", open_subphase[0], open_subphase[1], ts)
                    open_subphase = None
                if open_phase is not None:
                    close("phase", open_phase[0], open_phase[1], ts)
                open_phase = (e.get("phase"), ts)
                in_canvas = e.get("phase") == "canvas"
            elif e.get("event") == "sub_phase_change":
                if open_subphase is not None:
                    close("subphase", open_subphase[0], open_subphase[1], ts)
                open_subphase = (e.get("subPhase"), ts)

        # Trailing open visits (session ended, or export happened) have no
        # closing event — record them with exit_ts=None rather than guessing.
        if open_subphase is not None:
            close("subphase", open_subphase[0], open_subphase[1], None)
        if open_phase is not None:
            close("phase", open_phase[0], open_phase[1], None)

    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values(["session_id", "enter_ts"]).reset_index(drop=True)


def print_report(summary_df: pd.DataFrame, events_df: pd.DataFrame, visits_df: pd.DataFrame | None = None) -> None:
    print(f"\n{len(summary_df)} session(s) loaded.\n")
    if summary_df.empty:
        return

    print("-- Completion --")
    print(summary_df["completed_video"].value_counts(dropna=False).to_string())

    print("\n-- Video playback (completed sessions only) --")
    completed = summary_df[summary_df["completed_video"]]
    if not completed.empty:
        print(completed[[
            "video_watched_s", "video_phase_duration_s", "watch_ratio",
            "video_play_count", "video_pause_count", "video_seek_count",
        ]].describe().to_string())

    pref_cols = [c for c in summary_df.columns if c.startswith("pref_")]
    if pref_cols:
        print("\n-- Elicited preference scores --")
        print(summary_df[pref_cols].describe().to_string())

    if not events_df.empty:
        print("\n-- Event frequency across all sessions --")
        print(events_df["event"].value_counts().to_string())

    if visits_df is not None and not visits_df.empty:
        revisits = visits_df[visits_df["visit_index"] > 0]
        print(f"\n-- Revisits -- ({len(revisits)} revisit(s) across {visits_df['session_id'].nunique()} session(s))")
        if not revisits.empty:
            print(revisits.groupby(["level", "name"])["duration_s"].describe().to_string())


def make_plots(summary_df: pd.DataFrame, events_df: pd.DataFrame, out_dir: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    completed = summary_df[summary_df["completed_video"]] if not summary_df.empty else summary_df
    if not completed.empty and completed["video_watched_s"].notna().any():
        fig, ax = plt.subplots(figsize=(5, 3.5))
        completed["video_watched_s"].plot.hist(ax=ax, bins=10)
        ax.set_xlabel("Watched time (s)")
        ax.set_title("Distribution of priming-video watch time")
        fig.tight_layout()
        fig.savefig(out_dir / "watched_ms_hist.png", dpi=150)
        plt.close(fig)

    if not events_df.empty:
        fig, ax = plt.subplots(figsize=(6, 4))
        events_df["event"].value_counts().plot.barh(ax=ax)
        ax.set_xlabel("Count")
        ax.set_title("Interaction event frequency")
        fig.tight_layout()
        fig.savefig(out_dir / "pause_count_by_event.png", dpi=150)
        plt.close(fig)


def main() -> None:
    session_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "session_data"
    if not session_dir.exists():
        print(f"No session_data directory at {session_dir} — run a session first.")
        return

    sessions = load_sessions(session_dir)
    summary_df = build_summary_df(sessions)
    events_df = build_events_df(sessions)
    visits_df = build_visits_df(sessions)

    print_report(summary_df, events_df, visits_df)

    summary_df.to_csv(session_dir / "sessions_summary.csv", index=False)
    events_df.to_csv(session_dir / "interaction_events.csv", index=False)
    visits_df.to_csv(session_dir / "phase_visits.csv", index=False)
    print(f"\nWrote {session_dir / 'sessions_summary.csv'}")
    print(f"Wrote {session_dir / 'interaction_events.csv'}")
    print(f"Wrote {session_dir / 'phase_visits.csv'}")

    if not summary_df.empty:
        make_plots(summary_df, events_df, session_dir)
        print(f"Wrote plots to {session_dir}/")


if __name__ == "__main__":
    main()

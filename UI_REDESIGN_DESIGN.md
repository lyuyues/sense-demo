# SENSE Web Demo — UI Redesign Design Doc

> Decided 2026-05-07. Source comparison: `style_comparison/index.html`.

## Goal

Lift the SENSE web demo from "flat SVG sticker" to **Google AI Quests / Pixar-grade game feel** without rewriting the engine. Target: 2-3 days of focused work.

## Decisions

### Visual style

| Surface | Style | Rationale |
|---|---|---|
| Avatar | **A1_outlined**: Pixar 3D + thick clean black outlines + cel-shaded fill | Compatible with `generateLineart()` for coloring; reads as 3D character in scene |
| Coloring stage | A1_outlined → `generateLineart()` (existing client-side pipeline) | Test-verified clean output; zero engine changes |
| Scene backgrounds | Pure A: stylized 3D Pixar render with depth, soft volumetric light | Cinematic, AI Quests-grade |
| Generated video | Pure A (Pixar 3D) | Final reveal — "bring your picture to life" |

**Eliminated**: B watercolor (too still), C crayon (kept as fallback if A pipeline fails), D flat vector (too SaaS-y).

### Architecture (path C, locked)

- **Keep** vanilla JS / current `app.js` core logic
- **Add** GSAP 3.12 (CDN) for: draggable elasticity, button springs, screen transitions, particle bursts
- **Add** Lottie-web 5.12 (CDN) for: avatar idle breathing, ambient scene motion (1-2 elements per scene)
- **Replace** all current SVG / emoji assets with Imagen-generated A-style PNGs
- **Replace** current CSS with new design system (tokens below)

**Not doing**: PixiJS / Phaser rewrite (path B), full SaaS polish only (path A).

## Design tokens

```css
/* Color — warm cinematic palette aligned with Pixar/AI Quests */
--bg-cream:        #faf6ef;
--bg-warm:         #fff4e3;
--ink-primary:     #2a2622;
--ink-muted:       #6b6357;
--accent-coral:    #ff7a59;   /* primary CTA */
--accent-butter:   #ffd166;   /* secondary highlights */
--accent-teal:     #4cb8a8;   /* success / completion */
--accent-rose:     #ec6b8e;   /* play / motion */
--surface-card:    #ffffff;
--surface-border:  #e8e0d2;

/* Typography */
--font-display: "Fraunces", "Source Serif Pro", Georgia, serif;  /* h1, big titles */
--font-ui:      "Inter", -apple-system, system-ui, sans-serif;   /* body, buttons */
--font-kid:     "Quicksand", "Comic Neue", system-ui, sans-serif; /* in-scene labels */

/* Shape */
--radius-card:   20px;
--radius-button: 14px;
--radius-pill:   999px;

/* Shadow — warm, soft, layered */
--shadow-rest:  0 2px 8px rgba(80, 50, 20, 0.06);
--shadow-hover: 0 8px 24px rgba(80, 50, 20, 0.12);
--shadow-press: 0 1px 3px rgba(80, 50, 20, 0.08);

/* Motion */
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);   /* overshoot snap */
--ease-soft:    cubic-bezier(0.22, 1, 0.36, 1);      /* settle */
--dur-fast:     180ms;
--dur-base:     320ms;
--dur-slow:     560ms;
```

## Animation contract (GSAP)

| Trigger | Effect | Library |
|---|---|---|
| Button press | scale 0.94 → 1.04 → 1 spring | GSAP |
| Card hover | y: -4 + shadow upgrade | CSS |
| Drag start | scale 1.08 + 3° random tilt | GSAP Draggable |
| Drag move | follow with 0.18s elastic lag | GSAP |
| Drag release (target hit) | snap + small particle burst | GSAP timeline |
| Drag release (miss) | bounce back to origin | GSAP |
| Screen transition | scale 0.98 → 1 + opacity, 320ms | GSAP timeline |
| Color stroke applied | 1-frame brightness pulse on stroke | CSS keyframe |
| Final reveal | 800ms slow zoom + soft glow | GSAP timeline |

## Lottie ambient set (minimum viable)

| Asset | Trigger | Notes |
|---|---|---|
| `avatar_breathe.json` | Always playing on avatar | Subtle 4s loop |
| `scene_party_balloons.json` | Loop in party scene | Float drift |
| `scene_school_leaves.json` | Loop in school scene | Tree leaves sway |
| `scene_grocery_steam.json` | Loop in grocery scene | Steam from bakery |
| `scene_dining_glow.json` | Loop in dining scene | Candle / lamp flicker |
| `confetti_burst.json` | One-shot on completion | Reward |

(If Lottie sourcing is slow, replace 1-2 with GSAP-only loops.)

## Asset regeneration list

### Avatars (A1_outlined recipe)
- 1 base full-body neutral pose
- 3-5 expression variants (happy, surprised, calm, focused) — optional v2

### Scenes (pure A pixar, 16:9)
- School entrance / classroom
- Dining (restaurant or family table)
- Grocery store
- Party / playground

### Props (transparent PNG, A style with outlines)
- Per-scene interactive elements (cake, balloon, ball, dog, cup, plate, etc.) — keep current sticker list, regenerate
- ~20 items total, ~$1 of Imagen credit

## File / module changes

| File | Change |
|---|---|
| `index.html` | Add GSAP + Lottie CDN; restructure header / phase tabs |
| `style.css` | Full rewrite around design tokens |
| `app.js` | **No core logic change**. Add GSAP wrapper for drag/buttons/transitions; add Lottie loaders |
| `assets/` | Regenerate per the asset list |
| `style_comparison/` | Keep as evidence |

## What this does NOT do

- No game engine
- No physics
- No new screens / interaction flows
- No backend changes
- No coloring algorithm changes (reuses `generateLineart()`)
- No video generation pipeline changes (Veo continues unchanged)

## Risk register

| Risk | Mitigation |
|---|---|
| A1_outlined consistency across many avatar generations | Lock seed + style suffix in prompt; review batch |
| Lottie file sourcing takes too long | Fall back to GSAP-only; ship without ambient on day 3 |
| GSAP Draggable conflicts with existing pointer handlers in `app.js` | Wrap GSAP at higher z-layer; touchevents stay on canvas |
| Generated video style drift from UI style | Pin Veo prompt to mirror Imagen style suffix |

## Next

Write implementation plan via `superpowers:writing-plans`.

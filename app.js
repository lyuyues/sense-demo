// ============================================================
// SENSE Canvas-Based Demo — app.js
// Complete rewrite: canvas + drag-drop + coloring + animate
// ============================================================

// --- State ---
const state = {
  phase: 'welcome',
  canvasSubPhase: 'place-self',
  eventType: null,
  template: null,
  childPhoto: null,
  scenePhoto: null,
  placedElements: [],
  colorStrokes: [],
  colorSelections: [],  // hexes the child tapped in the swatch carousel — the *preference* signal (selection ≠ stroke)
  animatedElements: new Set(),
  interactionLog: [],
  selectedColor: '#FF6B6B',
  brushSize: 2,
  isEraser: false,
  sessionStart: Date.now(),
  phaseStartTime: Date.now(),
  phaseDurations: {},
  // Audio
  audioCtx: null,
  gainNode: null,
  filterNode: null,
  oscillator: null,
  oscillator2: null,
  // Camera
  cameraStream: null,
  // Canvas drawing state
  painting: false,
  currentStroke: null,
  // AI agent
  stageScreenshots: {},
  aiObservation: null,
  // Light stage data
  lightData: null,
  // --- Difficulty system (Phase 2 customization layer) ---
  // null until child picks via difficulty modal. Engineering names match data column.
  difficultyLevel: null,              // 'protective' | 'normal' | 'challenge' | null
  difficultyMeta: {                    // logged in session export
    level_selected: null,
    selected_by: null,
    selected_at: null,
    baseline_per_channel: {},         // raw canvas-derived
    applied_per_channel: {},          // post-difficulty (pre-override)
    manual_adjustments: [],           // caregiver overrides during playback
  },
  condition_contaminated: false,       // flips true on first manual_adjustment
  baselinePerChannel: {},              // raw canvas-derived, populated when video screen opens
  appliedPerChannel: {},               // difficulty-shifted, recomputed on level change
};

// --- Animation map: element type → CSS animation name OR sprite frames ---
const ANIMATION_MAP = {
  friend: 'friendWave',
  speaker: 'speakerPulse',
  musicbox: 'speakerPulse',
  balloon: 'balloonFloat',
  cake: 'cakeGlow',
  present: 'presentShake',
  lights: 'lightsTwinkle',
  microphone: 'speakerPulse',
  bell: 'presentShake',
  lamp: 'cakeGlow',
  cloud: 'balloonFloat',
  music: 'speakerPulse',
  slide: null,
  swing: 'swingMotion',
  ball: 'ballBounce',
  dog: 'dogWag',
  bench: null,
  tree: 'treeSway',
};

// Sprite frame animations (AI-generated keyframes)
const SPRITE_FRAMES = {
  friend1: ['assets/friend1.png', 'assets/friend1_wave1.png', 'assets/friend1_wave2.png', 'assets/friend1_wave3.png'],
};

// Active sprite animations
const activeSpriteAnims = {};

function startSpriteAnimation(el, intervalMs) {
  const elId = el.id;
  // Find which sprite set to use based on the element's original asset
  const placed = state.placedElements.find(p => p.id === elId);
  if (!placed) return false;

  // Check if we have sprite frames for this element type+id
  // Extract original element id (e.g., "friend1" from "placed-friend1-1234567")
  const match = elId.match(/placed-(\w+)-/);
  if (!match) return false;
  const baseId = match[1];
  const frames = SPRITE_FRAMES[baseId];
  if (!frames || frames.length < 2) return false;

  // Stop existing animation
  stopSpriteAnimation(elId);

  let frameIdx = 0;
  const img = el.querySelector('img');
  if (!img) return false;

  // Preload all frames
  const cacheBust = Date.now();
  const frameUrls = frames.map(f => f + '?v=' + cacheBust);
  frameUrls.forEach(url => { const i = new Image(); i.src = url; });

  const tick = () => {
    frameIdx = (frameIdx + 1) % frameUrls.length;
    img.src = frameUrls[frameIdx];
  };

  const timer = setInterval(tick, intervalMs / frameUrls.length);
  activeSpriteAnims[elId] = timer;
  return true;
}

function stopSpriteAnimation(elId) {
  if (activeSpriteAnims[elId]) {
    clearInterval(activeSpriteAnims[elId]);
    delete activeSpriteAnims[elId];
  }
}

function stopAllSpriteAnimations() {
  Object.keys(activeSpriteAnims).forEach(id => stopSpriteAnimation(id));
}

// --- Sub-phase config ---
const SUB_PHASES = [
  { id: 'place-self', instruction: '', dotIndex: 0 },
  { id: 'add-elements', instruction: 'Add friends and things!', dotIndex: 0 },
  { id: 'color', instruction: 'Color your picture!', dotIndex: 1 },
  { id: 'light', instruction: 'Move the sun across the sky!', dotIndex: 2 },
  { id: 'sound-studio', instruction: 'Create your soundscape!', dotIndex: 3 },
  { id: 'animate', instruction: 'Drum time!', dotIndex: 4 },
];

// ============================================================
// LOGGING
// ============================================================
function logEvent(event, data = {}) {
  state.interactionLog.push({
    timestamp: Date.now(),
    elapsed: Date.now() - state.sessionStart,
    phase: state.phase,
    subPhase: state.canvasSubPhase,
    event,
    ...data,
  });
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================
function goToPhase(phase) {
  // Record duration of previous phase
  const now = Date.now();
  state.phaseDurations[state.phase] = (state.phaseDurations[state.phase] || 0) + (now - state.phaseStartTime);
  state.phaseStartTime = now;

  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active', 'fade-in');
  });
  const screen = document.getElementById(`screen-${phase}`);
  if (screen) {
    screen.classList.add('active', 'fade-in');
  }
  state.phase = phase;
  logEvent('phase_change', { phase });

  // Phase-specific init
  if (phase === 'photo') initPhotoScreen();
  if (phase === 'canvas') initCanvasScreen();
  if (phase === 'processing') {
    runProcessing();
    // Auto-download behavior data once per session at Stage 1 -> Stage 2 boundary
    if (!state.dataExported) {
      state.dataExported = true;
      try { exportData(); } catch (e) { console.warn('Auto-export failed:', e); }
    }
  }
  // drum is now a canvas sub-phase, not a separate screen
  if (phase === 'transition') {
    runTransition();
  }
  if (phase === 'video') {
    // Clean up canvas state
    stopAllSpriteAnimations();
    const cc = document.getElementById('canvas-container');
    if (cc) { cc.style.transform = ''; cc.style.filter = ''; }
    initVideoPlayer();
  }
  if (phase === 'wrapup') {
    initWrapupScreen();
  }
}

// ============================================================
// MAGIC TRANSITION (phase 1 → phase 2)
// ============================================================
function runTransition() {
  const video = document.getElementById('transition-video');
  if (!video) { goToPhase('video'); return; }
  // Reset
  try { video.currentTime = 0; } catch (e) {}
  video.muted = true; // autoplay-safe on iOS
  const goNext = () => {
    video.onended = null;
    video.ontimeupdate = null;
    goToPhase('video');
  };
  video.onended = goNext;
  // Safety net: if 'ended' doesn't fire (some iPad cases), advance after duration + buffer
  video.ontimeupdate = () => {
    if (video.duration && video.currentTime >= video.duration - 0.05) goNext();
  };
  const playPromise = video.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(err => {
      console.warn('Transition video play failed, advancing immediately:', err);
      goNext();
    });
  }
  // Hard timeout in case nothing fires (corrupt file, etc.)
  setTimeout(() => {
    if (state.phase === 'transition') goNext();
  }, 12000);
}

// ============================================================
// WELCOME SCREEN
// ============================================================
document.getElementById('btn-start').addEventListener('click', () => {
  // Try to enter fullscreen (works on iPad Safari if added to home screen)
  const el = document.documentElement;
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  }
  goToPhase('photo');
});

// Drum back button
document.getElementById('btn-drum-back')?.addEventListener('click', () => {
  goToPhase('canvas');
});

// AI agent uses server-side Gemini key — no client-side key needed

document.getElementById('btn-skip').addEventListener('click', () => {
  // Skip photo, use test avatar, go to event selection
  state.childPhoto = 'assets/test_avatar.png?v=' + Date.now();
  goToPhase('event');
});

// Dev: skip straight to phase 2 (video player). Uses default 0.5 preference scores
// because no elicitation data is collected.
document.getElementById('btn-skip-to-video')?.addEventListener('click', () => {
  state.childPhoto = 'assets/test_avatar.png?v=' + Date.now();
  state.eventType = 'grocery';
  state.dataExported = true; // suppress export-on-processing
  goToPhase('video');
});

// Dev: skip straight to wrap-up screen (Screen 7).
// Use 'birthday' to match the currently-deployed test video so the wrap-up title fits.
document.getElementById('btn-skip-to-wrapup')?.addEventListener('click', () => {
  state.childPhoto = 'assets/test_avatar.png?v=' + Date.now();
  state.eventType = 'birthday';
  state.dataExported = true;
  goToPhase('wrapup');
});

// ============================================================
// PHOTO CAPTURE SCREEN
// ============================================================
async function initPhotoScreen() {
  const hint = document.getElementById('photo-step-child').querySelector('.photo-prompt');
  try {
    hint.textContent = 'Requesting camera...';
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    const preview = document.getElementById('camera-preview');
    preview.srcObject = state.cameraStream;
    preview.onloadedmetadata = () => preview.play();
    hint.textContent = 'Take a photo of yourself!';
  } catch (e) {
    hint.textContent = 'Camera not available: ' + e.message;
    console.warn('Camera error:', e);
  }
}

function captureFrame(targetKey) {
  const video = document.getElementById('camera-preview');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
  }
}

document.getElementById('btn-capture-child').addEventListener('click', () => {
  state.childPhoto = captureFrame();
  const thumb = document.getElementById('preview-child');
  thumb.src = state.childPhoto;
  thumb.classList.remove('placeholder');
  thumb.classList.add('captured');

  // Switch to scene capture
  document.getElementById('photo-step-child').classList.add('hidden');
  document.getElementById('photo-step-scene').classList.remove('hidden');

  // Try switching to rear camera
  switchToRearCamera();
});

async function switchToRearCamera() {
  try {
    stopCamera();
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    document.getElementById('camera-preview').srcObject = state.cameraStream;
  } catch (e) {
    console.warn('Rear camera not available:', e);
  }
}

document.getElementById('btn-capture-scene').addEventListener('click', () => {
  state.scenePhoto = captureFrame();
  const thumb = document.getElementById('preview-scene');
  thumb.src = state.scenePhoto;
  thumb.classList.remove('placeholder');
  thumb.classList.add('captured');

  document.getElementById('btn-photo-next').disabled = false;
});

// API server for photo conversion (local dev or same origin)
const API_BASE = location.hostname === 'localhost' || location.hostname.startsWith('192.168')
  ? location.origin
  : ''; // On GitHub Pages, no conversion available

document.getElementById('btn-photo-next').addEventListener('click', async () => {
  stopCamera();

  // Show processing state
  const btn = document.getElementById('btn-photo-next');
  btn.textContent = 'Converting...';
  btn.disabled = true;

  // Convert child photo to crayon avatar
  if (state.childPhoto && API_BASE) {
    try {
      const resp = await fetch(API_BASE + '/api/convert-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.childPhoto }),
      });
      const data = await resp.json();
      if (data.image) state.childPhoto = data.image;
    } catch (e) {
      console.warn('Avatar conversion failed, using original photo:', e);
    }
    // Pre-generate the "Color me!" lineart in the background so it's ready by
    // the time the child reaches the Color stage. Doesn't block the UI.
    if (state.childPhoto && !state.childPhoto.includes('test_avatar')) {
      state._lineartPromise = generateLineartViaApi(state.childPhoto)
        .then(url => { state.childAvatarLineart = url; return url; })
        .catch(e => { console.warn('Pre-generate lineart failed:', e); return null; });
    }
  }

  // Convert scene photo to crayon background
  if (state.scenePhoto && API_BASE) {
    try {
      const resp = await fetch(API_BASE + '/api/convert-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.scenePhoto }),
      });
      const data = await resp.json();
      if (data.image) state.scenePhoto = data.image;
    } catch (e) {
      console.warn('Background conversion failed, using original photo:', e);
    }
  }

  btn.textContent = 'Next';
  btn.disabled = false;
  goToPhase('event');
});

document.getElementById('btn-photo-skip').addEventListener('click', async () => {
  stopCamera();

  // If child photo was taken, still convert it
  if (state.childPhoto && API_BASE) {
    const btn = document.getElementById('btn-photo-skip');
    btn.textContent = 'Converting...';
    try {
      const resp = await fetch(API_BASE + '/api/convert-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.childPhoto }),
      });
      const data = await resp.json();
      if (data.image) state.childPhoto = data.image;
    } catch (e) {
      console.warn('Avatar conversion failed:', e);
    }
    btn.textContent = 'Skip';
    // Pre-generate the lineart in the background (non-blocking)
    if (state.childPhoto && !state.childPhoto.includes('test_avatar')) {
      state._lineartPromise = generateLineartViaApi(state.childPhoto)
        .then(url => { state.childAvatarLineart = url; return url; })
        .catch(e => { console.warn('Pre-generate lineart failed:', e); return null; });
    }
  }

  goToPhase('event');
});

// ============================================================
// EVENT SELECTION SCREEN
// ============================================================
document.querySelectorAll('.event-card').forEach(card => {
  card.addEventListener('click', () => {
    const eventId = card.dataset.event;
    document.querySelectorAll('.event-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.eventType = eventId;
    loadTemplate(eventId).then(() => {
      goToPhase('canvas');
    });
  });
});

async function loadTemplate(eventId) {
  try {
    const resp = await fetch(`templates/${eventId}.json?v=${Date.now()}`);
    state.template = await resp.json();
  } catch (e) {
    console.error('Failed to load template:', e);
    // Fallback minimal template
    state.template = {
      id: eventId,
      background: { shapes: [] },
      elements: [],
      animations: {},
    };
  }
}

// ============================================================
// CANVAS SCREEN
// ============================================================
function initCanvasScreen() {
  const container = document.getElementById('canvas-container');
  const bgCanvas = document.getElementById('bg-canvas');
  const colorCanvas = document.getElementById('color-canvas');

  // Lock canvas height on first init to prevent jumping when bottom bar changes
  if (!container.dataset.locked) {
    const rect = container.getBoundingClientRect();
    container.style.height = rect.height + 'px';
    container.style.flex = 'none';
    container.dataset.locked = '1';
  }

  // Size canvases to container
  resizeCanvases();

  // Draw background: use scene photo if available, otherwise template shapes
  const bgCtx = bgCanvas.getContext('2d');
  const sceneImg = state.scenePhoto || (state.template && state.template.backgroundImage);
  console.log('Background image:', sceneImg);
  if (sceneImg) {
    drawSceneAsLineart(bgCtx, sceneImg);
  } else if (state.template) {
    drawLineart(bgCtx, state.template);
  }

  // Setup coloring events
  initColoring();

  // Start with place-self sub-phase
  setCanvasSubPhase('place-self');
}

function resizeCanvases() {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);

  ['bg-canvas', 'color-canvas'].forEach(id => {
    const c = document.getElementById(id);
    c.width = w;
    c.height = h;
  });
}

window.addEventListener('resize', () => {
  if (state.phase === 'canvas') {
    resizeCanvases();
    const bgCtx = document.getElementById('bg-canvas').getContext('2d');
    const sceneImg = state.scenePhoto || (state.template && state.template.backgroundImage);
    if (sceneImg) {
      drawSceneAsLineart(bgCtx, sceneImg);
    } else if (state.template) {
      drawLineart(bgCtx, state.template);
    }
    redrawColorStrokes();
  }
});

// --- Scene background drawing ---
function drawSceneAsLineart(ctx, imgSrc) {
  const canvas = ctx.canvas;
  // If canvas has zero size (initCanvasScreen ran before layout), retry next frame.
  if (canvas.width === 0 || canvas.height === 0) {
    requestAnimationFrame(() => drawSceneAsLineart(ctx, imgSrc));
    return;
  }
  const img = new Image();
  // NOTE: do NOT set crossOrigin — local same-origin loads do not taint the canvas,
  // and python's http.server doesn't return CORS headers, which would otherwise
  // block the load silently and leave the canvas blank.
  img.onload = () => {
    console.log('drawSceneAsLineart: loaded', imgSrc.slice(0, 80), `(${img.width}x${img.height} → canvas ${canvas.width}x${canvas.height})`);
    const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw crayon background at reduced opacity so coloring shows on top
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  };
  img.onerror = (e) => {
    console.warn('drawSceneAsLineart: failed to load', imgSrc.slice(0, 80), e);
  };
  // Cache-bust file URLs only — data: / blob: URLs do not accept query strings
  // and would silently fail to load if appended.
  const isInlineUrl = imgSrc.startsWith('data:') || imgSrc.startsWith('blob:');
  img.src = isInlineUrl
    ? imgSrc
    : imgSrc + (imgSrc.includes('?') ? '&' : '?') + 'v=' + Date.now();
}

// --- Line-art rendering (fallback for templates without background image) ---
function drawLineart(ctx, template) {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scaleX = canvas.width / 800;
  const scaleY = canvas.height / 600;

  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);

  for (const shape of template.background.shapes) {
    ctx.beginPath();
    if (shape.type === 'rect') {
      ctx.rect(shape.x * scaleX, shape.y * scaleY, shape.w * scaleX, shape.h * scaleY);
    } else if (shape.type === 'circle') {
      ctx.arc(shape.cx * scaleX, shape.cy * scaleY, shape.r * Math.min(scaleX, scaleY), 0, Math.PI * 2);
    } else if (shape.type === 'path') {
      ctx.save();
      ctx.scale(scaleX, scaleY);
      try {
        const p = new Path2D(shape.d);
        ctx.stroke(p);
      } catch (e) { /* ignore invalid paths */ }
      ctx.restore();
      continue;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// --- Stage timer ---
const STAGE_TIME_LIMITS = {
  'add-elements': 90,  // seconds
  'color': 60,
  'sound-studio': 45,
  'animate': 0, // drum has its own flow
};
let stageTimerInterval = null;
let stageStartTime = null;

function startStageTimer(subPhase) {
  clearStageTimer();
  const limit = STAGE_TIME_LIMITS[subPhase];
  if (!limit) {
    document.getElementById('stage-timer-bar').style.display = 'none';
    return;
  }

  document.getElementById('stage-timer-bar').style.display = '';
  const fill = document.getElementById('stage-timer-fill');
  fill.style.width = '0%';
  fill.className = 'stage-timer-fill';
  stageStartTime = Date.now();

  stageTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - stageStartTime) / 1000;
    const pct = Math.min(100, (elapsed / limit) * 100);
    fill.style.width = pct + '%';

    if (pct >= 100) {
      // Time's up — show gentle nudge
      fill.className = 'stage-timer-fill overtime';
      const nextBtn = document.getElementById('btn-canvas-next');
      if (nextBtn) {
        nextBtn.classList.remove('hidden');
        nextBtn.classList.add('nudge');
        nextBtn.textContent = 'Ready? →';
      }
      clearInterval(stageTimerInterval);
    } else if (pct >= 75) {
      fill.className = 'stage-timer-fill warning';
    }
  }, 1000);
}

function clearStageTimer() {
  if (stageTimerInterval) {
    clearInterval(stageTimerInterval);
    stageTimerInterval = null;
  }
  const fill = document.getElementById('stage-timer-fill');
  if (fill) {
    fill.style.width = '0%';
    fill.className = 'stage-timer-fill';
  }
  const nextBtn = document.getElementById('btn-canvas-next');
  if (nextBtn) {
    nextBtn.classList.remove('nudge');
    nextBtn.textContent = 'Next';
  }
}

// --- Sub-phase management ---
function setCanvasSubPhase(subPhase) {
  state.canvasSubPhase = subPhase;
  logEvent('sub_phase_change', { subPhase });

  const config = SUB_PHASES.find(s => s.id === subPhase);
  if (config) {
    document.getElementById('canvas-instruction').textContent = config.instruction;
    updatePhaseDots(config.dotIndex);
  }

  // Light stage: shrink the scene (bg/color/element layers) so it sits inside
  // the building cutout with margin, instead of filling the whole stage.
  const ccForShrink = document.getElementById('canvas-container');
  if (ccForShrink) {
    ccForShrink.classList.toggle('light-stage-shrink', subPhase === 'light');
    // Color phase: center + scale up avatar so the child has a big surface to color on,
    // dim the rest. mergeColorOntoElement runs while this class is still active so the
    // strokes get baked into the avatar's overlay canvas at the scaled bbox — they then
    // render correctly when the class is removed and the avatar returns to placed size.
    ccForShrink.classList.toggle('color-stage-active', subPhase === 'color');
  }

  const palette = document.getElementById('element-palette');
  const colorToolbar = document.getElementById('color-toolbar');
  const animateBar = document.getElementById('animate-bar');
  const btnNext = document.getElementById('btn-canvas-next');
  const btnBack = document.getElementById('btn-canvas-back');
  const colorCanvas = document.getElementById('color-canvas');
  const elementLayer = document.getElementById('element-layer');

  // Hide back button — tabs handle navigation now
  btnBack.classList.add('hidden');

  // Reset visibility
  palette.classList.remove('hidden');
  colorToolbar.classList.add('hidden');
  animateBar.classList.add('hidden');
  btnNext.classList.add('hidden');
  document.getElementById('sound-studio').classList.add('hidden');
  document.getElementById('sound-palette').classList.add('hidden');
  document.getElementById('drum-overlay')?.classList.add('hidden');
  // Stop any running drum session
  if (state._cleanupDrum) state._cleanupDrum();
  document.getElementById('element-layer').style.pointerEvents = 'auto';
  document.getElementById('element-palette').style.display = '';
  // Stop sound studio audio when leaving
  stopAllStudioLayers();
  colorCanvas.style.pointerEvents = 'none';
  colorCanvas.classList.remove('drawing-mode');
  // Only reset blend mode if there are no color strokes to preserve
  const hasStrokes = state.colorStrokes.length > 0;
  if (!hasStrokes) {
    colorCanvas.style.mixBlendMode = 'normal';
  }
  elementLayer.style.zIndex = '3';
  elementLayer.style.pointerEvents = 'auto';
  hideTouchCrayon();
  hideColorHint();

  // Capture screenshot and trigger AI for the stage we're leaving.
  // (Skip 'place-self' which is the intro dummy stage with no prior phase to capture.)
  if (subPhase !== 'place-self') {
    // Determine what we're leaving based on the SUB_PHASE_ORDER
    const order = SUB_PHASE_ORDER;
    const newIdx = order.indexOf(subPhase);
    const prevIdx = newIdx - 1;
    if (prevIdx >= 0) {
      const leaving = order[prevIdx];
      if (leaving === 'add-elements') {
        state.stageScreenshots.elements = captureStageScreenshot();
        triggerStageAI('create');
      } else if (leaving === 'color') {
        state.stageScreenshots.color = captureStageScreenshot();
        triggerStageAI('color');
        // Bake color strokes into per-element overlay canvases so coloring
        // travels with the avatar / placed elements (and doesn't stay glued
        // to the global color-canvas after the user moves things).
        if (typeof mergeColorOntoAllElements === 'function') {
          mergeColorOntoAllElements();
        }
      } else if (leaving === 'light') {
        state.stageScreenshots.light = captureStageScreenshot();
        triggerStageAI('light');
      } else if (leaving === 'sound-studio') {
        state.stageScreenshots.sound = captureStageScreenshot();
        triggerStageAI('sound');
      }
    }
  }

  // When leaving color phase: keep strokes visible, remove hints
  if (state._coloringActive && subPhase !== 'color') {
    document.querySelectorAll('.color-hint-item').forEach(h => h.remove());
    colorCanvas.style.pointerEvents = 'none';
    colorCanvas.classList.remove('drawing-mode');
    colorCanvas.style.mixBlendMode = 'multiply';
    colorCanvas.style.zIndex = '5';
    state._coloringActive = false;
  } else if (hasStrokes) {
    // Preserve strokes visibility when switching back to color or other phases
    colorCanvas.style.mixBlendMode = 'multiply';
    colorCanvas.style.zIndex = '5';
  } else {
    colorCanvas.style.zIndex = '2';
  }

  // Remove tappable/animated hints
  document.querySelectorAll('.canvas-element').forEach(el => {
    el.classList.remove('tappable');
  });

  // Reset bottom-bar canvas adjustment — phases that need it set it back below
  document.getElementById('canvas-container')?.classList.remove('no-bottom-bar');

  switch (subPhase) {
    case 'place-self':
      // Auto-place avatar and sun (for playground)
      autoPlaceAvatar();
      if (state.eventType === 'playground') autoPlaceSun();
      setCanvasSubPhase('add-elements');
      return;

    case 'add-elements':
      document.getElementById('light-stage')?.classList.add('hidden');
      renderElementPalette();
      break;

    case 'color':
      document.getElementById('light-stage')?.classList.add('hidden');
      palette.classList.add('hidden');
      colorToolbar.classList.add('hidden');
      colorCanvas.style.pointerEvents = 'none';
      elementLayer.style.pointerEvents = 'none';
      // Enter coloring directly (white mask + drawing). Short delay lets the
      // color-stage scale-up settle and the avatar element mount.
      setTimeout(() => {
        if (state.canvasSubPhase === 'color') showColorHint();
      }, 400);
      break;

    case 'light':
      palette.classList.add('hidden');
      document.getElementById('element-palette').style.display = 'none';
      document.getElementById('light-stage')?.classList.remove('hidden');
      // Hide sound/drum if previously open
      document.getElementById('sound-studio').classList.add('hidden');
      document.getElementById('drum-overlay').classList.add('hidden');
      // Light phase: no bottom toolbar — hide leftovers + let canvas fill the gap
      document.getElementById('sound-palette')?.classList.add('hidden');
      document.getElementById('color-toolbar')?.classList.add('hidden');
      document.getElementById('canvas-container')?.classList.add('no-bottom-bar');
      if (typeof setupLightStage === 'function') setupLightStage();
      break;

    case 'sound-studio':
      palette.classList.add('hidden');
      document.getElementById('element-palette').style.display = 'none';
      document.getElementById('light-stage')?.classList.add('hidden');
      document.getElementById('sound-studio').classList.remove('hidden');
      document.getElementById('sound-palette').classList.remove('hidden');
      setupSoundStudio();
      break;

    case 'animate':
      document.getElementById('sound-studio').classList.add('hidden');
      document.getElementById('light-stage')?.classList.add('hidden');
      stopAllStudioLayers();
      palette.classList.add('hidden');
      document.getElementById('element-palette').style.display = 'none';
      btnNext.classList.add('hidden');
      // Drum phase: no bottom toolbar — hide leftovers + let canvas fill the gap
      document.getElementById('sound-palette')?.classList.add('hidden');
      document.getElementById('color-toolbar')?.classList.add('hidden');
      document.getElementById('canvas-container')?.classList.add('no-bottom-bar');
      // Show drum overlay on canvas
      document.getElementById('drum-overlay').classList.remove('hidden');
      setupAnimatePhase();
      break;
  }

  // Start stage timer
  startStageTimer(subPhase);
}

function updatePhaseDots(activeIdx) {
  // Tab order matches SUB_PHASE_ORDER (skipping 'place-self'): tabs to the LEFT of
  // the active tab are marked .done (sage green); the current tab is .active (tomato).
  const TAB_ORDER = ['add-elements', 'color', 'light', 'sound-studio', 'animate'];
  const activeIndex = TAB_ORDER.indexOf(state.canvasSubPhase);
  document.querySelectorAll('.phase-tab').forEach(tab => {
    const idx = TAB_ORDER.indexOf(tab.dataset.phase);
    tab.classList.toggle('active', idx === activeIndex);
    tab.classList.toggle('done', idx >= 0 && activeIndex >= 0 && idx < activeIndex);
  });
}

// --- Next / Back buttons ---
const SUB_PHASE_ORDER = ['place-self', 'add-elements', 'color', 'light', 'sound-studio', 'animate'];

// Phase tab clicks — switch between stages freely
document.querySelectorAll('.phase-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const phase = tab.dataset.phase;
    setCanvasSubPhase(phase);
  });
});

// Next button — goes to drum (final step, no return)
document.getElementById('btn-canvas-next').addEventListener('click', () => {
  if (state.canvasSubPhase === 'sound-studio') {
    // Final step — go to drum, no coming back
    setCanvasSubPhase('animate');
  } else {
    // Move to next tab
    const idx = SUB_PHASE_ORDER.indexOf(state.canvasSubPhase);
    if (idx < SUB_PHASE_ORDER.length - 1) {
      setCanvasSubPhase(SUB_PHASE_ORDER[idx + 1]);
    }
  }
});

document.getElementById('btn-canvas-back').addEventListener('click', () => {
  const idx = SUB_PHASE_ORDER.indexOf(state.canvasSubPhase);
  if (idx > 0) {
    setCanvasSubPhase(SUB_PHASE_ORDER[idx - 1]);
  }
});

// --- Animate done button ---
document.getElementById('btn-animate-done')?.addEventListener('click', () => {
  goToPhase('processing');
});

// ============================================================
// AVATAR (Place Self)
// ============================================================
function autoPlaceAvatar() {
  const layer = document.getElementById('element-layer');
  // Don't double-place
  if (document.getElementById('avatar-main')) return;

  const el = document.createElement('div');
  el.className = 'canvas-element avatar-element';
  el.id = 'avatar-main';
  el.dataset.type = 'avatar';
  el.dataset.dimension = 'self';

  const avatarSrc = state.childPhoto || ('assets/test_avatar.png?v=' + Date.now());
  if (state.childPhoto && !state.childPhoto.includes('test_avatar')) {
    el.innerHTML = `<div class="avatar-frame"><img src="${avatarSrc}" class="avatar-img" /></div>`;
  } else {
    el.innerHTML = `<img src="${avatarSrc}" onerror="this.src='assets/avatar.svg'" style="background:transparent" />`;
  }

  // Avatar proportional to canvas height (~60%, +50% from prior 0.4)
  const container = document.getElementById('canvas-container');
  const cW = container.offsetWidth;
  const cH = container.offsetHeight;
  const avatarSize = Math.round(cH * 0.6);
  el.style.width = avatarSize + 'px';
  el.style.height = avatarSize + 'px';

  layer.appendChild(el);

  // Place at bottom-center
  el.style.left = (cW / 2 - avatarSize / 2) + 'px';
  el.style.top = (cH - avatarSize - 10) + 'px';

  makeDraggable(el);

  state.placedElements.push({
    id: el.id, type: 'avatar', dimension: 'self',
    x: parseInt(el.style.left), y: parseInt(el.style.top),
    width: 140, height: 140, timestamp: Date.now(),
  });
  logEvent('avatar_auto_placed');
}

function renderAvatarInPalette() {
  const palette = document.getElementById('element-palette');
  palette.innerHTML = '';

  // If we have multiple avatar variations, show them all for selection
  const avatarVariations = [
    { src: 'assets/test_avatar.png', label: 'Standing' },
    { src: 'assets/test_avatar_v1.png', label: 'Waving' },
    { src: 'assets/test_avatar_v2.png', label: 'Sitting' },
    { src: 'assets/test_avatar_v3.png', label: 'Jumping' },
    { src: 'assets/test_avatar_v4.png', label: 'Party' },
  ];

  // Use child photo directly if available (no variations generated yet)
  if (state.childPhoto && !state.childPhoto.includes('test_avatar')) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.innerHTML = `
      <div class="palette-icon">
        <img src="${state.childPhoto}" style="border-radius:50%;object-fit:cover;width:50px;height:50px;border:2px solid #2c2c2c;" />
      </div>
      <span class="palette-label">You</span>
    `;
    item.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      spawnAvatar(e);
      palette.classList.add('hidden');
    });
    palette.appendChild(item);
    return;
  }

  // Show variations
  for (const v of avatarVariations) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.innerHTML = `
      <div class="palette-icon">
        <img src="${v.src}?v=${Date.now()}" style="background:transparent" />
      </div>
      <span class="palette-label">${v.label}</span>
    `;
    item.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.childPhoto = v.src + '?v=' + Date.now();
      spawnAvatar(e);
      palette.classList.add('hidden');
    });
    palette.appendChild(item);
  }
}

function spawnAvatar(startEvent) {
  const layer = document.getElementById('element-layer');
  const el = document.createElement('div');
  el.className = 'canvas-element avatar-element';
  el.id = 'avatar-main';
  el.dataset.type = 'avatar';
  el.dataset.dimension = 'self';

  if (state.childPhoto) {
    el.innerHTML = `
      <div class="avatar-frame">
        <img src="${state.childPhoto}" class="avatar-img" />
      </div>
    `;
  } else {
    el.innerHTML = `<img src="assets/avatar.png" onerror="this.src='assets/avatar.svg'" />`;
  }

  layer.appendChild(el);

  // Position at touch point
  const cRect = layer.getBoundingClientRect();
  el.style.left = (startEvent.clientX - cRect.left - 70) + 'px';
  el.style.top = (startEvent.clientY - cRect.top - 70) + 'px';

  makeDraggable(el);

  state.placedElements.push({
    id: el.id,
    type: 'avatar',
    dimension: 'self',
    x: parseInt(el.style.left),
    y: parseInt(el.style.top),
    width: 140,
    height: 140,
    timestamp: Date.now(),
  });

  logEvent('avatar_placed');

  // Start dragging immediately
  startDrag(el, startEvent);
}

// ============================================================
// ELEMENT PALETTE & SPAWNING
// ============================================================
function renderElementPalette() {
  const palette = document.getElementById('element-palette');
  palette.innerHTML = '';

  if (!state.template) return;

  for (const elemDef of state.template.elements) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.dataset.elemId = elemDef.id;

    // Use PNG with SVG fallback, cache-bust
    const pngSrc = elemDef.asset.replace('.svg', '.png') + '?v=' + Date.now();
    const svgFallback = elemDef.asset;
    item.innerHTML = `
      <div class="palette-icon">
        <img src="${pngSrc}" onerror="this.src='${svgFallback}'" />
      </div>
      <span class="palette-label">${elemDef.label}</span>
    `;

    // Tap to spawn element at center of canvas
    item.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Only one instance of each palette element allowed on canvas
      if (item.classList.contains('used')) return;
      // Init audio on first interaction (iOS)
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      state.audioCtx.resume();

      // Spawn at center of canvas
      const container = document.getElementById('canvas-container');
      const rect = container.getBoundingClientRect();
      const fakeEvent = {
        clientX: rect.left + rect.width / 2 + (Math.random() - 0.5) * 100,
        clientY: rect.top + rect.height / 2 + (Math.random() - 0.5) * 100,
        pointerId: e.pointerId,
      };
      spawnElement(elemDef, fakeEvent);
    });

    palette.appendChild(item);
  }

  // Add "+" button at end of palette
  const addBtn = document.createElement('div');
  addBtn.className = 'palette-add-btn';
  addBtn.innerHTML = `
    <div class="palette-add-icon">+</div>
    <span class="palette-label">Custom</span>
  `;
  addBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showStickerInput();
  });
  palette.appendChild(addBtn);

  // Add trash can at the end
  const trash = document.createElement('div');
  trash.className = 'palette-trash';
  trash.id = 'palette-trash';
  trash.textContent = '🗑';
  palette.appendChild(trash);
}

// ============================================================
// CUSTOM STICKER GENERATION
// ============================================================
function showStickerInput() {
  const overlay = document.getElementById('sticker-input-overlay');
  const input = document.getElementById('sticker-name-input');
  overlay.classList.remove('hidden');
  input.value = '';
  input.focus();
}

function hideStickerInput() {
  document.getElementById('sticker-input-overlay').classList.add('hidden');
}

async function generateCustomSticker(name) {
  hideStickerInput();

  const palette = document.getElementById('element-palette');
  const addBtn = palette.querySelector('.palette-add-btn');

  // Create placeholder palette item with loading spinner
  const placeholder = document.createElement('div');
  placeholder.className = 'palette-item generating';
  placeholder.innerHTML = `
    <div class="palette-icon"></div>
    <span class="palette-label">${name}</span>
  `;
  palette.insertBefore(placeholder, addBtn);

  try {
    const resp = await fetch('/api/generate-sticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, event: state.eventType || '' }),
    });

    if (!resp.ok) throw new Error('Generation failed');
    const data = await resp.json();

    // Create element definition for the new sticker
    const elemDef = {
      id: `custom-${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
      type: 'custom',
      asset: data.image,
      label: name,
      dimension: 'decoration',
    };

    // Replace placeholder with real palette item
    placeholder.classList.remove('generating');
    placeholder.innerHTML = `
      <div class="palette-icon">
        <img src="${data.image}" />
      </div>
      <span class="palette-label">${name}</span>
    `;
    placeholder.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      state.audioCtx.resume();
      const container = document.getElementById('canvas-container');
      const rect = container.getBoundingClientRect();
      const fakeEvent = {
        clientX: rect.left + rect.width / 2 + (Math.random() - 0.5) * 100,
        clientY: rect.top + rect.height / 2 + (Math.random() - 0.5) * 100,
        pointerId: e.pointerId,
      };
      spawnElement(elemDef, fakeEvent);
    });

    // Generate line-art version locally for coloring phase
    elemDef.lineartDataUrl = await generateLineart(data.image);

    logEvent('custom_sticker_generated', { name });

  } catch (err) {
    console.error('Sticker generation failed:', err);
    placeholder.remove();
  }
}

// Server-side Gemini-driven lineart (high quality "coloring book" style:
// keeps face/hair/skin/shoes colored, makes large color blocks white while
// preserving outlines). Matches the boy reference image style.
async function generateLineartViaApi(dataUrl) {
  if (!API_BASE) throw new Error('No API_BASE');
  const resp = await fetch(API_BASE + '/api/generate-lineart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });
  if (!resp.ok) throw new Error('Lineart API ' + resp.status);
  const data = await resp.json();
  if (!data.image) throw new Error('Lineart API: no image in response');
  return data.image;
}

function generateLineart(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image();
    // No crossOrigin: data: / blob: URLs don't trigger CORS, and same-origin
    // http loads do not need it either.
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, c.width, c.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
        if (a < 30) { d[i+3] = 0; continue; }

        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx; // HSV saturation 0-1

        // 1. Crisp dark outlines → keep dark (anti-aliased outline pixels stay readable)
        if (gray < 55) {
          d[i] = d[i+1] = d[i+2] = 40;
          d[i+3] = 255;
          continue;
        }

        // 2. Soft outline edges (gray 55-100, low sat) → keep but lighten slightly
        if (gray < 100 && sat < 0.25) {
          // Anti-aliased edge of an outline — fade to mid-gray so edges still read
          const v = Math.round(80 + (gray - 55) * 1.5);
          d[i] = d[i+1] = d[i+2] = v;
          d[i+3] = 255;
          continue;
        }

        // 3. Skin tones (warm, r > g > b, mid saturation) → keep original
        const isSkin = r > 140 && g > 90 && b > 60 && r > g && g >= b - 5 && sat > 0.10 && sat < 0.55;
        if (isSkin) continue;

        // 4. Eye iris / mouth red (high sat warm or dark warm) → keep small accents
        // Only if pixel is small relative to image — but we can't easily tell here.
        // Heuristic: very saturated warm pixels are kept (eyes, lips, cheeks).
        const isAccent = sat > 0.45 && r > g && r > b && gray < 160;
        if (isAccent) continue;

        // 5. Everything else (clothes, hoodie, big color blocks) → near-white
        //    The "Color me!" target: keep an extremely faint tint so the area
        //    still reads as fillable, but lets crayon strokes paint over crisply.
        d[i] = d[i+1] = d[i+2] = 255;
        d[i+3] = 18;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = (e) => {
      console.warn('generateLineart: failed to load source image', e);
      resolve(dataUrl);  // fall back to original on failure
    };
    img.src = dataUrl;
  });
}

// Wire up sticker input UI
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('sticker-name-input');
  const btnGen = document.getElementById('btn-sticker-generate');
  const btnCancel = document.getElementById('btn-sticker-cancel');

  if (btnGen) btnGen.addEventListener('click', () => {
    const name = input.value.trim();
    if (name) generateCustomSticker(name);
  });
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const name = input.value.trim();
      if (name) generateCustomSticker(name);
    }
    e.stopPropagation();
  });
  if (btnCancel) btnCancel.addEventListener('click', hideStickerInput);
});

function spawnElement(elemDef, startEvent) {
  // Only one instance of each palette element allowed on canvas
  if (document.querySelector(`.canvas-element[data-elem-id="${CSS.escape(elemDef.id)}"]`)) return;
  const layer = document.getElementById('element-layer');
  const el = document.createElement('div');
  const uniqueId = `placed-${elemDef.id}-${Date.now()}`;
  el.className = `canvas-element ${elemDef.type}-element`;
  el.id = uniqueId;
  el.dataset.type = elemDef.type;
  el.dataset.elemId = elemDef.id;
  el.dataset.dimension = elemDef.dimension || 'decoration';
  if (elemDef.audioLayer) el.dataset.audiolayer = elemDef.audioLayer;

  const pngSrc = elemDef.asset.replace('.svg', '.png') + '?v=' + Date.now();
  el.innerHTML = `<img src="${pngSrc}" onerror="this.src='${elemDef.asset}'" draggable="false" />`;

  // Size based on type
  // Friend size matches avatar (dynamic based on canvas height)
  const canvasH = document.getElementById('canvas-container')?.offsetHeight || 600;
  const avatarSize = Math.round(canvasH * 0.4);

  const sizes = {
    friend: Math.round(avatarSize * 1.5),
    lamp: 250,
    music: 150,
    speaker: 150,
    microphone: 150,
    bell: 150,
    balloon: 150,
    cake: 180,
    present: 150,
    lights: 300, // wide
  };
  const s = sizes[elemDef.type] || 200;
  if (elemDef.type === 'lights') {
    el.style.width = s + 'px';
    el.style.height = Math.round(s * 0.4) + 'px';
  } else {
    el.style.width = s + 'px';
    el.style.height = s + 'px';
  }

  layer.appendChild(el);

  // Position at touch point
  const cRect = layer.getBoundingClientRect();
  el.style.left = (startEvent.clientX - cRect.left - 70) + 'px';
  el.style.top = (startEvent.clientY - cRect.top - 70) + 'px';

  makeDraggable(el);

  if (elemDef.resizable) {
    makeResizable(el);
  }

  state.placedElements.push({
    id: uniqueId,
    type: elemDef.type,
    dimension: elemDef.dimension || 'decoration',
    x: parseInt(el.style.left),
    y: parseInt(el.style.top),
    width: 140,
    height: 140,
    timestamp: Date.now(),
  });

  logEvent('element_placed', { id: uniqueId, type: elemDef.type });
  refreshElementPaletteState();

  // Play feedback sound/effect on placement (slight delay for iOS audio init)
  setTimeout(() => playPlacementFeedback(elemDef), 100);

  // Add pitch drag for music elements
  if (elemDef.type === 'music') {
    addPitchDrag(el);
  }

  // Add pull cord for lamp elements
  if (elemDef.type === 'lamp') {
    addPullCord(el);
  }

  // Start dragging immediately
  startDrag(el, startEvent);
}

// --- Child voice "Hi!" via pre-recorded audio ---
const hiGirlAudio = new Audio('assets/hi_girl.wav');
const hiBoyAudio = new Audio('assets/hi_boy.wav');
hiGirlAudio.preload = 'auto';
hiBoyAudio.preload = 'auto';

function sayHi(friendId) {
  const isGirl = friendId === 'friend2';
  const audio = isGirl ? hiGirlAudio : hiBoyAudio;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

// --- Ambient background music loop ---
let ambientGain = null;
let ambientPlaying = false;
let ambientVolume = 0.1; // default medium-low

function startAmbientLoop() {
  if (ambientPlaying) return;
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;
  ctx.resume().then(() => {
    ambientPlaying = true;
    state._ambientNodes = [];

    ambientGain = ctx.createGain();
    ambientGain.gain.value = ambientVolume;
    ambientGain.connect(ctx.destination);

    // Load event-specific ambient audio
    const ambientFile = state.eventType === 'playground' ? 'assets/playground_ambient.mp3' : 'assets/party_ambient.mp3';
    fetch(ambientFile)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(audioBuffer => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = true;
        source.playbackRate.value = 1.0;
        source.connect(ambientGain);
        source.start();
        state._ambientSource = source;
        state._ambientNodes.push(source);
      })
      .catch(e => console.warn('Failed to load ambient:', e));
  });
}

function setAmbientVolume(vol) {
  ambientVolume = vol;
  if (ambientGain) {
    ambientGain.gain.setTargetAtTime(vol, state.audioCtx.currentTime, 0.1);
  }
}

function setAmbientPitch(rate) {
  if (!state._ambientSource || !state.audioCtx) return;
  // Use detune (in cents) for true pitch shift without speed change
  // 1 octave = 1200 cents. rate 0.5→2.0 maps to -1200→+1200 cents
  // But we want rate 0.5→1.5, center at 1.0
  const cents = Math.log2(rate) * 1200;
  state._ambientSource.detune.setTargetAtTime(cents, state.audioCtx.currentTime, 0.05);
}

// --- Music pitch slider ---
function addPitchDrag(el) {
  // Create vertical pitch slider next to element
  const slider = document.createElement('div');
  slider.className = 'pitch-slider';
  slider.innerHTML = `
    <div class="pitch-track">
      <div class="pitch-triangle"></div>
      <div class="pitch-fill" id="pitch-fill"></div>
      <div class="pitch-thumb" id="pitch-thumb">
        <img src="assets/hand_point.png?v=2" class="pitch-hand" draggable="false" style="width:80px;height:80px;" />
      </div>
    </div>
  `;
  el.appendChild(slider);

  // Prevent slider events from triggering element drag
  slider.addEventListener('pointerdown', (e) => e.stopPropagation());

  const track = slider.querySelector('.pitch-track');
  const thumb = slider.querySelector('#pitch-thumb');
  const fill = slider.querySelector('#pitch-fill');
  let dragging = false;

  // Set initial position (middle = 1.0 pitch)
  updatePitchThumb(0.5);

  function updatePitchThumb(pct) {
    // pct: 0 = bottom (low pitch), 1 = top (high pitch)
    const clampedPct = Math.max(0, Math.min(1, pct));
    const topPx = (1 - clampedPct) * 100;
    thumb.style.top = topPx + '%';
    fill.style.height = (clampedPct * 100) + '%';

    // Map to playback rate: 0.5 (low) to 1.5 (high)
    const rate = 0.5 + clampedPct * 1.0;
    setAmbientPitch(rate);
  }

  let hasSlideUp = false;
  let hasSlideDown = false;
  let lastY = null;

  track.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    lastY = e.clientY;
    track.setPointerCapture(e.pointerId);
    handleDrag(e);
  });

  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // Track slide direction
    if (lastY !== null) {
      if (e.clientY < lastY - 5) hasSlideUp = true;
      if (e.clientY > lastY + 5) hasSlideDown = true;
    }
    lastY = e.clientY;
    handleDrag(e);

    // Hide hand hint after both up and down slide detected
    if (hasSlideUp && hasSlideDown) {
      const hand = track.querySelector('.pitch-hand');
      if (hand) { hand.style.transition = 'opacity 0.3s'; hand.style.opacity = '0'; setTimeout(() => hand.style.display = 'none', 300); }
    }
  });

  track.addEventListener('pointerup', (e) => {
    dragging = false;
    const rate = state._ambientAudio ? state._ambientAudio.playbackRate : 1.0;
    logEvent('music_pitch_changed', { pitch: rate });
  });

  function handleDrag(e) {
    const rect = track.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pct = 1 - (y / rect.height);
    updatePitchThumb(pct);
    console.log('Pitch drag:', pct.toFixed(2), 'rate:', (0.5 + Math.max(0,Math.min(1,pct)) * 1.0).toFixed(2));
  }
}

function stopAmbientLoop() {
  if (state._ambientNodes) {
    state._ambientNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    state._ambientNodes = [];
  }
  if (ambientGain) {
    ambientGain.disconnect();
    ambientGain = null;
  }
  ambientPlaying = false;
}

// --- Sun + Cloud brightness interaction (playground) ---
function autoPlaceSun() {
  const layer = document.getElementById('element-layer');
  if (document.getElementById('sun-element')) return;

  const el = document.createElement('div');
  el.className = 'canvas-element sun-element';
  el.id = 'sun-element';
  el.dataset.type = 'sun';
  el.innerHTML = `<img src="assets/sun.png?v=${Date.now()}" draggable="false" style="background:transparent" />`;
  el.style.width = '150px';
  el.style.height = '150px';
  el.style.pointerEvents = 'none'; // Sun can't be dragged

  const container = document.getElementById('canvas-container');
  el.style.left = (container.offsetWidth - 180) + 'px';
  el.style.top = '20px';

  layer.appendChild(el);
}

function addCloudSunInteraction(cloudEl) {
  // Check overlap on every pointer move while dragging
  cloudEl.addEventListener('pointermove', () => {
    checkCloudSunOverlap();
  });
  // Also check when drag ends
  cloudEl.addEventListener('pointerup', () => {
    checkCloudSunOverlap();
  });
}

function checkCloudSunOverlap() {
  const sun = document.getElementById('sun-element');
  if (!sun) return;

  const sunRect = sun.getBoundingClientRect();
  const sunCx = sunRect.left + sunRect.width / 2;
  const sunCy = sunRect.top + sunRect.height / 2;
  const sunR = sunRect.width / 2;

  // Check all clouds
  let totalOverlap = 0;
  document.querySelectorAll('.canvas-element').forEach(el => {
    if (el.dataset.type !== 'cloud') return;
    const cRect = el.getBoundingClientRect();
    const cCx = cRect.left + cRect.width / 2;
    const cCy = cRect.top + cRect.height / 2;

    // Distance between centers
    const dist = Math.sqrt((cCx - sunCx) ** 2 + (cCy - sunCy) ** 2);
    const overlap = Math.max(0, 1 - dist / (sunR + cRect.width / 3));
    totalOverlap += overlap;
  });

  // More overlap = dimmer (0 clouds = bright 1.0, fully covered = dim 0.5)
  const brightness = Math.max(0.4, 1.0 - totalOverlap * 0.3);
  document.getElementById('canvas-container').style.filter = `brightness(${brightness})`;

  // Sun glow changes
  if (sun) {
    sun.style.filter = totalOverlap > 0.3
      ? `brightness(${0.7})` : '';
  }

  logEvent('cloud_sun_overlap', { overlap: totalOverlap, brightness });
}

// ============================================================
// LIGHT STAGE — sun/moon arc for brightness + time-of-day preference
// ============================================================
// Classify arc position t ∈ [0,1] into a coarse time-of-day band.
// Mirrors the moon/sun split (isMoon when t<0.15 or t>0.85).
function getTimeOfDay(t) {
  if (typeof t !== 'number') return null;
  if (t < 0.15 || t > 0.85) return 'night';
  if (t < 0.35) return 'morning';
  if (t < 0.65) return 'midday';
  return 'afternoon';
}

// Normalize light brightness (range 0.4–1.15) into 0–1 preference score
function normalizeLightBrightness(b) {
  if (typeof b !== 'number') return null;
  return Math.max(0, Math.min(1, (b - 0.4) / 0.75));
}

// Per-event scene illustrations (Imagen-generated, watercolor + ink, magenta interior chroma-keyed transparent).
const LIGHT_SCENE_BY_EVENT = {
  school: 'assets/light_scene_school.png?v=209',
  grocery: 'assets/light_scene_grocery.png?v=209',
  dining: 'assets/light_scene_dining.png?v=209',
  dental: 'assets/light_scene_dental.png?v=243',
};
const LIGHT_SCENE_DEFAULT = 'assets/light_house_scene.png?v=209';

function setupLightStage() {
  const stage = document.getElementById('light-stage');
  const celestial = document.getElementById('light-celestial');
  const sky = document.getElementById('light-sky');
  const container = document.getElementById('canvas-container');
  const frame = document.getElementById('light-frame');

  // Swap the frame image to match the chosen event
  if (frame) {
    const desired = LIGHT_SCENE_BY_EVENT[state.eventType] || LIGHT_SCENE_DEFAULT;
    const desiredFile = desired.split('?')[0];
    if (frame.src.indexOf(desiredFile) === -1) {
      frame.src = desired;
    }
  }

  // Initial position: center of arc (noon, t = 0.5) or restore prior
  let t = (state.lightData && typeof state.lightData.arcPosition === 'number')
            ? state.lightData.arcPosition : 0.5;

  function getStageRect() {
    return stage.getBoundingClientRect();
  }

  function clientXToT(clientX) {
    const rect = getStageRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  // Position celestial body at parameter t along quadratic Bezier arc.
  // Arc lives in the top ~20% of the stage so the sun stays in the white-sky
  // area ABOVE the building roof (which fills most of the frame).
  function positionCelestial(tNew) {
    t = Math.max(0, Math.min(1, tNew));
    const rect = getStageRect();
    const w = rect.width, h = rect.height;

    // Quadratic Bezier (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
    // Edges at y=25% from top, apex at y=10% from top — keeps the sun clear of the
    // topbar while still landing in the white sky strip above the building roof.
    const x0 = 0.05, y0 = 0.25;
    const x1 = 0.50, y1 = -0.05;
    const x2 = 0.95, y2 = 0.25;
    const u = 1 - t;
    const xPct = u * u * x0 + 2 * u * t * x1 + t * t * x2;
    const yPct = u * u * y0 + 2 * u * t * y1 + t * t * y2;
    celestial.style.left = (xPct * w) + 'px';
    celestial.style.top = (yPct * h) + 'px';

    // Brightness: peak at t=0.5 (noon), low at edges. 0.4 → 1.15 range.
    const brightness = 0.4 + 0.75 * Math.sin(t * Math.PI);
    // Apply to specific underlying layers only, NOT the whole canvas-container
    // (so the celestial icon inside light-stage stays vivid).
    // Also dim the sky pane so the "outside" matches the time of day, but
    // leave the house frame (.light-frame) at constant brightness so the
    // interior reads as warmly lit even at night.
    container.style.filter = '';
    ['bg-canvas', 'color-canvas', 'element-layer', 'light-frame'].forEach(id => {
      const layer = document.getElementById(id);
      if (layer) layer.style.filter = `brightness(${brightness.toFixed(2)})`;
    });
    celestial.style.filter = 'drop-shadow(0 0 14px rgba(255, 220, 100, 0.85))';

    // Switch between sun and moon at the dim edges of the arc
    const isMoon = (t < 0.15 || t > 0.85);
    celestial.classList.toggle('is-moon', isMoon);
    celestial.classList.toggle('is-sun', !isMoon);

    // Save to state
    if (!state.lightData) state.lightData = {};
    state.lightData.arcPosition = t;
    state.lightData.brightness = brightness;
  }

  positionCelestial(t);

  // === Demo loop: sun + hand glide back and forth around noon together,
  // demonstrating the drag gesture for non-readers. Stops on first user touch.
  // Cancel any RAF leaked from a previous setupLightStage entry. ===
  if (stage._demoRAF) cancelAnimationFrame(stage._demoRAF);
  const dragHint = document.getElementById('light-drag-hint');
  if (dragHint) dragHint.classList.remove('hidden');

  let demoActive = true;
  const demoStart = performance.now();

  function stopDemo() {
    demoActive = false;
    if (stage._demoRAF) {
      cancelAnimationFrame(stage._demoRAF);
      stage._demoRAF = null;
    }
    if (dragHint) dragHint.classList.add('hidden');
  }

  function tickDemo() {
    if (!demoActive) return;
    const elapsed = (performance.now() - demoStart) / 1000;
    // Sin oscillation: t goes 0.5 → 0.7 → 0.5 → 0.3 → 0.5 over a 2.6s period
    const period = 2.6;
    const tDemo = 0.5 + 0.20 * Math.sin((elapsed / period) * 2 * Math.PI);
    positionCelestial(tDemo);
    // Position the hand to follow the sun (slight offset below + right)
    if (dragHint && stage) {
      const rect = stage.getBoundingClientRect();
      const u = 1 - tDemo;
      const xPct = u * u * 0.05 + 2 * u * tDemo * 0.50 + tDemo * tDemo * 0.95;
      const yPct = u * u * 0.25 + 2 * u * tDemo * -0.05 + tDemo * tDemo * 0.25;
      dragHint.style.left = (xPct * rect.width) + 'px';
      dragHint.style.top = (yPct * rect.height + 35) + 'px';  // hand sits just below the sun
    }
    stage._demoRAF = requestAnimationFrame(tickDemo);
  }
  stage._demoRAF = requestAnimationFrame(tickDemo);

  // Pointer / touch drag handlers
  let dragging = false;

  function onDown(e) {
    e.preventDefault();
    dragging = true;
    stopDemo();  // first user touch ends the demo (also cancels RAF)
    celestial.classList.add('dragging');
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    positionCelestial(clientXToT(cx));
  }
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    positionCelestial(clientXToT(cx));
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    celestial.classList.remove('dragging');
    if (typeof logEvent === 'function') {
      logEvent('light_arc_set', { arcPosition: t, brightness: state.lightData.brightness });
    }
  }

  // Avoid duplicate listeners across re-entry
  if (stage._lightHandlers) {
    const h = stage._lightHandlers;
    stage.removeEventListener('mousedown', h.down);
    stage.removeEventListener('mousemove', h.move);
    stage.removeEventListener('mouseup', h.up);
    stage.removeEventListener('mouseleave', h.up);
    stage.removeEventListener('touchstart', h.down);
    stage.removeEventListener('touchmove', h.move);
    stage.removeEventListener('touchend', h.up);
  }
  stage._lightHandlers = { down: onDown, move: onMove, up: onUp };
  stage.addEventListener('mousedown', onDown);
  stage.addEventListener('mousemove', onMove);
  stage.addEventListener('mouseup', onUp);
  stage.addEventListener('mouseleave', onUp);
  stage.addEventListener('touchstart', onDown, { passive: false });
  stage.addEventListener('touchmove', onMove, { passive: false });
  stage.addEventListener('touchend', onUp);
}

// ============================================================
// SOUND STUDIO — Five-line staff for sound composition
// ============================================================
const SOUND_ELEMENTS = [
  { type: 'bgm', asset: 'assets/music_note.png', glyph: '♫', label: 'BGM', color: '#FF8C42' },
  { type: 'voice', asset: 'assets/microphone.png', glyph: '♩', label: 'Voices', color: '#4D96FF' },
  { type: 'sfx', asset: 'assets/bell.png', glyph: '♪', label: 'Effects', color: '#6BCB77' },
];

function setupSoundStudio() {
  const palette = document.getElementById('sound-palette');
  const staffArea = document.getElementById('staff-area');
  const staffElements = document.getElementById('staff-elements');

  palette.innerHTML = '';
  staffElements.innerHTML = '';
  // Reveal decorative note hints when entering an empty staff
  document.getElementById('staff-hints')?.classList.remove('hidden');

  // Add trash zone
  const trash = document.createElement('div');
  trash.className = 'trash-zone';
  trash.id = 'sound-trash';
  trash.textContent = '🗑';
  palette.appendChild(trash);

  // Render sound palette items
  SOUND_ELEMENTS.forEach(snd => {
    const item = document.createElement('div');
    item.className = 'sound-palette-item';
    item.dataset.soundType = snd.type;
    const iconInner = snd.glyph
      ? `<span class="sound-palette-glyph" style="color:${snd.color}">${snd.glyph}</span>`
      : `<img src="${snd.asset.startsWith('data:') ? snd.asset : snd.asset + '?v=' + Date.now()}" />`;
    item.innerHTML = `
      <div class="sound-palette-icon">${iconInner}</div>
      <span class="sound-palette-label">${snd.label}</span>
    `;

    item.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      spawnStaffElement(snd, e);
    });

    palette.appendChild(item);
  });

  // Add "+" button for custom sound
  if (API_BASE) {
    const addBtn = document.createElement('div');
    addBtn.className = 'sound-palette-item sound-palette-add';
    addBtn.innerHTML = `
      <div class="sound-palette-icon" style="font-size:28px; display:flex; align-items:center; justify-content:center;">+</div>
      <span class="sound-palette-label">Custom</span>
    `;
    addBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      showCustomSoundInput();
    });
    palette.appendChild(addBtn);
  }
}

function showCustomSoundInput() {
  // Reuse the sticker input overlay
  const overlay = document.getElementById('sticker-input-overlay');
  const input = document.getElementById('sticker-name-input');
  const btnGo = document.getElementById('btn-sticker-generate');
  const btnCancel = document.getElementById('btn-sticker-cancel');

  overlay.classList.remove('hidden');
  input.value = '';
  input.placeholder = 'Type a sound (rain, birds, car...)';
  input.focus();

  const doGenerate = () => {
    const name = input.value.trim();
    if (!name) return;
    overlay.classList.add('hidden');
    generateCustomSound(name);
  };

  // Replace handlers temporarily
  const newGo = btnGo.cloneNode(true);
  btnGo.replaceWith(newGo);
  newGo.addEventListener('click', doGenerate);

  const newCancel = btnCancel.cloneNode(true);
  btnCancel.replaceWith(newCancel);
  newCancel.addEventListener('click', () => {
    overlay.classList.add('hidden');
    input.placeholder = 'Type an object name...';
  });

  input.onkeydown = (e) => { if (e.key === 'Enter') doGenerate(); };
}

async function generateCustomSound(name) {
  // Show loading spinner before the Custom button (like create stage)
  const palette = document.getElementById('sound-palette');
  const customBtn = palette.querySelector('.sound-palette-add');
  const placeholder = document.createElement('div');
  placeholder.className = 'sound-palette-item generating';
  placeholder.innerHTML = `
    <div class="sound-palette-icon"></div>
    <span class="sound-palette-label">${name}</span>
  `;
  if (customBtn) {
    palette.insertBefore(placeholder, customBtn);
  } else {
    palette.appendChild(placeholder);
  }

  try {
    // Generate sound and visual icon in parallel
    const [soundResp, iconResp] = await Promise.all([
      fetch(API_BASE + '/api/generate-sound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
      fetch(API_BASE + '/api/generate-sticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).catch(() => null),
    ]);

    const soundData = await soundResp.json();
    if (soundData.error) throw new Error(soundData.error);

    // Get icon image (or fall back to bell)
    let iconSrc = 'assets/bell.png';
    if (iconResp) {
      const iconData = await iconResp.json();
      if (iconData.image) iconSrc = iconData.image;
    }

    placeholder.remove();

    const customSnd = {
      type: 'custom_' + Date.now(),
      asset: iconSrc,
      label: name,
      audioData: soundData.audio,
    };

    SOUND_ELEMENTS.push(customSnd);
    // Only re-render if still in sound stage
    if (state.canvasSubPhase === 'sound-studio') {
      setupSoundStudio();
    }
  } catch (e) {
    placeholder?.remove();
    console.warn('Custom sound generation failed:', e);
    alert('Could not generate sound: ' + e.message);
  }
}

function refreshElementPaletteState() {
  const placed = new Set();
  document.querySelectorAll('#element-layer .canvas-element[data-elem-id]').forEach(el => placed.add(el.dataset.elemId));
  document.querySelectorAll('#element-palette .palette-item[data-elem-id]').forEach(item => {
    item.classList.toggle('used', placed.has(item.dataset.elemId));
  });
}

function refreshSoundPaletteState() {
  const placed = new Set();
  document.querySelectorAll('.staff-element').forEach(el => placed.add(el.dataset.soundType));
  document.querySelectorAll('.sound-palette-item[data-sound-type]').forEach(item => {
    item.classList.toggle('used', placed.has(item.dataset.soundType));
  });
}

function spawnStaffElement(snd, startEvent) {
  // Only one of each sound type allowed on the staff
  if (document.querySelector(`.staff-element[data-sound-type="${CSS.escape(snd.type)}"]`)) return;
  const staffArea = document.getElementById('staff-area');
  const staffElements = document.getElementById('staff-elements');
  const el = document.createElement('div');
  el.className = 'staff-element';
  el.dataset.soundType = snd.type;
  el.innerHTML = snd.glyph
    ? `<span class="staff-element-glyph" style="color:${snd.color}">${snd.glyph}</span>`
    : `<img src="${snd.asset.startsWith('data:') ? snd.asset : snd.asset + '?v=' + Date.now()}" draggable="false" />`;

  staffElements.appendChild(el);
  refreshSoundPaletteState();

  // Position at center
  const rect = staffArea.getBoundingClientRect();
  const x = rect.width / 2 - 30 + (Math.random() - 0.5) * 100;
  const y = rect.height / 2 - 30;
  el.style.left = x + 'px';
  el.style.top = y + 'px';

  // Start continuous audio layer
  startStudioLayer(snd.type);
  updateStudioLayer(snd.type, el, rect.width, rect.height);

  // Game feedback: bounce + note particles
  el.classList.add('staff-bounce');
  setTimeout(() => el.classList.remove('staff-bounce'), 500);
  spawnNoteParticles(el);

  // Make draggable within staff
  makeStaffDraggable(el, snd);

  logEvent('staff_element_placed', { type: snd.type });
}

function makeStaffDraggable(el, snd) {
  let offsetX, offsetY, dragging = false;

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const staffArea = document.getElementById('staff-area');
    const sRect = staffArea.getBoundingClientRect();
    const newX = e.clientX - sRect.left - offsetX;
    const newY = e.clientY - sRect.top - offsetY;

    // Clamp within staff area
    el.style.left = Math.max(0, Math.min(sRect.width - 60, newX)) + 'px';
    el.style.top = Math.max(0, Math.min(sRect.height - 60, newY)) + 'px';

    // Live pitch + volume + size update
    updateStudioLayer(snd.type, el, sRect.width, sRect.height);

    // Highlight trash if near bottom
    const trash = document.getElementById('sound-trash');
    if (trash) {
      const tRect = trash.getBoundingClientRect();
      const near = e.clientY > tRect.top - 30;
      trash.classList.toggle('active', near);
    }
  });

  el.addEventListener('pointerup', (e) => {
    dragging = false;
    el.classList.remove('dragging');

    const staffArea = document.getElementById('staff-area');
    const sRect = staffArea.getBoundingClientRect();

    // If dragged into trash zone or outside staff area, remove it
    const trash = document.getElementById('sound-trash');
    if (trash) trash.classList.remove('active');
    const trashRect = trash ? trash.getBoundingClientRect() : null;
    const inTrash = trashRect && e.clientY > trashRect.top - 20 && e.clientX > trashRect.left - 20 && e.clientX < trashRect.right + 20;
    const outsideStaff = e.clientY < sRect.top - 20 || e.clientY > sRect.bottom + 20 || e.clientX < sRect.left - 20 || e.clientX > sRect.right + 20;
    if (inTrash || outsideStaff) {
      el.remove();
      // Stop this sound layer
      if (studioLayers[snd.type]) {
        if (studioLayers[snd.type].source) { try { studioLayers[snd.type].source.stop(); } catch(e) {} }
        if (studioLayers[snd.type].gain) { studioLayers[snd.type].gain.disconnect(); }
        delete studioLayers[snd.type];
      }
      refreshSoundPaletteState();
      logEvent('staff_element_removed', { type: snd.type });
      return;
    }

    // Snap to nearest staff line
    const lines = staffArea.querySelectorAll('.staff-line');
    const elTop = parseFloat(el.style.top) + 30;
    let closestLine = null;
    let closestDist = Infinity;
    lines.forEach(line => {
      const lineY = line.offsetTop + 1;
      const dist = Math.abs(elTop - lineY);
      if (dist < closestDist) { closestDist = dist; closestLine = line; }
    });
    if (closestLine && closestDist < 40) {
      el.style.top = (closestLine.offsetTop - 29) + 'px';
    }

    updateStudioLayer(snd.type, el, sRect.width, sRect.height);

    // Snap feedback: bounce + particles
    el.classList.add('staff-bounce');
    setTimeout(() => el.classList.remove('staff-bounce'), 500);
    spawnNoteParticles(el);

    // Idle dance: element sways gently based on pitch
    const pitchPct = 1 - parseFloat(el.style.top) / sRect.height;
    const speed = 1.5 - pitchPct * 0.8; // high pitch = faster sway
    el.style.animation = `staffSway ${speed}s ease-in-out infinite`;

    const finalX = parseFloat(el.style.left);
    const finalY = parseFloat(el.style.top);
    logEvent('staff_element_set', {
      type: snd.type,
      pitch: Math.round((1 - finalY / sRect.height) * 100),
      volume: Math.round(finalX / sRect.width * 100),
    });
  });
}

// --- Continuous audio layers for sound studio ---
const studioLayers = {};

function startStudioLayer(soundType) {
  if (studioLayers[soundType]) return;
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;
  ctx.resume().then(() => {
    const layer = { gain: null, source: null };

    layer.gain = ctx.createGain();
    layer.gain.gain.value = 0.1;
    layer.gain.connect(ctx.destination);

    // Check if this is a custom sound with base64 audio
    const sndDef = SOUND_ELEMENTS.find(s => s.type === soundType);
    if (sndDef && sndDef.audioData) {
      // Decode base64 audio
      const binary = atob(sndDef.audioData.split(',')[1] || sndDef.audioData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      ctx.decodeAudioData(bytes.buffer).then(audioBuffer => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.loop = true;
        src.connect(layer.gain);
        src.start();
        layer.source = src;
      });
      studioLayers[soundType] = layer;
      return;
    }

    if (soundType === 'bgm') {
      // Load party/playground ambient
      const file = state.eventType === 'playground' ? 'assets/playground_ambient.mp3' : 'assets/party_ambient.mp3';
      fetch(file).then(r => r.arrayBuffer()).then(buf => ctx.decodeAudioData(buf)).then(audioBuffer => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.loop = true;
        src.connect(layer.gain);
        src.start();
        layer.source = src;
      });
    } else if (soundType === 'voice') {
      // Real voice ambient audio
      fetch('assets/voice_ambient.mp3').then(r => r.arrayBuffer()).then(buf => ctx.decodeAudioData(buf)).then(audioBuffer => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.loop = true;
        src.connect(layer.gain);
        src.start();
        layer.source = src;
      });
    } else if (soundType === 'sfx') {
      // Real SFX ambient audio
      fetch('assets/sfx_ambient.mp3').then(r => r.arrayBuffer()).then(buf => ctx.decodeAudioData(buf)).then(audioBuffer => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.loop = true;
        src.connect(layer.gain);
        src.start();
        layer.source = src;
      });
    }

    studioLayers[soundType] = layer;
  });
}

function updateStudioLayer(soundType, el, staffWidth, staffHeight) {
  const x = parseFloat(el.style.left) || 0;
  const y = parseFloat(el.style.top) || 0;

  // Y position → pitch: top = high, bottom = low
  // Small range (±300 cents = quarter tone) so speed change is barely noticeable
  const pitchPct = 1 - Math.max(0, Math.min(1, y / staffHeight));
  if (studioLayers[soundType] && studioLayers[soundType].source) {
    const cents = (pitchPct - 0.5) * 600;
    studioLayers[soundType].source.detune.setTargetAtTime(cents, state.audioCtx.currentTime, 0.05);
  }

  // X position → volume + icon size: right = loud/big, left = quiet/small
  const volPct = Math.max(0, Math.min(1, x / staffWidth));
  const volume = 0.02 + volPct * 0.25;
  if (studioLayers[soundType] && studioLayers[soundType].gain) {
    studioLayers[soundType].gain.gain.setTargetAtTime(volume, state.audioCtx.currentTime, 0.05);
  }

  // Scale icon: 40px (left) to 90px (right)
  const size = 40 + volPct * 50;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
}

function stopAllStudioLayers() {
  Object.keys(studioLayers).forEach(key => {
    const layer = studioLayers[key];
    if (layer.source) { try { layer.source.stop(); } catch(e) {} }
    if (layer.gain) { layer.gain.disconnect(); }
    delete studioLayers[key];
  });
}

// --- Note particles for sound studio feedback ---
function spawnNoteParticles(el) {
  const notes = ['♪', '♫', '♬', '🎵'];
  const rect = el.getBoundingClientRect();
  const container = el.closest('.staff-area') || document.body;

  for (let i = 0; i < 4; i++) {
    const p = document.createElement('div');
    p.className = 'note-particle';
    p.textContent = notes[Math.floor(Math.random() * notes.length)];
    p.style.left = (rect.left - container.getBoundingClientRect().left + rect.width / 2) + 'px';
    p.style.top = (rect.top - container.getBoundingClientRect().top + rect.height / 2) + 'px';
    p.style.setProperty('--dx', ((Math.random() - 0.5) * 60) + 'px');
    p.style.setProperty('--dy', (-(30 + Math.random() * 40)) + 'px');
    container.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

// --- Dog bark sound ---
function playDogBark() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;
  ctx.resume().then(() => {
    const now = ctx.currentTime;
    // Short bark: noise burst + pitched tone
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(250, now + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 2;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);

    // Second bark
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(450, now + 0.25);
    osc2.frequency.exponentialRampToValueAtTime(280, now + 0.35);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.15, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc2.connect(filter);
    filter.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.25);
    osc2.stop(now + 0.45);
  });
}

// --- Lamp pull cord ---
let lampBrightness = 0; // 0-5 levels

function addPullCord(el) {
  // Make lamp taller to fit cord inside
  el.style.height = '220px';
  el.style.overflow = 'visible';

  const cord = document.createElement('div');
  cord.className = 'pull-cord';
  cord.innerHTML = `
    <svg width="30" height="90" viewBox="0 0 30 90" class="cord-svg">
      <line x1="15" y1="0" x2="15" y2="65" stroke="#888" stroke-width="2"/>
      <circle cx="15" cy="72" r="8" fill="#eee" stroke="#888" stroke-width="1.5"/>
    </svg>
    <img src="assets/hand_grab.png" class="cord-hand-hint" draggable="false" />
  `;
  el.appendChild(cord);

  let pullStartY = null;
  const cordSvg = cord.querySelector('.cord-svg');
  const handHint = cord.querySelector('.cord-hand-hint');

  // Remove hand hint after first pull
  cord.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    pullStartY = e.clientY;
    cord.setPointerCapture(e.pointerId);
    if (handHint) handHint.style.display = 'none';
  });

  cord.addEventListener('pointermove', (e) => {
    if (pullStartY === null) return;
    const dy = e.clientY - pullStartY;
    const stretch = Math.max(0, Math.min(50, dy));
    cordSvg.style.transform = `scaleY(${1 + stretch / 90})`;
  });

  function finishPull(e) {
    if (pullStartY === null) return;
    const dy = e ? (e.clientY - pullStartY) : 0;
    pullStartY = null;

    // Snap back
    cordSvg.style.transition = 'transform 0.3s ease-out';
    cordSvg.style.transform = 'scaleY(1)';
    setTimeout(() => { cordSvg.style.transition = ''; }, 300);

    if (dy > 25) {
      lampBrightness = (lampBrightness + 1) % 6;
      applyLampBrightness();

      const glowIntensity = lampBrightness * 8;
      el.style.filter = lampBrightness > 0
        ? `drop-shadow(0 0 ${glowIntensity}px rgba(255,220,100,${lampBrightness * 0.15}))`
        : 'none';

      logEvent('lamp_pull', { brightness: lampBrightness });
    }
  }

  cord.addEventListener('pointerup', finishPull);
  cord.addEventListener('pointercancel', finishPull);
  cord.addEventListener('lostpointercapture', finishPull);
}

function applyLampBrightness() {
  const levels = [0.5, 0.65, 0.8, 0.9, 1.0, 1.1];
  const brightness = levels[lampBrightness] || 0.5;
  document.getElementById('canvas-container').style.filter = `brightness(${brightness})`;
}

function playPlacementFeedback(elemDef) {
  const layer = elemDef.audioLayer || elemDef.dimension;

  if (elemDef.audioLayer === 'bgm') {
    // Start looping party ambient sound
    startAmbientLoop();
  } else if (layer === 'auditory' || elemDef.audioLayer) {
    // Play the instrument's sound once
    const audioLayer = elemDef.audioLayer || elemDef.type;
    playMusicalNote(2, audioLayer);
  }

  if (elemDef.type === 'dog') {
    // Dog barks
    playDogBark();
  }

  if (elemDef.type === 'lamp') {
    applyLampBrightness();
  }

  // Cloud: check overlap with sun on every move to adjust brightness
  if (elemDef.type === 'cloud') {
    addCloudSunInteraction(el);
  }
}

// ============================================================
// DRAG & DROP
// ============================================================
function makeDraggable(el) {
  let tapStartX, tapStartY, tapStartTime, moved;

  el.addEventListener('pointerdown', (e) => {
    if (state.canvasSubPhase === 'color') return;
    if (state.canvasSubPhase === 'animate') return;
    if (state.canvasSubPhase === 'adjust') return; // Let audio/lights click handlers take over
    e.preventDefault();
    e.stopPropagation();
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapStartTime = Date.now();
    moved = false;

    // Dismiss any other open delete buttons
    document.querySelectorAll('.delete-btn').forEach(b => b.remove());

    startDrag(el, e, () => { moved = true; });
  });

  // Delete via trash — no tap-to-delete needed
}

function showDeleteButton(el) {
  // Remove existing delete buttons
  document.querySelectorAll('.delete-btn').forEach(b => b.remove());

  const btn = document.createElement('div');
  btn.className = 'delete-btn';
  btn.innerHTML = '&times;';
  btn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Stop ambient music if deleting music element
    if (el.dataset.type === 'music') {
      stopAmbientLoop();
    }
    // Reset brightness if deleting lamp
    if (el.dataset.type === 'lamp') {
      lampBrightness = 0;
      document.getElementById('canvas-container').style.filter = '';
    }
    // Remove from DOM
    el.remove();
    // Remove from state
    state.placedElements = state.placedElements.filter(p => p.id !== el.id);
    state.animatedElements.delete(el.id);
    btn.remove();
    logEvent('element_deleted', { id: el.id, type: el.dataset.type });
    refreshElementPaletteState();
  });

  el.appendChild(btn);

  // Auto-dismiss after 3 seconds
  setTimeout(() => { if (btn.parentElement) btn.remove(); }, 3000);
}

function startDrag(el, e, onMoveCallback) {
  const rect = el.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  el.classList.add('dragging');
  el.setPointerCapture(e.pointerId);

  const onMove = (me) => {
    if (onMoveCallback) onMoveCallback();
    const container = document.getElementById('element-layer');
    const cRect = container.getBoundingClientRect();
    el.style.left = (me.clientX - cRect.left - offsetX) + 'px';
    el.style.top = (me.clientY - cRect.top - offsetY) + 'px';

    // Highlight trash if near
    const trash = document.getElementById('palette-trash');
    if (trash) {
      const tRect = trash.getBoundingClientRect();
      const near = me.clientY > tRect.top - 20 && me.clientX > tRect.left - 20;
      trash.classList.toggle('active', near);
    }
  };

  const onUp = (ue) => {
    el.classList.remove('dragging');
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);

    // Check if dropped on trash
    const trash = document.getElementById('palette-trash');
    if (trash) {
      trash.classList.remove('active');
      const tRect = trash.getBoundingClientRect();
      if (ue.clientY > tRect.top - 20 && ue.clientX > tRect.left - 20) {
        // Delete element
        if (el.dataset.type === 'music') stopAmbientLoop();
        el.remove();
        state.placedElements = state.placedElements.filter(p => p.id !== el.id);
        state.animatedElements.delete(el.id);
        logEvent('element_trashed', { id: el.id, type: el.dataset.type });
        refreshElementPaletteState();
        return;
      }
    }

    updatePlacedElement(el);
    logEvent('element_moved', {
      id: el.id,
      x: parseInt(el.style.left),
      y: parseInt(el.style.top),
    });
  };

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
}

function updatePlacedElement(el) {
  const placed = state.placedElements.find(p => p.id === el.id);
  if (placed) {
    placed.x = parseInt(el.style.left) || 0;
    placed.y = parseInt(el.style.top) || 0;
    placed.width = parseInt(el.style.width) || 80;
    placed.height = parseInt(el.style.height) || 80;
  }
}

// ============================================================
// COLORING
// ============================================================
function initColoring() {
  const canvas = document.getElementById('color-canvas');
  const ctx = canvas.getContext('2d');

  // Crayon brush: draw textured strokes
  function drawCrayonSegment(ctx, x0, y0, x1, y1, color, size) {
    const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    if (dist < 1) return;

    const angle = Math.atan2(y1 - y0, x1 - x0);
    const perpX = Math.sin(angle);
    const perpY = -Math.cos(angle);

    // Multiple offset lines for rough crayon texture
    const strokes = Math.max(3, Math.floor(size / 2));
    for (let i = 0; i < strokes; i++) {
      const offset = (Math.random() - 0.5) * size * 0.8;
      const jitterX1 = (Math.random() - 0.5) * 1.5;
      const jitterY1 = (Math.random() - 0.5) * 1.5;
      const jitterX2 = (Math.random() - 0.5) * 1.5;
      const jitterY2 = (Math.random() - 0.5) * 1.5;

      ctx.beginPath();
      ctx.moveTo(
        x0 + perpX * offset + jitterX1,
        y0 + perpY * offset + jitterY1
      );
      ctx.lineTo(
        x1 + perpX * offset + jitterX2,
        y1 + perpY * offset + jitterY2
      );
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.random() * 1.5 + 0.5;
      ctx.globalAlpha = 0.15 + Math.random() * 0.25;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Scatter grain particles along the segment
    const grainCount = Math.floor(dist * size * 0.05);
    for (let i = 0; i < grainCount; i++) {
      const t = Math.random();
      const gx = x0 + (x1 - x0) * t + (Math.random() - 0.5) * size;
      const gy = y0 + (y1 - y0) * t + (Math.random() - 0.5) * size;
      const gr = Math.random() * 1.2 + 0.3;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.08 + Math.random() * 0.15;
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
  }

  let lastCrayonX = 0, lastCrayonY = 0;
  let activePointerId = null;
  let activeTouchCount = 0;

  // Track touch count to cancel painting when second finger arrives
  canvas.addEventListener('touchstart', (e) => {
    activeTouchCount = e.touches.length;
    if (activeTouchCount > 1 && state.painting) {
      // Second finger down — cancel current stroke
      state.painting = false;
      activePointerId = null;
      ctx.globalCompositeOperation = 'source-over';
      // Discard the incomplete stroke
      state.currentStroke = null;
    }
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    activeTouchCount = e.touches.length;
  }, { passive: true });

  canvas.addEventListener('pointerdown', (e) => {
    if (state.canvasSubPhase !== 'color') return;
    // Only track one finger — ignore if multi-touch
    if (activePointerId !== null) return;
    if (activeTouchCount > 1) return;
    activePointerId = e.pointerId;
    e.preventDefault();
    state.painting = true;
    showTouchCrayon(e.clientX, e.clientY);

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    lastCrayonX = x;
    lastCrayonY = y;

    state.currentStroke = {
      color: state.isEraser ? 'eraser' : state.selectedColor,
      width: state.brushSize,
      points: [{ x, y }],
    };

    if (state.isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineWidth = state.brushSize * 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.painting || e.pointerId !== activePointerId) return;
    moveTouchCrayon(e.clientX, e.clientY);
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (state.isEraser) {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      drawCrayonSegment(ctx, lastCrayonX, lastCrayonY, x, y, state.selectedColor, state.brushSize * 3);
      lastCrayonX = x;
      lastCrayonY = y;
    }

    if (state.currentStroke) {
      state.currentStroke.points.push({ x, y });
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!state.painting || e.pointerId !== activePointerId) return;
    state.painting = false;
    activePointerId = null;
    hideTouchCrayon();
    ctx.globalCompositeOperation = 'source-over';

    if (state.currentStroke && state.currentStroke.points.length > 1) {
      state.colorStrokes.push(state.currentStroke);
      logEvent('color_stroke', {
        color: state.currentStroke.color,
        width: state.currentStroke.width,
        pointCount: state.currentStroke.points.length,
      });
    }
    state.currentStroke = null;
  });

  canvas.addEventListener('pointerleave', (e) => {
    if (state.painting && e.pointerId === activePointerId) {
      state.painting = false;
      activePointerId = null;
      hideTouchCrayon();
      ctx.globalCompositeOperation = 'source-over';
      if (state.currentStroke) {
        state.colorStrokes.push(state.currentStroke);
      }
      state.currentStroke = null;
    }
  });
}

function redrawColorStrokes() {
  const canvas = document.getElementById('color-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const stroke of state.colorStrokes) {
    if (stroke.points.length < 2) continue;

    if (stroke.color === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.lineWidth = stroke.width * 4;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      // Rebuild crayon texture — simplified for redraw performance
      for (let i = 1; i < stroke.points.length; i++) {
        const p0 = stroke.points[i - 1];
        const p1 = stroke.points[i];
        const dist = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
        if (dist < 1) continue;
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        const perpX = Math.sin(angle);
        const perpY = -Math.cos(angle);
        const size = stroke.width * 3;
        const strokes = Math.max(2, Math.floor(size / 3));
        for (let s = 0; s < strokes; s++) {
          const off = (Math.random() - 0.5) * size * 0.8;
          ctx.beginPath();
          ctx.moveTo(p0.x + perpX * off, p0.y + perpY * off);
          ctx.lineTo(p1.x + perpX * off, p1.y + perpY * off);
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = Math.random() * 1.5 + 0.5;
          ctx.globalAlpha = 0.15 + Math.random() * 0.2;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1.0;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// --- Merge color strokes onto avatar as internal overlay canvas ---
function mergeColorOntoAvatar() {
  try {
    const avatar = document.getElementById('avatar-main');
    if (!avatar) return;

    const colorCanvas = document.getElementById('color-canvas');
    const container = document.getElementById('canvas-container');

    // Get avatar position relative to canvas container
    const cRect = container.getBoundingClientRect();
    const aRect = avatar.getBoundingClientRect();
    const ax = aRect.left - cRect.left;
    const ay = aRect.top - cRect.top;
    const aw = aRect.width;
    const ah = aRect.height;

    // Scale to color-canvas pixel coordinates
    const scaleX = colorCanvas.width / cRect.width;
    const scaleY = colorCanvas.height / cRect.height;
    const sx = Math.round(ax * scaleX);
    const sy = Math.round(ay * scaleY);
    const sw = Math.round(aw * scaleX);
    const sh = Math.round(ah * scaleY);

    if (sw <= 0 || sh <= 0) return;

    // Remove any old overlay
    avatar.querySelector('.avatar-color-overlay')?.remove();

    // Create a canvas inside the avatar element to hold the color strokes
    const overlay = document.createElement('canvas');
    overlay.className = 'avatar-color-overlay';
    overlay.width = sw;
    overlay.height = sh;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2';

    const ctx = overlay.getContext('2d');
    // Copy color strokes from the avatar's region on the global canvas
    ctx.drawImage(colorCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    avatar.appendChild(overlay);

    // Clear avatar region from global color canvas
    const colorCtx = colorCanvas.getContext('2d');
    colorCtx.clearRect(sx, sy, sw, sh);

    console.log('Merged color onto avatar overlay:', { sx, sy, sw, sh });
  } catch (e) {
    console.warn('mergeColorOntoAvatar failed:', e);
  }
}

// --- Merge color strokes onto a single element ---
function mergeColorOntoElement(el) {
  try {
    const colorCanvas = document.getElementById('color-canvas');
    const container = document.getElementById('canvas-container');
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();

    const scaleX = colorCanvas.width / cRect.width;
    const scaleY = colorCanvas.height / cRect.height;
    const sx = Math.round((eRect.left - cRect.left) * scaleX);
    const sy = Math.round((eRect.top - cRect.top) * scaleY);
    const sw = Math.round(eRect.width * scaleX);
    const sh = Math.round(eRect.height * scaleY);

    if (sw <= 0 || sh <= 0) return;

    // Remove old overlay
    el.querySelector('.element-color-overlay')?.remove();

    const overlay = document.createElement('canvas');
    overlay.className = 'element-color-overlay';
    overlay.width = sw;
    overlay.height = sh;
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';

    const ctx = overlay.getContext('2d');
    ctx.drawImage(colorCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    el.appendChild(overlay);

    // Clear this region from global canvas
    const colorCtx = colorCanvas.getContext('2d');
    colorCtx.clearRect(sx, sy, sw, sh);
  } catch (e) {
    console.warn('mergeColorOntoElement failed:', e);
  }
}

// --- Merge color strokes onto ALL placed elements ---
function mergeColorOntoAllElements() {
  document.querySelectorAll('.canvas-element').forEach(el => {
    mergeColorOntoElement(el);
  });
}

// --- Swap avatar between colored and lineart (white clothes) ---
function swapAvatarImage(toLineart) {
  const avatar = document.getElementById('avatar-main');
  if (!avatar) return;
  const img = avatar.querySelector('img');
  if (!img) return;

  if (toLineart) {
    // Store original src
    avatar.dataset.originalSrc = img.src;
    img.src = 'assets/test_avatar.png?v=' + Date.now();
  } else {
    // Restore original
    if (avatar.dataset.originalSrc) {
      img.src = avatar.dataset.originalSrc;
    }
  }
}

// --- Color hints on each element individually ---
function showColorHint() {
  hideColorHint();

  const colorCanvas = document.getElementById('color-canvas');
  const colorToolbar = document.getElementById('color-toolbar');

  // Enter coloring DIRECTLY: show toolbar, swap the avatar to its white line-art
  // ("white mask"), and enable drawing — no "Color me!" tap step (per Yue 2026-06-29).
  colorToolbar.classList.remove('hidden');
  colorCanvas.classList.add('drawing-mode');
  colorCanvas.style.zIndex = '10';
  colorCanvas.style.mixBlendMode = 'multiply';
  // Keep element-layer BELOW color canvas so strokes stay visible
  document.getElementById('element-layer').style.zIndex = '3';
  state._coloringActive = true;

  // Swap AVATAR ONLY to line-art immediately. Other placed items keep their look.
  const el = document.getElementById('avatar-main');
  const img = el && el.querySelector('img');
  if (el && img && !el.dataset.swappedToLineart) {
    el.dataset.swappedToLineart = '1';
    el.dataset.originalSrc = img.src;
    img.style.filter = '';
    const usingCustomPhoto = state.childPhoto && !state.childPhoto.includes('test_avatar');
    if (usingCustomPhoto) {
      if (state.childAvatarLineart) {
        // Pre-generated lineart is ready — swap immediately.
        img.src = state.childAvatarLineart;
      } else {
        // Pre-generation still in flight — show a loading shimmer, then swap.
        const loading = document.createElement('div');
        loading.className = 'avatar-lineart-loading';
        loading.innerHTML = '<span>✨</span>';
        el.appendChild(loading);
        const promise = state._lineartPromise || generateLineartViaApi(state.childPhoto);
        promise
          .then(url => url || generateLineart(state.childPhoto))
          .catch(() => generateLineart(state.childPhoto))
          .then(url => {
            state.childAvatarLineart = url;
            img.src = url;
            loading.remove();
          });
      }
    } else {
      img.src = 'assets/test_avatar_lineart.png?v=' + Date.now();
    }
  }

  // Enable drawing on the canvas right away.
  colorCanvas.style.pointerEvents = 'auto';
  const elLayer = document.getElementById('element-layer');
  elLayer.style.zIndex = '3';
  elLayer.style.pointerEvents = 'none';
  setTimeout(updateCrayonCursor, 50);
}

function hideColorHint() {
  document.querySelectorAll('.color-hint-item').forEach(h => h.remove());
}

// --- Touch crayon (iPad/touch) ---
const touchCrayon = document.getElementById('touch-crayon');
let touchCrayonVisible = false;

function initTouchCrayon() {
  updateTouchCrayonColor();
}
initTouchCrayon();

function crayonSVG(color, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * 1.8}" viewBox="0 0 30 54">
    <rect x="8" y="8" width="14" height="34" rx="2" fill="${color}" stroke="#333" stroke-width="1.2"/>
    <rect x="8" y="8" width="14" height="6" rx="1" fill="#333" opacity="0.2"/>
    <polygon points="8,42 22,42 15,54" fill="${color}" stroke="#333" stroke-width="1"/>
    <line x1="12" y1="14" x2="12" y2="38" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
  </svg>`;
}

function updateTouchCrayonColor() {
  const color = state.isEraser ? '#ccc' : state.selectedColor;
  touchCrayon.innerHTML = crayonSVG(color, 28);
}

function showTouchCrayon(x, y) {
  if (state.canvasSubPhase !== 'color') return;
  if (state.isEraser) { hideTouchCrayon(); return; }
  touchCrayon.classList.remove('hidden');
  // Position tip at finger, tilt for right-hand feel
  touchCrayon.style.left = (x - 14) + 'px';
  touchCrayon.style.top = (y - 50) + 'px';
  touchCrayon.style.transformOrigin = '14px 50px';
  touchCrayon.style.transform = 'rotate(25deg)';
  touchCrayonVisible = true;
}

function moveTouchCrayon(x, y) {
  if (!touchCrayonVisible) return;
  touchCrayon.style.left = (x - 14) + 'px';
  touchCrayon.style.top = (y - 50) + 'px';
}

function hideTouchCrayon() {
  touchCrayon.classList.add('hidden');
  touchCrayonVisible = false;
}

// --- Crayon cursor (desktop) ---
function updateCrayonCursor() {
  const canvas = document.getElementById('color-canvas');
  if (!canvas.classList.contains('drawing-mode')) return;

  if (state.isEraser) {
    canvas.style.cursor = 'url("data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">' +
      '<rect x="4" y="8" width="28" height="18" rx="3" fill="#F5C6CB" stroke="#888" stroke-width="1.5" transform="rotate(-10 18 17)"/>' +
      '<rect x="4" y="18" width="28" height="8" rx="2" fill="#E8A0A8" stroke="#888" stroke-width="1" transform="rotate(-10 18 17)"/>' +
      '</svg>'
    ) + '") 18 18, crosshair';
    return;
  }

  // Hide CSS cursor — the touch crayon overlay handles visual feedback
  canvas.style.cursor = 'none';
}

// --- Color picker: hue dropdown + saturation carousel ---
// 30 hues across the spectrum. Each hue exposes 6 saturation steps at L=50% by default.
// Modifiers: lShift (lightness offset), gray/black/brown (special handling).
const HUE_PALETTE = [
  { key: 'red',      name: 'Red',      hue: 0   },
  { key: 'crimson',  name: 'Crimson',  hue: 348, lShift: -8 },
  { key: 'coral',    name: 'Coral',    hue: 12  },
  { key: 'salmon',   name: 'Salmon',   hue: 8,   lShift: 10 },
  { key: 'orange',   name: 'Orange',   hue: 28  },
  { key: 'peach',    name: 'Peach',    hue: 22,  lShift: 12 },
  { key: 'amber',    name: 'Amber',    hue: 42  },
  { key: 'gold',     name: 'Gold',     hue: 46,  lShift: -5 },
  { key: 'yellow',   name: 'Yellow',   hue: 54  },
  { key: 'olive',    name: 'Olive',    hue: 65,  lShift: -15 },
  { key: 'lime',     name: 'Lime',     hue: 80  },
  { key: 'green',    name: 'Green',    hue: 130 },
  { key: 'forest',   name: 'Forest',   hue: 140, lShift: -18 },
  { key: 'jade',     name: 'Jade',     hue: 150 },
  { key: 'mint',     name: 'Mint',     hue: 155, lShift: 12 },
  { key: 'teal',     name: 'Teal',     hue: 172 },
  { key: 'cyan',     name: 'Cyan',     hue: 188 },
  { key: 'sky',      name: 'Sky',      hue: 205 },
  { key: 'azure',    name: 'Azure',    hue: 215 },
  { key: 'blue',     name: 'Blue',     hue: 220 },
  { key: 'indigo',   name: 'Indigo',   hue: 245, lShift: -10 },
  { key: 'violet',   name: 'Violet',   hue: 260 },
  { key: 'purple',   name: 'Purple',   hue: 275 },
  { key: 'magenta',  name: 'Magenta',  hue: 305 },
  { key: 'rose',     name: 'Rose',     hue: 345, lShift: 8 },
  { key: 'pink',     name: 'Pink',     hue: 330 },
  { key: 'brown',    name: 'Brown',    hue: 25,  brown: true },
  { key: 'tan',      name: 'Tan',      hue: 32,  lShift: 18 },
  { key: 'black',    name: 'Black',                black: true },
  { key: 'gray',     name: 'Gray',                 gray: true },
];
const SAT_LEVELS = [15, 32, 49, 66, 83, 100]; // % saturation, L=50%
const DEFAULT_SAT_INDEX = 3; // start mid-saturated

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function getHueSwatches(hueDef) {
  if (hueDef.gray) {
    // Light → dark gradient (no hue)
    return [90, 75, 60, 45, 30, 15].map(l => hslToHex(0, 0, l));
  }
  if (hueDef.black) {
    // Very dark gradient, near-black at the saturated end
    return [40, 32, 24, 18, 12, 6].map(l => hslToHex(0, 0, l));
  }
  if (hueDef.brown) {
    return SAT_LEVELS.map(s => hslToHex(hueDef.hue, Math.round(s * 0.85), 32));
  }
  const baseL = 50 + (hueDef.lShift || 0);
  return SAT_LEVELS.map(s => hslToHex(hueDef.hue, s, baseL));
}

// Picker state — mirrors the visible UI selection
let currentHueKey = 'red';
let currentSatIndex = DEFAULT_SAT_INDEX;

function getHueDef(key) {
  return HUE_PALETTE.find(h => h.key === key) || HUE_PALETTE[0];
}

function renderSatCarousel() {
  const container = document.getElementById('sat-carousel');
  if (!container) return;
  const hueDef = getHueDef(currentHueKey);
  const swatches = getHueSwatches(hueDef);
  container.innerHTML = '';
  swatches.forEach((hex, i) => {
    const btn = document.createElement('button');
    btn.className = 'sat-swatch' + (i === currentSatIndex ? ' selected' : '');
    btn.dataset.color = hex;
    btn.dataset.satIndex = String(i);
    btn.style.background = hex;
    btn.addEventListener('click', () => {
      currentSatIndex = i;
      selectColor(hex);
      // refresh selected highlight
      container.querySelectorAll('.sat-swatch').forEach((el, idx) => {
        el.classList.toggle('selected', idx === i);
      });
    });
    container.appendChild(btn);
  });
}

function renderHueDropdownMenu() {
  const menu = document.getElementById('hue-dropdown-menu');
  if (!menu) return;
  menu.innerHTML = '';
  HUE_PALETTE.forEach(hueDef => {
    const tile = document.createElement('button');
    tile.className = 'hue-tile' + (hueDef.key === currentHueKey ? ' selected' : '');
    tile.dataset.hueKey = hueDef.key;
    // representative dot = mid-saturation for that hue
    const previewHex = getHueSwatches(hueDef)[DEFAULT_SAT_INDEX];
    tile.innerHTML =
      `<span class="hue-tile-dot" style="background:${previewHex}"></span>` +
      `<span class="hue-tile-name">${hueDef.name}</span>`;
    tile.addEventListener('click', () => {
      currentHueKey = hueDef.key;
      // keep current sat index, but clamp
      currentSatIndex = Math.min(currentSatIndex, SAT_LEVELS.length - 1);
      updateHueDropdownButton();
      renderSatCarousel();
      // update selection highlights inside menu
      menu.querySelectorAll('.hue-tile').forEach(el => {
        el.classList.toggle('selected', el.dataset.hueKey === currentHueKey);
      });
      // pick the current sat's color
      const hex = getHueSwatches(getHueDef(currentHueKey))[currentSatIndex];
      selectColor(hex);
      closeHueDropdown();
    });
    menu.appendChild(tile);
  });
}

function updateHueDropdownButton() {
  const dot = document.getElementById('hue-dropdown-dot');
  const label = document.getElementById('hue-dropdown-label');
  const hueDef = getHueDef(currentHueKey);
  const previewHex = getHueSwatches(hueDef)[DEFAULT_SAT_INDEX];
  if (dot) dot.style.background = previewHex;
  if (label) label.textContent = hueDef.name;
}

function selectColor(hex) {
  state.selectedColor = hex;
  state.isEraser = false;
  // Selection is the preference signal (per ASD color literature: saturation aversion
  // shows up in *what they pick*, not in how big the strokes are). Stroke area is
  // execution, not intent — so we record the chosen hex here.
  state.colorSelections.push(hex);
  logEvent('color_selection', { hex });
  const eraserBtn = document.getElementById('btn-eraser');
  if (eraserBtn) eraserBtn.classList.remove('active');
  updateCrayonCursor();
  updateTouchCrayonColor();
}

function openHueDropdown() {
  const menu = document.getElementById('hue-dropdown-menu');
  const btn = document.getElementById('hue-dropdown-btn');
  if (!menu || !btn) return;
  menu.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
}
function closeHueDropdown() {
  const menu = document.getElementById('hue-dropdown-menu');
  const btn = document.getElementById('hue-dropdown-btn');
  if (!menu || !btn) return;
  menu.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
}
function toggleHueDropdown() {
  const menu = document.getElementById('hue-dropdown-menu');
  if (!menu) return;
  if (menu.classList.contains('hidden')) openHueDropdown();
  else closeHueDropdown();
}

(function initColorPicker() {
  const dropdownBtn = document.getElementById('hue-dropdown-btn');
  if (!dropdownBtn) return; // toolbar not present yet (test pages, etc.)
  renderHueDropdownMenu();
  renderSatCarousel();
  updateHueDropdownButton();
  // sync initial selectedColor with default hue/sat
  const initialHex = getHueSwatches(getHueDef(currentHueKey))[currentSatIndex];
  state.selectedColor = initialHex;

  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHueDropdown();
  });
  // dismiss when tapping outside
  document.addEventListener('pointerdown', (e) => {
    const menu = document.getElementById('hue-dropdown-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (!menu.contains(e.target) && !dropdownBtn.contains(e.target)) closeHueDropdown();
  });
})();

document.querySelectorAll('.brush-size').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.brush-size').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.brushSize = parseInt(btn.dataset.size);
  });
});

document.getElementById('btn-undo').addEventListener('click', () => {
  if (state.colorStrokes.length > 0) {
    state.colorStrokes.pop();
    redrawColorStrokes();
    logEvent('undo_stroke');
  }
});

document.getElementById('btn-eraser').addEventListener('click', () => {
  state.isEraser = !state.isEraser;
  const btn = document.getElementById('btn-eraser');
  btn.classList.toggle('active', state.isEraser);
  if (state.isEraser) {
    document.querySelectorAll('.sat-swatch').forEach(s => s.classList.remove('selected'));
  } else {
    // restore previous hue/sat selection visually + state
    const hex = getHueSwatches(getHueDef(currentHueKey))[currentSatIndex];
    state.selectedColor = hex;
    const swatches = document.querySelectorAll('.sat-swatch');
    if (swatches[currentSatIndex]) swatches[currentSatIndex].classList.add('selected');
  }
  updateCrayonCursor();
  updateTouchCrayonColor();
});

// ============================================================
// AUDIO ADJUST — Game-like music note interaction
// ============================================================
const NOTE_EMOJIS = ['♪', '♫', '♬', '🎵', '🎶'];
const NOTE_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#9B59B6', '#FF8C42'];
const MAX_NOTES = 5;

// Musical notes (frequencies) for a fun ascending scale
const MUSICAL_NOTES = [261.63, 293.66, 329.63, 392.00, 523.25]; // C4, D4, E4, G4, C5

function makeResizable(el) {
  el.dataset.noteCount = '0';
}

function setupAudioAdjust() {
  const allElements = document.querySelectorAll('.canvas-element');
  allElements.forEach(el => {
    // Handle auditory elements
    if (el.dataset.dimension === 'auditory') {
      setupAudioElement(el);
    }
    // Handle lights (visual brightness)
    if (el.dataset.type === 'lights') {
      setupLightsElement(el);
    }
  });
}

// --- Lights brightness control ---
const MAX_BRIGHTNESS = 5;
const BRIGHTNESS_LEVELS = [0.4, 0.55, 0.7, 0.85, 1.0, 1.15]; // canvas filter brightness
const LIGHT_EMOJIS = ['🌑', '🌘', '🌗', '🌖', '🌕', '☀️'];

function setupLightsElement(el) {
  el.classList.add('audio-adjustable', 'lights-adjustable');
  el.dataset.brightnessLevel = '3';
  updateLightsDisplay(el);

  // Add hint label
  el.querySelector('.lights-hint-label')?.remove();
  const hint = document.createElement('div');
  hint.className = 'lights-hint-label';
  hint.textContent = 'Tap to change light!';
  el.appendChild(hint);
  // Remove hint after first tap
  const removeHint = () => { hint.remove(); el.removeEventListener('pointerdown', removeHint); };
  el.addEventListener('pointerdown', removeHint);

  el._lightsClickHandler && el.removeEventListener('pointerdown', el._lightsClickHandler);

  el._lightsClickHandler = (e) => {
    e.stopPropagation();
    e.preventDefault();

    let level = parseInt(el.dataset.brightnessLevel) || 3;
    level = (level + 1) % (MAX_BRIGHTNESS + 1);
    el.dataset.brightnessLevel = level;

    // Update canvas brightness
    const container = document.getElementById('canvas-container');
    const brightness = BRIGHTNESS_LEVELS[level];
    container.style.filter = `brightness(${brightness})`;

    // Spawn a star/glow particle
    spawnGlowParticle(el, e.clientX, e.clientY, level);
    bounceElement(el);
    updateLightsDisplay(el);

    const placed = state.placedElements.find(p => p.id === el.id);
    if (placed) placed.brightnessLevel = level;

    logEvent('brightness_tap', { id: el.id, level, brightness });
  };
  el.addEventListener('pointerdown', el._lightsClickHandler);
}

function updateLightsDisplay(el) {
  el.querySelector('.brightness-indicator')?.remove();

  const level = parseInt(el.dataset.brightnessLevel) || 3;
  const badge = document.createElement('div');
  badge.className = 'brightness-indicator';
  badge.textContent = LIGHT_EMOJIS[level];
  el.appendChild(badge);
}

function spawnGlowParticle(el, clientX, clientY, level) {
  const particle = document.createElement('div');
  particle.className = 'flying-note';
  particle.textContent = level > 2 ? '✨' : '💫';
  particle.style.left = clientX + 'px';
  particle.style.top = clientY + 'px';
  particle.style.fontSize = '24px';
  const dx = (Math.random() - 0.5) * 60;
  const dy = -(40 + Math.random() * 50);
  particle.style.setProperty('--fly-x', dx + 'px');
  particle.style.setProperty('--fly-y', dy + 'px');
  document.body.appendChild(particle);
  setTimeout(() => particle.remove(), 800);
}

// --- Audio element setup (unchanged logic) ---
function setupAudioElement(el) {
  const audioLayer = el.dataset.audiolayer || el.dataset.type;
  const isBGM = (audioLayer === 'bgm' || audioLayer === 'speaker');

  el.classList.add('audio-adjustable');

  if (isBGM) {
    // --- BGM elements: continuous loop + tap to cycle volume (like lamp) ---
    if (!el.dataset.bgmLevel) el.dataset.bgmLevel = '3'; // start at medium
    updateBGMDisplay(el);

    // Start the ambient loop if not already playing
    startAmbientLoop();
    setAmbientVolume(BGM_VOLUME_LEVELS[parseInt(el.dataset.bgmLevel)]);

    el._audioClickHandler && el.removeEventListener('pointerdown', el._audioClickHandler);

    el._audioClickHandler = (e) => {
      e.stopPropagation();
      e.preventDefault();

      let level = parseInt(el.dataset.bgmLevel) || 3;
      level = (level + 1) % BGM_VOLUME_LEVELS.length;
      el.dataset.bgmLevel = level;

      setAmbientVolume(BGM_VOLUME_LEVELS[level]);
      spawnFlyingNote(el, e.clientX, e.clientY);
      bounceElement(el);
      updateBGMDisplay(el);

      // Dance speed proportional to volume
      if (level > 0) {
        const speed = 0.8 - (level / (BGM_VOLUME_LEVELS.length - 1)) * 0.4;
        el.style.animation = `speakerDance ${speed}s ease-in-out infinite`;
      } else {
        el.style.animation = '';
      }

      const placed = state.placedElements.find(p => p.id === el.id);
      if (placed) placed.volumeLevel = level;

      logEvent('bgm_volume_tap', { id: el.id, level, volume: BGM_VOLUME_LEVELS[level] });
    };
    el.addEventListener('pointerdown', el._audioClickHandler);
  } else {
    // --- Non-BGM audio elements: keep original note-tap behavior ---
    updateNoteDisplay(el);

    el._audioClickHandler && el.removeEventListener('pointerdown', el._audioClickHandler);

    el._audioClickHandler = (e) => {
      e.stopPropagation();
      e.preventDefault();

      let count = parseInt(el.dataset.noteCount) || 0;
      count = (count + 1) % (MAX_NOTES + 1);
      el.dataset.noteCount = count;

      if (count > 0) {
        spawnFlyingNote(el, e.clientX, e.clientY);
        playMusicalNote(count - 1, audioLayer);
        bounceElement(el);
      } else {
        stopAudio();
        el.style.animation = '';
      }

      updateNoteDisplay(el);

      const placed = state.placedElements.find(p => p.id === el.id);
      if (placed) placed.volumeLevel = count;

      logEvent('audio_note_tap', { id: el.id, noteCount: count });
    };
    el.addEventListener('pointerdown', el._audioClickHandler);
  }
}

function updateBGMDisplay(el) {
  el.querySelector('.bgm-indicator')?.remove();

  const level = parseInt(el.dataset.bgmLevel) || 0;
  const badge = document.createElement('div');
  badge.className = 'brightness-indicator'; // reuse lamp badge style
  badge.textContent = BGM_VOLUME_EMOJIS[level];
  el.appendChild(badge);
}

function updateNoteDisplay(el) {
  // Remove old notes display
  el.querySelector('.note-display')?.remove();

  const count = parseInt(el.dataset.noteCount) || 0;
  if (count === 0) {
    el.style.animation = '';
    return;
  }

  // Show collected notes around the element
  const display = document.createElement('div');
  display.className = 'note-display';

  for (let i = 0; i < count; i++) {
    const note = document.createElement('span');
    note.className = 'collected-note';
    note.textContent = NOTE_EMOJIS[i % NOTE_EMOJIS.length];
    note.style.color = NOTE_COLORS[i % NOTE_COLORS.length];
    // Position notes in arc above element
    const angle = -Math.PI * 0.2 + (Math.PI * 0.4 / (MAX_NOTES - 1)) * i;
    const radius = 55;
    note.style.left = (50 + Math.cos(angle) * radius) + '%';
    note.style.top = (-10 + Math.sin(angle) * radius * -1) + '%';
    display.appendChild(note);
  }
  el.appendChild(display);

  // Speaker dances proportional to note count
  const intensity = count / MAX_NOTES;
  const speed = 0.8 - intensity * 0.4; // faster at higher volume
  el.style.animation = `speakerDance ${speed}s ease-in-out infinite`;
}

function spawnFlyingNote(el, clientX, clientY) {
  const note = document.createElement('div');
  note.className = 'flying-note';
  note.textContent = NOTE_EMOJIS[Math.floor(Math.random() * NOTE_EMOJIS.length)];
  note.style.color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
  note.style.left = clientX + 'px';
  note.style.top = clientY + 'px';
  note.style.fontSize = (20 + Math.random() * 16) + 'px';

  // Random direction: upward with slight horizontal drift
  const dx = (Math.random() - 0.5) * 80;
  const dy = -(60 + Math.random() * 60);
  note.style.setProperty('--fly-x', dx + 'px');
  note.style.setProperty('--fly-y', dy + 'px');

  document.body.appendChild(note);
  setTimeout(() => note.remove(), 800);
}

function bounceElement(el) {
  el.classList.remove('note-bounce');
  void el.offsetWidth; // Force reflow
  el.classList.add('note-bounce');
  setTimeout(() => el.classList.remove('note-bounce'), 300);
}

// BGM volume levels for tap-to-cycle (like lamp brightness)
const BGM_VOLUME_LEVELS = [0, 0.04, 0.08, 0.12, 0.18, 0.25];
const BGM_VOLUME_EMOJIS = ['🔇', '🔈', '🔈', '🔉', '🔉', '🔊'];

// Musical note scales per audio layer
const BGM_NOTES = [261.63, 293.66, 329.63, 392.00, 523.25];     // C4-C5, melodic
const VOICE_NOTES = [196.00, 220.00, 246.94, 261.63, 293.66];   // G3-D4, speech range
const SFX_NOTES = [523.25, 659.25, 783.99, 1046.50, 1318.51];   // C5-E6, bright/sharp

function playMusicalNote(noteIndex, audioLayer) {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;
  const ready = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  ready.then(() => {
    if (audioLayer === 'bgm' || audioLayer === 'speaker') {
      _playBGM(ctx, noteIndex);
    } else if (audioLayer === 'voice' || audioLayer === 'microphone') {
      _playVoice(ctx, noteIndex);
    } else if (audioLayer === 'sfx' || audioLayer === 'bell') {
      _playSFX(ctx, noteIndex);
    } else {
      _playBGM(ctx, noteIndex); // fallback
    }
  });
}

function _playBGM(ctx, noteIndex) {
  // Party ambient: crowd murmur + cheerful melody snippet
  const noteCount = noteIndex + 1;
  const volume = 0.06 + (noteCount / MAX_NOTES) * 0.15;
  const now = ctx.currentTime;

  // 1. Crowd murmur — filtered noise
  const bufSize = Math.floor(ctx.sampleRate * 0.8);
  const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const nFilter = ctx.createBiquadFilter();
  nFilter.type = 'bandpass';
  nFilter.frequency.value = 800;
  nFilter.Q.value = 0.5;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(volume * 0.4, now);
  nGain.gain.setTargetAtTime(0, now + 0.6, 0.2);
  noise.connect(nFilter);
  nFilter.connect(nGain);
  nGain.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.8);

  // 2. Cheerful melody — quick ascending notes
  const melody = [523.25, 587.33, 659.25, 783.99]; // C5 D5 E5 G5
  melody.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t = now + i * 0.12;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

function _playVoice(ctx, noteIndex) {
  // Human crowd murmur: noise shaped by vocal formants
  const noteCount = noteIndex + 1;
  const volume = 0.08 + (noteCount / MAX_NOTES) * 0.2;

  // White noise source (simulates breath/crowd)
  const bufferSize = ctx.sampleRate * 0.8;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  // Vocal buzz (low fundamental, like vocal folds)
  const buzz = ctx.createOscillator();
  buzz.type = 'sawtooth';
  buzz.frequency.value = 120 + noteIndex * 20; // Pitch rises slightly each tap

  // Formant filters — shape both noise and buzz into vowel sounds
  // Different vowel per noteIndex: /a/, /e/, /i/, /o/, /u/
  const vowels = [
    { f1: 730, f2: 1090 },  // /a/
    { f1: 530, f2: 1840 },  // /e/
    { f2: 390, f1: 2300 },  // /i/
    { f1: 570, f2: 840 },   // /o/
    { f1: 440, f2: 1020 },  // /u/
  ];
  const vowel = vowels[noteIndex % vowels.length];

  const formant1 = ctx.createBiquadFilter();
  formant1.type = 'bandpass';
  formant1.frequency.value = vowel.f1;
  formant1.Q.value = 8;

  const formant2 = ctx.createBiquadFilter();
  formant2.type = 'bandpass';
  formant2.frequency.value = vowel.f2;
  formant2.Q.value = 8;

  const gain = ctx.createGain();
  const buzzGain = ctx.createGain();
  buzzGain.gain.value = 0.6;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.4;

  // Buzz → formants → output
  buzz.connect(buzzGain);
  buzzGain.connect(formant1);
  buzzGain.connect(formant2);

  // Noise → formants → output (adds breathiness)
  noise.connect(noiseGain);
  noiseGain.connect(formant1);
  noiseGain.connect(formant2);

  formant1.connect(gain);
  formant2.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  buzz.start(now);
  noise.start(now);

  // Voice envelope: onset, sustain, fade
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.06);
  gain.gain.setTargetAtTime(volume * 0.65, now + 0.12, 0.08);
  gain.gain.setTargetAtTime(0, now + 0.45, 0.12);

  buzz.stop(now + 0.7);
  noise.stop(now + 0.7);
}

function _playSFX(ctx, noteIndex) {
  // Event/object sounds: sharp, bright, bell-like, percussive
  const freq = SFX_NOTES[noteIndex % SFX_NOTES.length];
  const noteCount = noteIndex + 1;
  const volume = 0.12 + (noteCount / MAX_NOTES) * 0.3;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2.756; // Inharmonic ratio for metallic/bell sound

  const gain2 = ctx.createGain();
  gain2.gain.value = 0.4;

  osc1.connect(gain);
  osc2.connect(gain2);
  gain2.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  osc1.start(now);
  osc2.start(now);

  // Sharp attack, quick decay — like a bell hit
  gain.gain.setValueAtTime(volume, now);
  gain.gain.setTargetAtTime(volume * 0.15, now + 0.01, 0.04);
  gain.gain.setTargetAtTime(0, now + 0.2, 0.15);

  osc1.stop(now + 0.6);
  osc2.stop(now + 0.6);
}

// ============================================================
// AUDIO (Web Audio API)
// ============================================================
function initAudio() {
  if (state.audioCtx) {
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    return;
  }
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
}

// Pre-init audio on first user touch (iOS requirement)
document.addEventListener('touchstart', function initAudioOnTouch() {
  initAudio();
  document.removeEventListener('touchstart', initAudioOnTouch);
}, { once: true });

function updateAudioForSize(size) {
  // No longer used — kept as stub for compatibility
}

function stopAudio() {
  // No longer used — kept as stub for compatibility
}

// ============================================================
// ANIMATE PHASE
// ============================================================
// ============================================================
// DRUM RHYTHM PHASE (Temporal pacing)
// ============================================================
// ============================================================
// DRUM RHYTHM PHASE — 2-round design
// Round 0: Intro (demo hands)
// Round 1: Free play (child's own tempo)
// ============================================================
function setupAnimatePhase() {
  const drumArea = document.getElementById('drum-area');
  const drumImg = document.getElementById('drum-img');
  const taikoTrack = document.getElementById('taiko-track');
  const taikoNotes = document.getElementById('taiko-notes');
  const taikoTarget = document.getElementById('taiko-target');
  const hands = document.getElementById('drum-hands');
  // Use canvas topbar instruction area for drum hints
  const instructionEl = document.getElementById('canvas-instruction');

  // Data collection per session (3 sessions for SMT reliability — Provasi & Bobin-Bègue 2003)
  const drumData = {
    sessions: [[], [], []],  // tap timestamps per session
  };

  let currentRound = 0;        // 0 = Demo, 1..3 = Free sessions
  const SESSIONS_TOTAL = 3;
  const BEAT_INTERVAL = 700;
  const FREE_TAPS_NEEDED = 30;
  let roundTimer = null;
  let introTimer = null;
  let drumEnabled = false;

  // Magic Energy buildup state — see SENSE/docs/plans/2026-05-07-drum-flow-redesign.md
  const chargeCounts = new WeakMap();
  let totalTaps = 0;
  let lastTargetIdx = -1;

  // Clean up any previous drum session
  if (state._cleanupDrum) state._cleanupDrum();

  // Warm up audio
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  state.audioCtx.resume();

  // Remove adjust handlers from elements
  document.querySelectorAll('.canvas-element').forEach(el => {
    el.classList.remove('audio-adjustable', 'lights-adjustable');
    el._audioClickHandler && el.removeEventListener('pointerdown', el._audioClickHandler);
    el._lightsClickHandler && el.removeEventListener('pointerdown', el._lightsClickHandler);
  });

  // --- Core drum tap handler ---
  function onDrumTap(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!drumEnabled) return;

    const now = Date.now();
    // Capture pointer coords (viewport-relative) so visual effects spawn under the finger,
    // not at drum center (which can drift due to idle bob transform on iPad)
    const tapX = (e.clientX != null) ? e.clientX :
                 (e.touches && e.touches[0]) ? e.touches[0].clientX : null;
    const tapY = (e.clientY != null) ? e.clientY :
                 (e.touches && e.touches[0]) ? e.touches[0].clientY : null;

    // Visual + sound feedback (match hdDrumHit duration in style-handdrawn.css)
    drumImg.classList.add('hit');
    setTimeout(() => drumImg.classList.remove('hit'), 280);
    const ripple = document.createElement('div');
    ripple.className = 'drum-ripple';
    document.getElementById('drum-hits').appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
    playDrumHit(currentRound);

    // Record data per session (currentRound 1..3 = free sessions 0..2)
    if (currentRound >= 1 && currentRound <= SESSIONS_TOTAL) {
      const sessionIdx = currentRound - 1;
      drumData.sessions[sessionIdx].push(now);
      const tapCount = drumData.sessions[sessionIdx].length;
      totalTaps += 1;
      updateEnergyBar(tapCount, tapX, tapY);

      // Magic Energy buildup: spawn wave from drum → charge a target element
      // (uniform per-tap feedback; no rate-dependent reward — preserves SMT measurement)
      const target = pickWakeTarget();
      spawnEnergyWave(target, currentRound, tapX, tapY);
      updateBackgroundBrightness(currentRound, tapCount);
      updateVignetteIntensity(currentRound, tapCount);
      triggerShakeIfLateS3(currentRound, tapCount);
      // Interaction boost (2026-05-07): whole canvas reacts to each tap
      pulseAllCanvasElements();
      spawnSplashParticles(currentRound, tapX, tapY);

      if (tapCount >= FREE_TAPS_NEEDED) {
        drumEnabled = false;
        // Light up the corresponding magic meter segment + spawn sparkles
        const seg = document.getElementById(`magic-seg-${sessionIdx + 1}`);
        if (seg) seg.classList.add('lit');
        spawnSparkles(sessionIdx === SESSIONS_TOTAL - 1 ? 24 : 14);
        sessionCompleteEffect(sessionIdx);
        // Per Yue 2026-05-07: skip theme.complete center-text (only "Go!" allowed)
        if (sessionIdx < SESSIONS_TOTAL - 1) {
          setTimeout(() => startFreeRound(sessionIdx + 1), 1100);
        } else {
          setTimeout(() => spawnSparkles(20), 200);
          setTimeout(() => finishDrum(), 1500);
        }
      }
    }

    logEvent('drum_tap', { round: currentRound, session: currentRound, timestamp: now });
  }

  drumArea._drumHandler && drumArea.removeEventListener('pointerdown', drumArea._drumHandler);
  drumArea._drumHandler = onDrumTap;
  drumArea.addEventListener('pointerdown', onDrumTap);

  // --- UI helpers ---
  // Put round indicators into the topbar instruction area
  const roundLabels = ['Demo', '🆓 1', '🆓 2', '🆓 3'];

  // Per-session "energy magic" narrative — adapts to event
  const SESSION_THEMES = {
    school: [
      { intro: '✨ Charge the magic! (1/3)', desc: 'Wake up the classroom!',      complete: '⚡ Lights coming on!' },
      { intro: '🎒 Add more energy! (2/3)', desc: 'Friends are arriving!',        complete: '🎵 Almost ready!' },
      { intro: '🏫 Final burst! (3/3)',     desc: 'Morning circle time!',         complete: '🎉 Off to school!' },
    ],
    grocery: [
      { intro: '✨ Charge the magic! (1/3)', desc: 'Wake up the store!',          complete: '⚡ Lights flickering on!' },
      { intro: '🛒 Add more energy! (2/3)', desc: 'Carts are rolling!',           complete: '🎵 Aisles coming alive!' },
      { intro: '🥦 Final burst! (3/3)',     desc: 'Time to shop!',                complete: '🎉 Off to the store!' },
    ],
    dining: [
      { intro: '✨ Charge the magic! (1/3)', desc: 'Wake up the restaurant!',     complete: '⚡ Lights are on!' },
      { intro: '🍽️ Add more energy! (2/3)', desc: 'Tables setting themselves!',   complete: '🎵 Food on its way!' },
      { intro: '🍝 Final burst! (3/3)',     desc: 'Time to eat!',                 complete: '🎉 Off to dinner!' },
    ],
    // legacy
    birthday: [
      { intro: '✨ Charge the magic! (1/3)', desc: 'Wake up the party!',     complete: '⚡ Sparks flying!' },
      { intro: '🎈 Add more energy! (2/3)', desc: 'Decorations coming alive!', complete: '🎵 Magic is brewing!' },
      { intro: '🎂 Final burst! (3/3)',     desc: 'Light the candles!',       complete: '🎉 Off to your party!' },
    ],
    playground: [
      { intro: '✨ Charge the magic! (1/3)', desc: 'Wake up the playground!',   complete: '⚡ Friends arriving!' },
      { intro: '🛝 Add more energy! (2/3)', desc: 'Swings and slides start moving!', complete: '🎵 Almost there!' },
      { intro: '🌳 Final burst! (3/3)',     desc: 'Time to play!',              complete: '🎉 Off we go!' },
    ],
    _default: [
      { intro: '✨ Charge the magic! (1/3)', desc: 'Wake up your scene!',      complete: '⚡ Magic flowing!' },
      { intro: '🌟 Keep going! (2/3)',       desc: 'Your drawing is coming alive!', complete: '🎵 Nearly there!' },
      { intro: '🚀 Final burst! (3/3)',      desc: 'Bring it to life!',         complete: '🎉 Ready to fly!' },
    ],
  };
  function getTheme(idx) {
    const set = SESSION_THEMES[state.eventType] || SESSION_THEMES._default;
    return set[idx] || set[0];
  }

  // Spawn sparkle particles bursting out from drum center
  function spawnSparkles(count) {
    const drumCenter = document.querySelector('.drum-center');
    if (!drumCenter) return;
    const glyphs = ['✨', '⭐', '💫', '🌟', '🎵'];
    for (let i = 0; i < count; i++) {
      const sparkle = document.createElement('div');
      sparkle.className = 'sparkle-particle';
      sparkle.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      const angle = (i / count) * 360 + Math.random() * 25 - 12;
      const distance = 130 + Math.random() * 90;
      const rad = angle * Math.PI / 180;
      sparkle.style.setProperty('--dx', `${Math.cos(rad) * distance}px`);
      sparkle.style.setProperty('--dy', `${Math.sin(rad) * distance}px`);
      sparkle.style.fontSize = `${20 + Math.random() * 16}px`;
      drumCenter.appendChild(sparkle);
      setTimeout(() => sparkle.remove(), 1500);
    }
  }

  // === Interaction effects (2026-05-07) ===

  // Whole canvas "breathes" with each tap — strongest interactivity cue
  function pulseAllCanvasElements() {
    document.querySelectorAll('.canvas-element').forEach(el => {
      el.classList.remove('drum-tap-pulse');
      void el.offsetWidth;
      el.classList.add('drum-tap-pulse');
      setTimeout(() => el.classList.remove('drum-tap-pulse'), 280);
    });
  }

  // Small particles splash out from drum on each tap (separate from main star to energy bar)
  function spawnSplashParticles(sessionPhase, tapX, tapY) {
    let cx, cy;
    if (tapX != null && tapY != null) {
      cx = tapX; cy = tapY;
    } else if (drumImg) {
      const dRect = drumImg.getBoundingClientRect();
      cx = dRect.left + dRect.width / 2;
      cy = dRect.top + dRect.height * 0.4;
    } else {
      return;
    }
    const colors = sessionPhase === 1 ? ['#a3c9a8', '#86b5a3'] :
                   sessionPhase === 2 ? ['#ffd166', '#f0a04b'] :
                                        ['#ec6b4a', '#ff9b6c'];
    const count = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'drum-splash';
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.6;
      const dist = 60 + Math.random() * 50;
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist - 20}px`);
      p.style.background = colors[i % colors.length];
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  // Big visual + audio celebration when a session (30 taps) completes
  function sessionCompleteEffect(sessionIdx) {
    const overlay = document.getElementById('drum-overlay');
    if (overlay) {
      const flash = document.createElement('div');
      flash.className = `session-flash session-flash-s${sessionIdx + 1}`;
      overlay.appendChild(flash);
      setTimeout(() => flash.remove(), 700);
    }
    // Multi-directional star burst from drum center
    if (drumImg) {
      const dRect = drumImg.getBoundingClientRect();
      const cx = dRect.left + dRect.width / 2;
      const cy = dRect.top + dRect.height / 2;
      const burstCount = 14 + sessionIdx * 4; // S1 14, S2 18, S3 22
      for (let i = 0; i < burstCount; i++) {
        const angle = (Math.PI * 2 * i / burstCount) + (Math.random() - 0.5) * 0.4;
        const dist = 220 + Math.random() * 120;
        const star = document.createElement('div');
        star.className = 'energy-star burst-star';
        star.textContent = '✦';
        star.style.left = cx + 'px';
        star.style.top = cy + 'px';
        star.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        star.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        document.body.appendChild(star);
        setTimeout(() => star.remove(), 1100);
      }
    }
    // Rising chime: 4 ascending notes, pitch-shifted up per session
    playChime(sessionIdx);
    // Game-style victory flourish after the chime — happy upward swoop + cluster
    setTimeout(() => playVictoryFlourish(sessionIdx), 380);
  }

  // Cheerful "yay!" feel via pure audio: an upward glissando + bright cluster chord
  function playVictoryFlourish(sessionIdx) {
    const ctx = state.audioCtx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const pitchMul = 1 + sessionIdx * 0.15;

    // 1) Glissando swoop — sine sliding up, like "wheee!"
    const swoop = ctx.createOscillator();
    swoop.type = 'sine';
    swoop.frequency.setValueAtTime(440 * pitchMul, t);
    swoop.frequency.exponentialRampToValueAtTime(1100 * pitchMul, t + 0.22);
    const swoopGain = ctx.createGain();
    swoopGain.gain.setValueAtTime(0, t);
    swoopGain.gain.linearRampToValueAtTime(0.16, t + 0.02);
    swoopGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    swoop.connect(swoopGain); swoopGain.connect(ctx.destination);
    swoop.start(t); swoop.stop(t + 0.3);

    // 2) Major-chord cluster on the back end — happy resolve
    const chordRoot = 523.25 * pitchMul; // C5 base
    const chordIntervals = [1, 1.25, 1.5, 2]; // Root, M3, P5, octave
    const chordStart = t + 0.18;
    chordIntervals.forEach((mul, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 3 ? 'triangle' : 'sine';
      osc.frequency.value = chordRoot * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, chordStart);
      g.gain.linearRampToValueAtTime(0.07 - i * 0.01, chordStart + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, chordStart + 0.55);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(chordStart); osc.stop(chordStart + 0.6);
    });
  }

  // Play a 4-note ascending chime for session completion
  function playChime(sessionIdx) {
    const ctx = state.audioCtx;
    if (!ctx) return;
    // Pentatonic-ish ascending — pleasant, not jarring
    const baseNotes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const pitchMul = 1 + sessionIdx * 0.12; // S2 +12%, S3 +24%
    baseNotes.forEach((f, i) => {
      setTimeout(() => {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * pitchMul;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      }, i * 90);
    });
  }

  // === Magic Energy buildup helpers ===

  // Pick next element to receive an energy wave. Round-robin across canvas elements.
  // Returns null if no elements exist (caller falls back to drum-anchored wave).
  function pickWakeTarget() {
    const all = Array.from(document.querySelectorAll('.canvas-element'));
    if (all.length === 0) return null;
    lastTargetIdx = (lastTargetIdx + 1) % all.length;
    return all[lastTargetIdx];
  }

  // Spawn 1+ energy ring(s) flying from tap point → target. Charges the target on arrival.
  function spawnEnergyWave(targetEl, sessionPhase, tapX, tapY) {
    let drumCx, drumCy;
    if (tapX != null && tapY != null) {
      drumCx = tapX; drumCy = tapY;
    } else {
      const drumRect = drumImg.getBoundingClientRect();
      drumCx = drumRect.left + drumRect.width / 2;
      drumCy = drumRect.top + drumRect.height / 2;
    }

    // Build target list: primary + splash siblings (S2/S3)
    const targets = [];
    if (targetEl) {
      targets.push(targetEl);
      if (sessionPhase >= 2) {
        const all = Array.from(document.querySelectorAll('.canvas-element')).filter(el => el !== targetEl);
        const splashCount = sessionPhase === 2 ? 1 : 2;
        for (let i = 0; i < Math.min(splashCount, all.length); i++) {
          targets.push(all[(lastTargetIdx + i + 1) % all.length]);
        }
      }
    }
    // Fallback: aimless wave drifting outward from drum
    if (targets.length === 0) {
      const wave = document.createElement('div');
      wave.className = `energy-wave energy-wave-s${sessionPhase} energy-wave-aimless`;
      wave.style.left = `${drumCx}px`;
      wave.style.top = `${drumCy}px`;
      document.body.appendChild(wave);
      setTimeout(() => wave.remove(), 800);
      return;
    }

    const ringCount = sessionPhase === 3 ? 3 : 1;
    targets.forEach((tgt, idx) => {
      if (!tgt) return;
      const tRect = tgt.getBoundingClientRect();
      const tCx = tRect.left + tRect.width / 2;
      const tCy = tRect.top + tRect.height / 2;
      const dx = tCx - drumCx;
      const dy = tCy - drumCy;
      for (let r = 0; r < ringCount; r++) {
        const wave = document.createElement('div');
        wave.className = `energy-wave energy-wave-s${sessionPhase}`;
        wave.style.left = `${drumCx}px`;
        wave.style.top = `${drumCy}px`;
        wave.style.setProperty('--dx', `${dx}px`);
        wave.style.setProperty('--dy', `${dy}px`);
        wave.style.animationDelay = `${r * 0.08 + idx * 0.05}s`;
        document.body.appendChild(wave);
        setTimeout(() => wave.remove(), 900 + r * 80);
      }
      // Slight delay so charging visual aligns with wave arrival
      setTimeout(() => chargeElement(tgt, sessionPhase), 350);
    });
  }

  // Apply charge halo + (S2+) breathing pulse. Uniform per call (no rate dependence).
  function chargeElement(el, sessionPhase) {
    if (!el) return;
    const prev = chargeCounts.get(el) || 0;
    const next = prev + 1;
    chargeCounts.set(el, next);
    el.classList.add('charged');
    el.style.setProperty('--charge-level', Math.min(0.4, 0.1 + next * 0.05));
    // Brief shudder
    el.classList.remove('charge-shudder');
    void el.offsetWidth;
    el.classList.add('charge-shudder');
    setTimeout(() => el.classList.remove('charge-shudder'), 350);
    // Persistent breathing once enough charge accumulated (S2+)
    if (sessionPhase >= 2 && next >= 3) {
      el.classList.add('breathing');
      if (sessionPhase === 3) el.classList.add('breathing-fast');
    }
  }

  // Background brightness ramp (S2: 0→30%, S3: 30→60%) — by cumulative session taps, not tempo
  function updateBackgroundBrightness(sessionPhase, sessionTaps) {
    const overlay = document.getElementById('drum-overlay');
    if (!overlay) return;
    let pct = 0;
    if (sessionPhase === 2) pct = (sessionTaps / FREE_TAPS_NEEDED) * 30;
    else if (sessionPhase === 3) pct = 30 + (sessionTaps / FREE_TAPS_NEEDED) * 30;
    overlay.style.setProperty('--bg-brightness-pct', pct);
  }

  // Vignette glow at screen edges (S3 only)
  function updateVignetteIntensity(sessionPhase, sessionTaps) {
    const overlay = document.getElementById('drum-overlay');
    if (!overlay) return;
    if (sessionPhase < 3) {
      overlay.style.setProperty('--vignette-intensity', 0);
      return;
    }
    overlay.style.setProperty('--vignette-intensity', Math.min(0.6, sessionTaps / FREE_TAPS_NEEDED * 0.6));
  }

  // Subtle screen shake on the last 5 taps of S3 — per-tap, fixed 100ms (tempo-independent)
  function triggerShakeIfLateS3(sessionPhase, sessionTapCount) {
    if (sessionPhase !== 3 || sessionTapCount < FREE_TAPS_NEEDED - 5) return;
    const overlay = document.getElementById('drum-overlay');
    if (!overlay) return;
    overlay.classList.remove('drum-shake');
    void overlay.offsetWidth;
    overlay.classList.add('drum-shake');
    setTimeout(() => overlay.classList.remove('drum-shake'), 110);
  }

  // Reset meter on entry (in case re-entering drum stage)
  for (let i = 1; i <= SESSIONS_TOTAL; i++) {
    const seg = document.getElementById(`magic-seg-${i}`);
    if (seg) seg.classList.remove('lit');
  }
  function setRound(r) {
    currentRound = r;
    // Round indicators removed per Yue 2026-05-07 — only the per-session hint text remains
    instructionEl.innerHTML = '';
  }

  function updateProgress(current, total) {
    // No separate progress bar — visual feedback through round indicators is enough
  }

  function showCountdown(text, callback) {
    const overlay = document.createElement('div');
    overlay.className = 'countdown-number';
    overlay.textContent = text;
    document.querySelector('.drum-center').appendChild(overlay);
    setTimeout(() => { overlay.remove(); if (callback) callback(); }, 800);
  }

  function runCountdown(callback, briefHint) {
    drumEnabled = false;
    // Per Yue 2026-05-07: only "Go!" — drop brief hint + "3/2/1" (too many words too fast)
    showCountdown('Go!', callback);
  }

  // --- Round 0: Intro ---
  function startIntro() {
    setRound(0);
    hands.style.display = '';
    hands.classList.remove('tapped');
    if (taikoTrack) taikoTrack.classList.remove('visible');
    instructionEl.textContent = 'Watch and learn!';
    drumEnabled = false;

    let introBeats = 0;
    introTimer = setInterval(() => {
      if (currentRound !== 0) return;
      playDrumHit(currentRound);
      drumImg.classList.add('hit');
      setTimeout(() => drumImg.classList.remove('hit'), 280);
      introBeats++;
      updateProgress(introBeats, 6);
      if (introBeats >= 6) {
        clearInterval(introTimer); introTimer = null;
        hands.classList.add('tapped');
        setTimeout(() => startFreeRound(0), 500);
      }
    }, BEAT_INTERVAL);
  }

  function clearAllTimers() {
    if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }
    if (introTimer) { clearInterval(introTimer); introTimer = null; }
  }

  // Store cleanup function so re-entry can stop previous session
  state._cleanupDrum = () => {
    clearAllTimers();
    drumEnabled = false;
    const overlay = document.getElementById('drum-overlay');
    if (overlay) {
      overlay.classList.remove('drum-s1', 'drum-s2', 'drum-s3', 'drum-shake');
      overlay.style.removeProperty('--bg-brightness-pct');
      overlay.style.removeProperty('--vignette-intensity');
    }
    document.querySelectorAll('.canvas-element.charged, .canvas-element.breathing').forEach(el => {
      el.classList.remove('charged', 'charge-shudder', 'breathing', 'breathing-fast');
      el.style.removeProperty('--charge-level');
    });
  };

  // --- Free play sessions (1 of 3, 2 of 3, 3 of 3) ---
  function startFreeRound(sessionIdx) {
    clearAllTimers();
    setRound(sessionIdx + 1);  // 1, 2, or 3
    const theme = getTheme(sessionIdx);
    if (taikoTrack) taikoTrack.classList.remove('visible');
    instructionEl.textContent = theme.desc;

    // Set phase class on drum overlay (S1/S2/S3 visual signature)
    const overlay = document.getElementById('drum-overlay');
    if (overlay) {
      overlay.classList.remove('drum-s1', 'drum-s2', 'drum-s3');
      overlay.classList.add(`drum-s${sessionIdx + 1}`);
    }

    // Reset and rebuild energy bar each session
    taikoNotes.innerHTML = '';
    taikoTarget.style.display = 'none';
    const oldBar = document.getElementById('free-energy-bar');
    if (oldBar) oldBar.remove();
    const energyBar = document.createElement('div');
    energyBar.className = 'energy-bar-container';
    energyBar.id = 'free-energy-bar';
    for (let i = 0; i < FREE_TAPS_NEEDED; i++) {
      const seg = document.createElement('div');
      seg.className = 'energy-seg';
      energyBar.appendChild(seg);
    }
    taikoTrack.appendChild(energyBar);
    taikoTrack.classList.add('visible');

    // Themed intro before countdown
    runCountdown(() => {
      drumEnabled = true;
    }, theme.intro);
  }

  function updateEnergyBar(tapCount, tapX, tapY) {
    const bar = document.getElementById('free-energy-bar');
    if (!bar) return;
    const segs = bar.querySelectorAll('.energy-seg');
    const targetSeg = segs[tapCount - 1];
    if (!targetSeg || targetSeg.classList.contains('lit') || targetSeg.dataset.starInflight) return;
    flyStarToSeg(targetSeg, tapX, tapY);
  }

  // Star flies from tap point → target energy-bar segment, then lights it on arrival
  function flyStarToSeg(targetSeg, tapX, tapY) {
    if (!targetSeg) return;
    targetSeg.dataset.starInflight = '1';
    let startX, startY;
    if (tapX != null && tapY != null) {
      startX = tapX; startY = tapY;
    } else if (drumImg) {
      const dRect = drumImg.getBoundingClientRect();
      startX = dRect.left + dRect.width / 2;
      startY = dRect.top + dRect.height * 0.4;
    } else {
      return;
    }
    const tRect = targetSeg.getBoundingClientRect();
    const endX = tRect.left + tRect.width / 2;
    const endY = tRect.top + tRect.height / 2;

    const star = document.createElement('div');
    star.className = 'energy-star';
    star.textContent = '✦';
    star.style.left = startX + 'px';
    star.style.top = startY + 'px';
    star.style.setProperty('--dx', (endX - startX) + 'px');
    star.style.setProperty('--dy', (endY - startY) + 'px');
    document.body.appendChild(star);

    star.addEventListener('animationend', () => {
      targetSeg.classList.add('lit');
      delete targetSeg.dataset.starInflight;
      star.remove();
    }, { once: true });
  }

  // --- Finish: compute SMT as median ISI across all 3 sessions ---
  function finishDrum() {
    clearAllTimers();
    instructionEl.textContent = 'Great job!';

    state.drumData = drumData;

    const allIntervals = [];
    drumData.sessions.forEach(session => {
      for (let i = 1; i < session.length; i++) {
        allIntervals.push(session[i] - session[i - 1]);
      }
    });

    if (allIntervals.length >= 2) {
      const sorted = [...allIntervals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
      state.drumAvgInterval = median;     // SMT (median ISI across all sessions)
      state.drumIntervals = allIntervals;
      state.drumSessions = drumData.sessions.map(s => [...s]);
      state.drumSessionMedians = drumData.sessions.map(s => {
        if (s.length < 2) return null;
        const ints = [];
        for (let i = 1; i < s.length; i++) ints.push(s[i] - s[i - 1]);
        const sorted = [...ints].sort((a, b) => a - b);
        const m = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
          ? Math.round((sorted[m - 1] + sorted[m]) / 2)
          : sorted[m];
      });
    }

    logEvent('drum_complete', {
      sessionsTaps: drumData.sessions.map(s => s.length),
      sessionMedians: state.drumSessionMedians,
      drumSMT: state.drumAvgInterval,
    });

    // Trigger drum AI + final summary in parallel
    triggerStageAI('drum');
    if (!state._aiSummaryPromise) {
      state._aiSummaryPromise = callFinalSummary();
    }

    setTimeout(() => goToPhase('processing'), 1200);
  }

  // Start!
  startIntro();
}

function updateCanvasAnimationSpeed(intervalMs) {
  const speed = Math.max(0.3, Math.min(2, intervalMs / 500));
  const cycleMs = speed * 1000;

  document.querySelectorAll('.canvas-element').forEach(el => {
    // Try sprite animation first
    const usedSprite = startSpriteAnimation(el, cycleMs);

    // Fall back to CSS animation
    if (!usedSprite) {
      const type = el.dataset.type;
      const animName = ANIMATION_MAP[type];
      if (animName) {
        el.style.animation = `${animName} ${speed}s ease-in-out infinite`;
      }
    }
  });
}

// Drum hit — synthesized; same sound across all 3 sessions per Yue 2026-05-07
// (S1 sounded most natural, so we drop pitch/overtone escalation)
function playDrumHit(sessionPhase) {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;
  ctx.resume().then(() => {
    const now = ctx.currentTime;

    // 1. Drum body
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(180, now);
    body.frequency.exponentialRampToValueAtTime(60, now + 0.15);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.5, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    // 2. Warmth harmonic
    const body2 = ctx.createOscillator();
    body2.type = 'triangle';
    body2.frequency.setValueAtTime(90, now);
    body2.frequency.exponentialRampToValueAtTime(40, now + 0.2);
    const body2Gain = ctx.createGain();
    body2Gain.gain.setValueAtTime(0.3, now);
    body2Gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    // 3. Stick hit (bandpass noise)
    const bufferSize = Math.floor(ctx.sampleRate * 0.08);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 3000;
    noiseFilter.Q.value = 1.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);

    body.connect(bodyGain); bodyGain.connect(ctx.destination);
    body2.connect(body2Gain); body2Gain.connect(ctx.destination);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(ctx.destination);

    body.start(now); body2.start(now); noise.start(now);
    body.stop(now + 0.3); body2.stop(now + 0.35); noise.stop(now + 0.08);
  });
}

// ============================================================
// PREFERENCE EXTRACTION
// ============================================================
function extractPreferences() {
  const avatar = state.placedElements.find(e => e.type === 'avatar');
  const container = document.getElementById('canvas-container');
  const maxDist = container
    ? Math.sqrt(container.offsetWidth ** 2 + container.offsetHeight ** 2)
    : 1000;

  // SPATIAL: average distance of friends/spatial elements from avatar
  const spatialElems = state.placedElements.filter(e => e.dimension === 'spatial');
  let spatialScore = 0.5;
  if (avatar && spatialElems.length > 0) {
    const avgDist = spatialElems.reduce((sum, f) => {
      return sum + Math.sqrt((f.x - avatar.x) ** 2 + (f.y - avatar.y) ** 2);
    }, 0) / spatialElems.length;
    spatialScore = Math.min(1, avgDist / (maxDist * 0.5));
  }

  // AUDITORY: derived from Sound phase staff placements (last value per element type).
  // Falls back to placed auditory-dimension sprites when Sound phase has no data.
  const staffByType = {};
  for (const ev of state.interactionLog) {
    if (ev.event === 'staff_element_set') staffByType[ev.type] = ev;
  }
  const staffSettings = Object.values(staffByType);
  const audioElems = state.placedElements.filter(e => e.dimension === 'auditory');
  let auditoryScore = 0.5;
  let staffPitchAvg = null, staffVolumeAvg = null;
  const auditoryLayerCount = staffSettings.length;
  if (auditoryLayerCount > 0) {
    staffPitchAvg = staffSettings.reduce((s, e) => s + (e.pitch ?? 0), 0) / auditoryLayerCount / 100;
    staffVolumeAvg = staffSettings.reduce((s, e) => s + (e.volume ?? 0), 0) / auditoryLayerCount / 100;
    // Composite: volume drives felt loudness; pitch and layering add complexity
    auditoryScore = 0.5 * staffVolumeAvg + 0.3 * staffPitchAvg + 0.2 * (auditoryLayerCount / 3);
    auditoryScore = Math.max(0, Math.min(1, auditoryScore));
  } else if (audioElems.length > 0) {
    const avgNotes = audioElems.reduce((sum, e) => {
      return sum + ((e.volumeLevel !== undefined ? e.volumeLevel : 2) / MAX_NOTES);
    }, 0) / audioElems.length;
    auditoryScore = avgNotes;
  }

  // VISUAL: blend of color saturation (Color stage) and brightness (Light stage)
  // Both signal "how much visual stimulation child wants"; equal weight when both available.
  const realStrokes = state.colorStrokes.filter(s => s.color !== 'eraser');
  const haveColor = realStrokes.length > 0;
  const lightBrightness = state.lightData?.brightness ?? null;
  const lightArc = state.lightData?.arcPosition ?? null;
  const normBright = normalizeLightBrightness(lightBrightness);
  const haveLight = normBright !== null;

  // avgSaturation: normalized perceptual chroma (CIE Lab C*), averaged over the
  // child's *swatch selections* — not stroke area. Rationale: selection moment is
  // the preference signal (ASD color-aversion lit shows up in choice, not stroke
  // size); stroke area mostly reflects motor execution. Falls back to strokes
  // when no selection history exists.
  let avgSaturation = null;
  const selections = state.colorSelections.filter(h => h && h !== 'eraser');
  if (selections.length > 0) {
    const cVals = selections.map(getColorSaturation);
    avgSaturation = cVals.reduce((a, b) => a + b, 0) / cVals.length;
  } else if (haveColor) {
    // Backward-compat: if no selection events captured (legacy session / external draw),
    // fall back to stroke-averaged chroma.
    const satValues = realStrokes.map(s => getColorSaturation(s.color));
    avgSaturation = satValues.reduce((a, b) => a + b, 0) / satValues.length;
  }
  const haveChroma = avgSaturation !== null;

  let visualScore = 0.5;
  if (haveChroma && haveLight) {
    visualScore = 0.5 * avgSaturation + 0.5 * normBright;
  } else if (haveChroma) {
    visualScore = avgSaturation;
  } else if (haveLight) {
    visualScore = normBright;
  }

  // TEMPORAL: from drum rhythm — faster tapping = higher score
  let temporalScore = 0.5;
  if (state.drumAvgInterval) {
    // Map: 200ms (very fast) → 1.0, 1000ms (very slow) → 0.0
    temporalScore = Math.max(0, Math.min(1, (1000 - state.drumAvgInterval) / 800));
  }

  return {
    spatial: { score: spatialScore, friendCount: spatialElems.length },
    auditory: {
      score: auditoryScore,
      staffPitch: staffPitchAvg,
      staffVolume: staffVolumeAvg,
      layerCount: auditoryLayerCount,
      elementCount: audioElems.length,
    },
    visual: {
      score: visualScore,
      avgSaturation,
      strokeCount: realStrokes.length,
      lightBrightness,
      lightArcPosition: lightArc,
      timeOfDay: getTimeOfDay(lightArc),
    },
    temporal: {
      score: temporalScore,
      smt: state.drumAvgInterval ?? null,   // median ISI in ms (alias for spec field "drumSMT")
      animatedCount: state.animatedElements.size,
      totalCount: state.placedElements.filter(e => e.type !== 'avatar').length,
    },
  };
}

// Perceptual chroma from a hex color, via CIE Lab.
// Returns C*ab normalized to ~[0, 1] (typical max ~120 for vivid sRGB, clamped).
// HSL "saturation" has no perceptual meaning (Aurélien Pierre 2022; Wikipedia HSL),
// so we route through Lab C* (Lch chroma) instead, which is approximately
// perceptually linear and matches the "vividness" axis ASD sensory work cares about.
function getColorSaturation(hexColor) {
  if (!hexColor || hexColor.length < 7) return 0;
  // sRGB → linear RGB
  const srgb = [
    parseInt(hexColor.slice(1, 3), 16) / 255,
    parseInt(hexColor.slice(3, 5), 16) / 255,
    parseInt(hexColor.slice(5, 7), 16) / 255,
  ];
  const lin = srgb.map(c => (c <= 0.04045) ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  // Linear RGB → XYZ (D65)
  const X = lin[0] * 0.4124564 + lin[1] * 0.3575761 + lin[2] * 0.1804375;
  const Y = lin[0] * 0.2126729 + lin[1] * 0.7151522 + lin[2] * 0.0721750;
  const Z = lin[0] * 0.0193339 + lin[1] * 0.1191920 + lin[2] * 0.9503041;
  // XYZ → Lab (D65 white point)
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const f = (t) => (t > 0.008856) ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  const cStar = Math.sqrt(a * a + b * b);
  // Normalize: 0 = neutral gray; vivid sRGB tops out around C*≈120. Clamp to [0,1].
  return Math.max(0, Math.min(1, cStar / 120));
}

// ============================================================
// AI BEHAVIOR AGENT
// ============================================================

function captureStageScreenshot() {
  try {
    const container = document.getElementById('canvas-container');
    const bgCanvas = document.getElementById('bg-canvas');
    const colorCanvas = document.getElementById('color-canvas');
    const composite = document.createElement('canvas');
    composite.width = bgCanvas.width;
    composite.height = bgCanvas.height;
    const ctx = composite.getContext('2d');
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.drawImage(colorCanvas, 0, 0);
    const cRect = container.getBoundingClientRect();
    document.querySelectorAll('.canvas-element').forEach(el => {
      const img = el.querySelector('img');
      if (!img || !img.naturalWidth) return;
      const eRect = el.getBoundingClientRect();
      const x = (eRect.left - cRect.left) / cRect.width * composite.width;
      const y = (eRect.top - cRect.top) / cRect.height * composite.height;
      const w = eRect.width / cRect.width * composite.width;
      const h = eRect.height / cRect.height * composite.height;
      try { ctx.drawImage(img, x, y, w, h); } catch(e) {}
    });
    return composite.toDataURL('image/jpeg', 0.7);
  } catch(e) {
    console.warn('captureStageScreenshot failed:', e);
    return null;
  }
}

function buildBehaviorData() {
  const prefs = extractPreferences();
  const realStrokes = state.colorStrokes.filter(s => s.color !== 'eraser');
  const colorCounts = {};
  realStrokes.forEach(s => { colorCounts[s.color] = (colorCounts[s.color] || 0) + 1; });

  return {
    preferences: prefs,
    phaseDurations: state.phaseDurations,
    color: {
      strokeCount: realStrokes.length,
      eraserUses: state.colorStrokes.filter(s => s.color === 'eraser').length,
      colorDistribution: colorCounts,
      avgBrushSize: realStrokes.length > 0
        ? Math.round(realStrokes.reduce((s, st) => s + st.width, 0) / realStrokes.length) : 0,
    },
    elements: {
      placedCount: state.placedElements.length,
      friendCount: state.placedElements.filter(e => e.type === 'friend').length,
      deletions: state.interactionLog.filter(e => e.event === 'element_deleted').length,
      repositions: state.interactionLog.filter(e => e.event === 'element_moved').length,
    },
    light: {
      arcPosition: state.lightData?.arcPosition ?? null,
      brightness: state.lightData?.brightness ?? null,
      timeOfDay: getTimeOfDay(state.lightData?.arcPosition),
    },
    drum: {
      freeAvgInterval: state.drumAvgInterval || null,
    },
  };
}

// Call AI for a single stage observation (runs in background)
async function callStageObservation(stageName, stageData, screenshot) {
  if (!API_BASE) return null;

  try {
    const resp = await fetch(API_BASE + '/api/ai-observation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        behaviorData: { stage: stageName, ...stageData },
        screenshots: screenshot ? { [stageName]: screenshot } : {},
        mode: 'single_stage',
      }),
    });
    const data = await resp.json();
    if (data.result) {
      const jsonMatch = data.result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.observation || parsed.summary || '';
      }
    }
  } catch (e) {
    console.warn(`AI observation for ${stageName} failed:`, e);
  }
  return null;
}

// Fire AI observation in background after each stage
function triggerStageAI(stageName) {
  if (!API_BASE) return;

  const stageData = {};
  let screenshot = null;

  if (stageName === 'create') {
    stageData.placedCount = state.placedElements.length;
    stageData.friendCount = state.placedElements.filter(e => e.type === 'friend').length;
    stageData.deletions = state.interactionLog.filter(e => e.event === 'element_deleted').length;
    stageData.repositions = state.interactionLog.filter(e => e.event === 'element_moved').length;
    screenshot = state.stageScreenshots.elements;
  } else if (stageName === 'color') {
    const realStrokes = state.colorStrokes.filter(s => s.color !== 'eraser');
    stageData.strokeCount = realStrokes.length;
    stageData.eraserUses = state.colorStrokes.filter(s => s.color === 'eraser').length;
    const colorCounts = {};
    realStrokes.forEach(s => { colorCounts[s.color] = (colorCounts[s.color] || 0) + 1; });
    stageData.colorDistribution = colorCounts;
    stageData.avgBrushSize = realStrokes.length > 0
      ? Math.round(realStrokes.reduce((s, st) => s + st.width, 0) / realStrokes.length) : 0;
    screenshot = state.stageScreenshots.color;
  } else if (stageName === 'light') {
    stageData.arcPosition = state.lightData?.arcPosition ?? null;
    stageData.brightness = state.lightData?.brightness ?? null;
    stageData.timeOfDay = getTimeOfDay(state.lightData?.arcPosition);
    screenshot = state.stageScreenshots.light;
  } else if (stageName === 'sound') {
    screenshot = state.stageScreenshots.sound;
  } else if (stageName === 'drum') {
    stageData.freeAvgInterval = state.drumAvgInterval || null;
  }

  stageData.phaseDuration = state.phaseDurations[stageName] || 0;

  // Store promise in state for processing page to await
  if (!state._aiStageResults) state._aiStageResults = {};
  state._aiStageResults[stageName] = callStageObservation(stageName, stageData, screenshot);
  console.log(`AI observation triggered for: ${stageName}`);
}

// Call for final summary (uses all data)
async function callFinalSummary() {
  if (!API_BASE) return null;

  try {
    const resp = await fetch(API_BASE + '/api/ai-observation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        behaviorData: buildBehaviorData(),
        screenshots: state.stageScreenshots,
        mode: 'summary',
      }),
    });
    const data = await resp.json();
    if (data.result) {
      const jsonMatch = data.result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('AI summary call failed:', e);
  }
  return null;
}

// ============================================================
// DATA EXPORT
// ============================================================
function exportData() {
  const data = {
    timestamp: new Date().toISOString(),
    eventType: state.eventType,
    preferences: extractPreferences(),
    placedElements: state.placedElements,
    colorStrokes: state.colorStrokes.map(s => ({
      color: s.color,
      width: s.width,
      pointCount: s.points.length,
    })),
    animatedElements: [...state.animatedElements],
    interactionLog: state.interactionLog,
    totalDuration: Date.now() - state.sessionStart,
    phaseDurations: state.phaseDurations,
    // Phase 2 customization layer — populated once the difficulty modal closes.
    // Until then level_selected is null and manual_adjustments is empty.
    difficulty: state.difficultyMeta,
    condition_contaminated: state.condition_contaminated,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sense-data-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// PROCESSING SCREEN
// ============================================================
function runProcessing() {
  const stageNames = ['create', 'color', 'sound', 'drum'];
  const stageLabels = ['🎨 Create', '🖍️ Color', '🎵 Sound', '🥁 Rhythm'];
  const observationEl = document.getElementById('ai-observation');
  const summaryEl = document.getElementById('ai-summary');
  const stepsContainer = document.getElementById('processing-steps');

  // Reset
  if (observationEl) { observationEl.textContent = ''; observationEl.classList.remove('visible'); }
  if (summaryEl) { summaryEl.textContent = ''; summaryEl.classList.remove('visible'); }

  // Replace processing steps with stage observations
  stepsContainer.innerHTML = '';
  stageNames.forEach((name, i) => {
    const step = document.createElement('div');
    step.className = 'processing-step';
    step.id = `step-${name}`;
    step.innerHTML = `<span class="step-dot"></span><span class="step-label">${stageLabels[i]}</span><span class="step-observation" id="obs-${name}"></span>`;
    stepsContainer.appendChild(step);
  });

  // Show each stage's cached AI result one by one
  const results = state._aiStageResults || {};
  let i = 0;

  const interval = setInterval(async () => {
    if (i < stageNames.length) {
      const name = stageNames[i];
      const stepEl = document.getElementById(`step-${name}`);
      const obsEl = document.getElementById(`obs-${name}`);
      const dotEl = stepEl?.querySelector('.step-dot');

      if (stepEl) stepEl.classList.add('active');
      if (dotEl) dotEl.classList.add('active');

      // Get cached result (already fetched during stage transition)
      if (results[name]) {
        const observation = await results[name];
        if (observation && obsEl) {
          obsEl.textContent = observation;
          obsEl.classList.add('visible');
        }
      }
      i++;
    } else {
      clearInterval(interval);

      // Show final summary
      const summaryResult = state._aiSummaryPromise ? await state._aiSummaryPromise : null;
      if (summaryResult && summaryResult.summary && summaryEl) {
        summaryEl.textContent = summaryResult.summary;
        summaryEl.classList.add('visible');
        setTimeout(() => goToPhase('transition'), 4000);
      } else {
        setTimeout(() => goToPhase('transition'), 1000);
      }
    }
  }, 1500);
}

// ============================================================
// VIDEO PLAYER (Stage 2 — simplified)
// ============================================================
let videoPreferences = null;
let currentLevel = 2; // 1=gentle, 2=baseline, 3=challenge — kept for fab-level UI compat

// Dev overrides: continuous sub-dims (brightness/saturation/pitch/voice/bgm/sfx) take a
// number in 0..1 (from a slider) when overriding; `prep` takes a bucket key
// ('hyper'/'typical'/'hypo') when overriding. null = use canvas-derived value.
// `volume` is the legacy single-stem control; replaced by independent voice/bgm/sfx
// after Demucs source separation (2026-05-14).
let devOverrides = {
  brightness: null, saturation: null, pitch: null,
  voice: null, bgm: null, sfx: null,
  prep: null,
};

// Prep interval is bucketed (not continuous) per spec — see
// SENSE/paper/_design_notes/prep_cue_design_20260514.md.
// 3 anchor values from advisor meeting 2026-04-10 (Monier & Droit-Volet 2019;
// Los & Van den Heuvel 2001).
const PREP_BUCKETS = { hyper: 0.5, typical: 1.0, hypo: 1.5 };
function prepBucketFromSMT(smtMs) {
  if (typeof smtMs !== 'number') return 'typical';
  if (smtMs < 700)  return 'hyper';
  if (smtMs < 1100) return 'typical';
  return 'hypo';
}
let s2PauseTriggered = false;
// Audio chain (lowpass)
let videoMediaSource = null;  // legacy — unused when stems are wired
let videoLowpass = null;
let videoGain = null;          // legacy — replaced by per-stem gains

// Multi-stem audio: voice / bgm / sfx are 3 separate AudioBuffers decoded once
// from .wav files alongside the video. Each playback creates fresh
// AudioBufferSourceNodes that feed dedicated gain nodes → mixer → lowpass → master.
// The <video> element is muted; audio comes only through the Web Audio graph.
const STEM_KEYS = ['voice', 'bgm', 'sfx'];
// Per-event 3-stem audio. Each event has its own voice/bgm/sfx .wav alongside the video.
// birthday keeps its original Demucs filenames; other events follow the
// {event}_{stem}.flac convention (e.g. video/dental_voice.flac). Stems should match the
// video's duration; they start at the video offset and are cut when the video ends.
const STEM_FILES_BY_EVENT = {
  birthday: { voice: 'video/vocals.wav',         bgm: 'video/bgm.wav',          sfx: 'video/drums.wav' },
  dental:   { voice: 'video/dental_voice.flac',  bgm: 'video/dental_bgm.flac',  sfx: 'video/dental_sfx.flac' },
  grocery:  { voice: 'video/grocery_voice.flac', bgm: 'video/grocery_bgm.flac', sfx: 'video/grocery_sfx.flac' },
  dining:   { voice: 'video/dining_voice.flac',  bgm: 'video/dining_bgm.flac',  sfx: 'video/dining_sfx.flac' },
};
function stemFilesFor(eventType) {
  return STEM_FILES_BY_EVENT[eventType] || STEM_FILES_BY_EVENT.birthday;
}
let stemBuffers = { voice: null, bgm: null, sfx: null };
let stemGains   = { voice: null, bgm: null, sfx: null };
let stemSources = { voice: null, bgm: null, sfx: null };
let stemMixer = null;   // GainNode summing the 3 stem chains
let stemsLoading = null; // Promise — resolved when all 3 buffers decoded
let stemsPlaying = false;

// Per-event priming videos. Each scenario plays its own full Veo render. The video
// files carry no audio track — auditory personalization comes from 3 separate stems
// per event (see STEM_FILES_BY_EVENT), mixed through videoLowpass.
const VIDEO_BY_EVENT = {
  dental:  'video/dental.mp4',
  grocery: 'video/grocery.mp4',
  dining:  'video/dining.mp4',
};
const DEFAULT_VIDEO = 'video/birthday_party.mp4';
// Events with 3-stem (voice/bgm/sfx) audio. Unknown events fall back to the
// embedded-audio path in setupVideoAudioChain.
const EVENT_HAS_STEMS = { birthday: true, dental: true, grocery: true, dining: true };
let mediaElementSource = null; // MediaElementSourceNode for non-stem event videos
let audioChainBuilt = false;   // guards setupVideoAudioChain re-entry

// Temporal markers (% of duration) excluding 22% which is S2 pause
const TEMPORAL_MARKERS = [42, 61, 81];
let temporalMarkersFired = new Set();
let freezeCountdownTimer = null;

// ============================================================
// DIFFICULTY SYSTEM — anticipatory video customization layer
// Spec: docs/plans/2026-05-21-difficulty-system-ui-spec.md
// Design: docs/plans/2026-05-21-difficulty-system-ui-design.md
// ============================================================
// Three-level adjustment around the child's canvas-measured baseline:
//   protective: shift FURTHER from typical (toward child's extreme) by 0.15
//   normal:     baseline unchanged
//   challenge:  shift TOWARD typical (toward real-world stimulus) by 0.05
// Asymmetry (−15% / +5%) reflects accommodation-first philosophy.
const DIFFICULTY_TOLERANCE = 0.05;   // baseline within ±this of 0.5 → no displacement
// Step sizes are tunable at runtime via the panel's global shift sliders so
// caregivers can dial in how aggressive each level should be.
let PROTECTIVE_STEP = 0.15;
let CHALLENGE_STEP = 0.05;

const CONTINUOUS_CHANNELS = ['brightness', 'saturation', 'pitch', 'voice', 'bgm', 'sfx'];
const BUCKET_CHANNELS = ['spatial', 'prep'];
const ALL_CHANNELS = [...CONTINUOUS_CHANNELS, ...BUCKET_CHANNELS];

// Bucket order: index 0 = "low-side extreme", 1 = middle, 2 = "high-side extreme".
// Convention mirrors continuous channels' low=hyper/far/slow, high=hypo/close/fast.
const BUCKET_ORDER = {
  spatial: ['close', 'mid', 'far'],    // close (0) ↔ far (2); baseline derived from spatialScore
  prep:    ['hyper', 'typical', 'hypo'], // 0.5s (hyper) ↔ 1.5s (hypo)
};

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// Continuous channel: shift baseline per level.
function computeLevelValue(baseline, level) {
  if (typeof baseline !== 'number') return baseline;
  if (Math.abs(baseline - 0.5) <= DIFFICULTY_TOLERANCE) return baseline; // neutral middle
  if (level === 'normal' || !level) return baseline;
  const onLowSide = baseline < 0.5;
  if (level === 'protective') {
    return clamp01(baseline + (onLowSide ? -PROTECTIVE_STEP : +PROTECTIVE_STEP));
  }
  if (level === 'challenge') {
    return clamp01(baseline + (onLowSide ? +CHALLENGE_STEP : -CHALLENGE_STEP));
  }
  return baseline;
}

// Bucket channel: step toward middle on Challenge; stay at extreme on Protective (no headroom).
function computeBucketLevelValue(baselineBucket, level, channel) {
  const order = BUCKET_ORDER[channel];
  if (!order) return baselineBucket;
  const idx = order.indexOf(baselineBucket);
  if (idx < 0) return baselineBucket;
  if (level === 'normal' || !level || level === 'protective') return baselineBucket;
  if (level === 'challenge') {
    if (idx === 0) return order[1];   // step toward middle from low extreme
    if (idx === 2) return order[1];   // step toward middle from high extreme
    return baselineBucket;
  }
  return baselineBucket;
}

// spatialScore (0..1) → bucket. Matches the file-selection thresholds in initVideoPlayer.
function spatialBucketFromScore(score) {
  if (typeof score !== 'number') return 'mid';
  if (score > 0.65) return 'far';
  if (score < 0.35) return 'close';
  return 'mid';
}

// Populate state.baselinePerChannel from canvas-derived preferences.
function computeBaselinesFromPreferences(prefs) {
  if (!prefs) return;
  const lightB = prefs.visual.lightBrightness;
  const brightnessBase = (typeof lightB === 'number')
    ? (normalizeLightBrightness(lightB) ?? 0.5)
    : (prefs.visual.score ?? 0.5);
  const saturationBase = (typeof prefs.visual.avgSaturation === 'number')
    ? prefs.visual.avgSaturation
    : (prefs.visual.score ?? 0.5);
  const pitchBase = (typeof prefs.auditory.staffPitch === 'number')
    ? prefs.auditory.staffPitch
    : (prefs.auditory.score ?? 0.5);
  const volBase = (typeof prefs.auditory.staffVolume === 'number')
    ? prefs.auditory.staffVolume
    : (prefs.auditory.score ?? 0.5);

  state.baselinePerChannel = {
    brightness: clamp01(brightnessBase),
    saturation: clamp01(saturationBase),
    pitch:      clamp01(pitchBase),
    voice:      clamp01(volBase),
    bgm:        clamp01(volBase),
    sfx:        clamp01(volBase),
    spatial:    spatialBucketFromScore(prefs.spatial.score),
    prep:       prepBucketFromSMT(prefs.temporal.smt),
  };
  // Until difficulty is picked, applied == baseline.
  state.appliedPerChannel = { ...state.baselinePerChannel };
  state.difficultyMeta.baseline_per_channel = { ...state.baselinePerChannel };
  state.difficultyMeta.applied_per_channel = { ...state.appliedPerChannel };
}

// Recompute applied values from baselines + chosen difficulty level.
function recomputeAppliedFromDifficulty(level) {
  const base = state.baselinePerChannel;
  const applied = {};
  CONTINUOUS_CHANNELS.forEach(ch => {
    applied[ch] = computeLevelValue(base[ch], level);
  });
  BUCKET_CHANNELS.forEach(ch => {
    applied[ch] = computeBucketLevelValue(base[ch], level, ch);
  });
  state.appliedPerChannel = applied;
  state.difficultyMeta.applied_per_channel = { ...applied };
}

// Public API: set difficulty level (called from modal in Phase B).
function setDifficultyLevel(level, selectedBy) {
  if (!['protective', 'normal', 'challenge'].includes(level)) {
    console.warn('[difficulty] invalid level:', level);
    return;
  }
  state.difficultyLevel = level;
  state.difficultyMeta.level_selected = level;
  state.difficultyMeta.selected_by = selectedBy || 'child';
  state.difficultyMeta.selected_at = new Date().toISOString();
  recomputeAppliedFromDifficulty(level);
  applyVideoPreferences();
  // Refresh caregiver settings panel sliders to reflect the new applied values.
  if (typeof refreshAllSettingsRows === 'function') refreshAllSettingsRows();
  logEvent('difficulty_selected', { level, selected_by: selectedBy || 'child' });
  console.log('[difficulty] level=' + level, 'applied=', state.appliedPerChannel);
}

// Effective value for a channel: caregiver override > difficulty-applied > raw baseline.
// devOverrides[channel] is a number for continuous, bucket string for bucket channels;
// null/undefined means "no override".
function getEffectiveChannelValue(channel) {
  const ov = devOverrides[channel];
  if (ov !== null && ov !== undefined) return ov;
  const applied = state.appliedPerChannel[channel];
  if (applied !== null && applied !== undefined) return applied;
  const base = state.baselinePerChannel[channel];
  if (base !== null && base !== undefined) return base;
  return CONTINUOUS_CHANNELS.includes(channel) ? 0.5 : 'typical';
}

// Log a caregiver manual adjustment + flip contamination flag.
function logManualAdjustment(channel, from, to, trigger) {
  state.difficultyMeta.manual_adjustments.push({
    ts: new Date().toISOString(),
    channel, from, to,
    trigger: trigger || 'caregiver_settings',
  });
  state.condition_contaminated = true;
}

// Expose a tiny test surface so we can poke from the console while Phase B/C UI is being built.
window.SENSE = window.SENSE || {};
Object.assign(window.SENSE, {
  setDifficulty: setDifficultyLevel,
  getEffective: getEffectiveChannelValue,
  recompute: recomputeAppliedFromDifficulty,
  state,
});

// ============================================================
// DIFFICULTY MODAL — pop-up before video plays
// ============================================================
let _diffModalBound = false;
let _diffModalPicked = null;
let _diffModalOnConfirm = null;
function setupDifficultyModal(onConfirm) {
  const modal       = document.getElementById('difficulty-modal');
  const cards       = modal ? modal.querySelectorAll('.difficulty-card') : [];
  const continueBtn = document.getElementById('btn-difficulty-continue');
  if (!modal || !cards.length || !continueBtn) {
    console.warn('[difficulty-modal] markup missing — skipping');
    onConfirm && onConfirm();
    return;
  }

  // Reset state on every open (re-prompts cleanly if user re-enters Stage 2).
  cards.forEach(c => c.classList.remove('selected'));
  continueBtn.disabled = true;
  modal.classList.remove('hidden');
  _diffModalPicked = null;
  _diffModalOnConfirm = onConfirm || null;

  if (_diffModalBound) return;
  // First-time wiring (handlers persist across modal re-opens).
  cards.forEach(card => {
    card.addEventListener('click', () => {
      _diffModalPicked = card.dataset.level;
      cards.forEach(c => c.classList.toggle('selected', c === card));
      continueBtn.disabled = false;
      logEvent('difficulty_card_tapped', { level: _diffModalPicked });
    });
  });
  continueBtn.addEventListener('click', () => {
    if (!_diffModalPicked) return;
    setDifficultyLevel(_diffModalPicked, 'child');
    modal.classList.add('hidden');
    if (_diffModalOnConfirm) _diffModalOnConfirm();
  });
  _diffModalBound = true;
}

// ============================================================
// SETTINGS PANEL — per-channel caregiver controls inside #fab-panel
// ============================================================

// Tick positions for one channel as { baseline, p, c } in slider-percent space (0-100).
// Continuous channels map value 0..1 → 0..100. Buckets map BUCKET_ORDER index → 0/50/100.
function getChannelTickPositions(channel) {
  const base = state.baselinePerChannel[channel];
  if (CONTINUOUS_CHANNELS.includes(channel)) {
    const baseNum = (typeof base === 'number') ? base : 0.5;
    return {
      baseline: baseNum * 100,
      p: computeLevelValue(baseNum, 'protective') * 100,
      c: computeLevelValue(baseNum, 'challenge') * 100,
    };
  }
  const order = BUCKET_ORDER[channel];
  if (!order) return { baseline: 50, p: 50, c: 50 };
  const baseIdx = Math.max(0, order.indexOf(base));
  const pBucket = computeBucketLevelValue(base, 'protective', channel);
  const cBucket = computeBucketLevelValue(base, 'challenge', channel);
  return {
    baseline: baseIdx * 50,
    p: Math.max(0, order.indexOf(pBucket)) * 50,
    c: Math.max(0, order.indexOf(cBucket)) * 50,
  };
}

// Current effective value as slider percent (0-100).
function getChannelSliderPercent(channel) {
  if (CONTINUOUS_CHANNELS.includes(channel)) {
    const v = getEffectiveChannelValue(channel);
    return clamp01(typeof v === 'number' ? v : 0.5) * 100;
  }
  const order = BUCKET_ORDER[channel];
  const bucket = getEffectiveChannelValue(channel);
  const idx = order ? Math.max(0, order.indexOf(bucket)) : 1;
  return idx * 50;
}

// Update a single row's slider position + tick positions from current state.
function refreshSettingsRow(channel) {
  const row = document.querySelector(`.settings-row[data-channel="${channel}"]`);
  if (!row) return;
  const slider = row.querySelector('.settings-slider');
  const ticks = getChannelTickPositions(channel);
  const pct = getChannelSliderPercent(channel);
  if (slider) slider.value = String(Math.round(pct));
  const pTick = row.querySelector('.settings-tick-p');
  const baseTick = row.querySelector('.settings-tick-baseline');
  const cTick = row.querySelector('.settings-tick-c');
  if (pTick) pTick.style.left = `${ticks.p}%`;
  if (baseTick) baseTick.style.left = `${ticks.baseline}%`;
  if (cTick) cTick.style.left = `${ticks.c}%`;
}

function refreshAllSettingsRows() {
  ALL_CHANNELS.forEach(refreshSettingsRow);
}

// Write a slider event to devOverrides + log + repaint.
function applySliderChange(channel, sliderPct, trigger) {
  const prev = getEffectiveChannelValue(channel);
  let next;
  if (CONTINUOUS_CHANNELS.includes(channel)) {
    next = clamp01(sliderPct / 100);
  } else {
    const order = BUCKET_ORDER[channel];
    const idx = Math.round(sliderPct / 50);
    next = order[Math.max(0, Math.min(2, idx))];
  }
  if (next === prev) return;
  devOverrides[channel] = next;
  logManualAdjustment(channel, prev, next, trigger || 'caregiver_settings');
  applyVideoPreferences();
}

function resetChannelToBaseline(channel) {
  const baseline = state.baselinePerChannel[channel];
  const prev = getEffectiveChannelValue(channel);
  devOverrides[channel] = baseline;
  if (prev !== baseline) {
    logManualAdjustment(channel, prev, baseline, 'caregiver_reset_row');
  }
  refreshSettingsRow(channel);
  applyVideoPreferences();
}

// Apply a new shift % (0-100 from slider, in percentage points). Recomputes all
// applied per-channel values, refreshes UI, and re-applies to the playing video.
function applyShiftChange(which, pctPoints) {
  const frac = Math.max(0, Math.min(40, pctPoints)) / 100;
  if (which === 'protective') PROTECTIVE_STEP = frac;
  else if (which === 'challenge') CHALLENGE_STEP = frac;
  if (state.difficultyLevel) recomputeAppliedFromDifficulty(state.difficultyLevel);
  refreshAllSettingsRows();
  applyVideoPreferences();
  syncShiftUI(which);
  logEvent('difficulty_shift_changed', { which, percent: pctPoints });
}

// Keep slider + number input in sync after a programmatic change.
function syncShiftUI(which) {
  const step = which === 'protective' ? PROTECTIVE_STEP : CHALLENGE_STEP;
  const pct = Math.round(step * 100);
  const slider = document.querySelector(`.settings-shift-slider[data-shift="${which}"]`);
  const input  = document.querySelector(`.settings-shift-input[data-shift="${which}"]`);
  if (slider && Number(slider.value) !== pct) slider.value = String(pct);
  if (input  && Number(input.value)  !== pct) input.value  = String(pct);
}

let _settingsPanelBound = false;
function setupSettingsPanel() {
  refreshAllSettingsRows();
  syncShiftUI('protective');
  syncShiftUI('challenge');
  if (_settingsPanelBound) return;

  document.querySelectorAll('.settings-slider').forEach(slider => {
    const channel = slider.dataset.channel;
    slider.addEventListener('input', () => {
      applySliderChange(channel, Number(slider.value), 'caregiver_settings');
    });
  });

  // Global shift sliders — both slider and number input drive the same value.
  document.querySelectorAll('.settings-shift-slider').forEach(slider => {
    const which = slider.dataset.shift;
    slider.addEventListener('input', () => applyShiftChange(which, Number(slider.value)));
  });
  document.querySelectorAll('.settings-shift-input').forEach(input => {
    const which = input.dataset.shift;
    const commit = () => {
      const v = Number(input.value);
      if (!isFinite(v)) return;
      applyShiftChange(which, v);
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
  });
  document.querySelectorAll('.settings-shift-reset').forEach(btn => {
    const which = btn.dataset.shift;
    const def = which === 'protective' ? 15 : 5;
    btn.addEventListener('click', () => applyShiftChange(which, def));
  });

  document.querySelectorAll('.settings-reset').forEach(btn => {
    const channel = btn.dataset.channel;
    btn.addEventListener('click', () => {
      resetChannelToBaseline(channel);
    });
  });

  const resetAll = document.getElementById('settings-reset-all');
  if (resetAll) {
    resetAll.addEventListener('click', () => {
      ALL_CHANNELS.forEach(ch => {
        const baseline = state.baselinePerChannel[ch];
        const prev = getEffectiveChannelValue(ch);
        devOverrides[ch] = baseline;
        if (prev !== baseline) {
          logManualAdjustment(ch, prev, baseline, 'caregiver_reset_all');
        }
      });
      refreshAllSettingsRows();
      applyVideoPreferences();
    });
  }
  _settingsPanelBound = true;
}

function initVideoPlayer() {
  videoPreferences = extractPreferences();
  computeBaselinesFromPreferences(videoPreferences);
  // applied = baseline until the difficulty modal sets a level (Phase B)
  if (state.difficultyLevel) recomputeAppliedFromDifficulty(state.difficultyLevel);
  s2PauseTriggered = false;
  temporalMarkersFired = new Set();
  if (freezeCountdownTimer) { clearInterval(freezeCountdownTimer); freezeCountdownTimer = null; }
  document.getElementById('freeze-overlay')?.classList.add('hidden');
  console.log('[Phase 2] preferences:', videoPreferences);
  console.log('[Phase 2] baselines:', state.baselinePerChannel);

  const video = document.getElementById('sense-video');

  // Select priming video by scenario (dental / grocery / dining). Each event has its
  // own full Veo render; spatial-perspective variants are not yet generated, so the
  // spatial score is logged for analysis but does not switch files.
  const spatialScore = videoPreferences.spatial.score;
  let videoFile = VIDEO_BY_EVENT[state.eventType] || DEFAULT_VIDEO;
  videoFile += '?v=1';  // cache-bust when video content is updated
  const source = video.querySelector('source');
  if (source && source.src !== videoFile) {
    source.src = videoFile;
    video.load();
  }
  console.log('Video selected:', videoFile, '(spatial score:', spatialScore.toFixed(2) + ')');
  const playPause = document.getElementById('vc-play-pause');
  const timeDisplay = document.getElementById('timeline-time');
  const progressFill = document.getElementById('timeline-progress');
  const progressThumb = document.getElementById('timeline-thumb');
  const overlay = document.getElementById('video-play-overlay');
  const overlayIcon = document.getElementById('play-overlay-icon');
  const videoWrap = document.querySelector('.video-fullscreen');

  // Set up Web Audio lowpass for auditory (once per video element)
  setupVideoAudioChain(video);

  // Apply initial preferences
  applyVideoPreferences();

  // Caregiver settings panel — populate rows + bind handlers
  setupSettingsPanel();

  // Populate profile bars (legacy element, may be absent after Phase C refactor)
  populateProfile();

  // Play/Pause
  function togglePlay() {
    if (video.paused) {
      video.play();
      playPause.innerHTML = '&#9646;&#9646;';
      videoWrap.classList.remove('paused');
    } else {
      video.pause();
      playPause.innerHTML = '&#9654;';
      videoWrap.classList.add('paused');
    }
    overlayIcon.classList.remove('flash');
    void overlayIcon.offsetWidth;
    overlayIcon.classList.add('flash');
  }

  playPause.onclick = togglePlay;
  overlay.onclick = togglePlay;

  // Difficulty modal removed from the demo flow. Playback now starts at baseline
  // (state.difficultyLevel stays null → getEffectiveChannelValue falls through to
  // the raw baseline). The child/caregiver presses play manually, as in the
  // pre-set-difficulty path. setupDifficultyModal + difficulty logic are retained
  // but no longer invoked here.
  document.getElementById('difficulty-modal')?.classList.add('hidden');

  // Audio sync. Birthday uses Demucs stems (video muted; AudioBufferSources start/stop
  // in lockstep). Event videos play their own embedded audio (muted state set by
  // setupVideoAudioChain), so the stem hooks become no-ops for them.
  const usesStems = !!EVENT_HAS_STEMS[state.eventType];
  const stemKickoff = () => {
    if (!usesStems || video.paused) return;
    if (stemBuffers.voice || stemBuffers.bgm || stemBuffers.sfx) {
      startStems(video.currentTime);
    } else if (stemsLoading) {
      stemsLoading.then(() => { if (!video.paused) startStems(video.currentTime); });
    }
  };
  video.onplay   = stemKickoff;
  video.onpause  = () => { if (usesStems) stopStems(); };
  video.onseeked = () => { if (!usesStems) return; if (!video.paused) stemKickoff(); else stopStems(); };

  // Time update
  video.ontimeupdate = () => {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    progressFill.style.width = pct + '%';
    progressThumb.style.left = pct + '%';
    timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);

    // S2 pause at 22% — caregiver-facing "How is your child feeling?" overlay.
    // Disabled 2026-05-14: paused per Yue's request while wrap-up logic is reworked.
    // Re-enable by removing the `false &&` once design is settled.
    if (false && !s2PauseTriggered && pct >= 22) {
      s2PauseTriggered = true;
      video.pause();
      playPause.innerHTML = '&#9654;';
      videoWrap.classList.add('paused');
      document.getElementById('s2-pause-overlay').classList.remove('hidden');
      return;
    }
    // Preparation interval (Temporal): pause at 42 / 61 / 81 % markers.
    // NOTE: these pcts are visual placeholders. Once each event's priming video
    // has a finalized script, swap to per-event script-beat markers.
    const TEMPORAL_MARKERS = [42, 61, 81];
    for (const m of TEMPORAL_MARKERS) {
      if (temporalMarkersFired.has(m)) continue;
      if (pct >= m && pct < m + 1.5) {
        temporalMarkersFired.add(m);
        triggerTemporalFreeze(video, playPause, videoWrap);
        return;
      }
      if (pct >= m + 1.5) {
        temporalMarkersFired.add(m);
      }
    }
  };

  // Timeline seek
  document.getElementById('timeline-track').onclick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
  };

  // Settings panel toggle — refresh slider positions on every open to reflect current state
  document.getElementById('fab-dot').onclick = () => {
    const panel = document.getElementById('fab-panel');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) refreshAllSettingsRows();
  };

  // Note: legacy `#fab-profile-toggle` and `.fab-level` buttons were removed in the
  // Phase C refactor — the fab-panel is now per-channel sliders only. Difficulty
  // is chosen once via the modal; no global level switcher inside the panel.

  // S2 level selection
  document.querySelectorAll('.s2-level-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.s2-level-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    };
  });

  document.getElementById('s2-continue').onclick = () => {
    const selected = document.querySelector('.s2-level-btn.selected');
    if (selected) {
      currentLevel = parseInt(selected.dataset.level);
      document.querySelectorAll('.fab-level').forEach(b => {
        b.classList.toggle('active', b.dataset.level === selected.dataset.level);
      });
      applyVideoPreferences();
    }
    document.getElementById('s2-pause-overlay').classList.add('hidden');
    const video = document.getElementById('sense-video');
    video.play();
    document.getElementById('vc-play-pause').innerHTML = '&#9646;&#9646;';
    document.querySelector('.video-fullscreen').classList.remove('paused');
  };

  // Advance to wrap-up screen when the priming video finishes.
  video.onended = () => {
    logEvent('priming_video_ended');
    stopStems();
    // Reset playback chrome so a rewatch starts clean
    playPause.innerHTML = '&#9654;';
    videoWrap.classList.add('paused');
    // Stage 2 export — captures difficulty choice + any caregiver manual_adjustments
    // accumulated during playback. The earlier Stage 1 export (at processing entry)
    // pre-dated the difficulty modal, so this second export is the full-session record.
    try { exportData(); } catch (e) { console.warn('Stage 2 export failed:', e); }
    goToPhase('wrapup');
  };

  // Dev A/B panel: continuous sub-dims use sliders (brightness/saturation/pitch/volume);
  // bucketed sub-dims use buttons (prep). Override null → canvas value.
  const devPanel = document.getElementById('dev-channel-panel');
  if (devPanel) {
    const CONT_SUBS = ['brightness', 'saturation', 'pitch', 'voice', 'bgm', 'sfx'];
    const BUCKET_SUBS = ['prep'];
    const SUBS = [...CONT_SUBS, ...BUCKET_SUBS];

    const updateReadouts = () => {
      CONT_SUBS.forEach(sub => {
        const slider = devPanel.querySelector(`.dev-cp-slider[data-sub="${sub}"]`);
        const readout = devPanel.querySelector(`.dev-cp-value[data-sub="${sub}"]`);
        if (!slider) return;
        const o = devOverrides[sub];
        if (typeof o === 'number') {
          slider.value = String(Math.round(o * 100));
          if (readout) readout.textContent = o.toFixed(2);
        } else if (readout) {
          readout.textContent = '—';
        }
      });
      BUCKET_SUBS.forEach(sub => {
        const cur = devOverrides[sub];
        devPanel.querySelectorAll(`.dev-cp-bucket-btn[data-sub="${sub}"]`).forEach(btn => {
          btn.classList.toggle('active', cur === btn.dataset.bucket);
        });
      });
    };
    updateReadouts();

    devPanel.querySelectorAll('.dev-cp-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const sub = slider.dataset.sub;
        const v = parseInt(slider.value, 10) / 100;
        devOverrides[sub] = v;
        applyVideoPreferences();
        const readout = devPanel.querySelector(`.dev-cp-value[data-sub="${sub}"]`);
        if (readout) readout.textContent = v.toFixed(2);
        logEvent('dev_slider', { sub, value: v });
      });
    });

    devPanel.querySelectorAll('.dev-cp-bucket-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = btn.dataset.sub;
        const bucket = btn.dataset.bucket;
        devOverrides[sub] = bucket;
        applyVideoPreferences();
        updateReadouts();
        logEvent('dev_bucket', { sub, bucket });
      });
    });

    devPanel.querySelectorAll('.dev-cp-reset').forEach(btn => {
      btn.onclick = () => {
        const sub = btn.dataset.sub;
        if (sub === 'all') {
          SUBS.forEach(s => { devOverrides[s] = null; });
        } else {
          devOverrides[sub] = null;
        }
        applyVideoPreferences();
        updateReadouts();
        logEvent('dev_reset', { sub });
      };
    });

    const rewindBtn = document.getElementById('dev-cp-rewind');
    if (rewindBtn) {
      rewindBtn.onclick = () => {
        try { video.currentTime = Math.max(0, video.currentTime - 3); }
        catch (_) {}
        if (video.paused) {
          video.play().catch(() => {});
          playPause.innerHTML = '&#9646;&#9646;';
          videoWrap.classList.remove('paused');
        }
        logEvent('dev_rewind_3s');
      };
    }
  }
}

function applyVideoPreferences() {
  if (!videoPreferences) return;
  const video = document.getElementById('sense-video');

  // Effective per-channel value: override > difficulty-applied > raw baseline (see
  // getEffectiveChannelValue). When state.difficultyLevel is null this falls through
  // to the canvas-derived baseline, preserving the pre-difficulty behavior.
  const brightNorm = getEffectiveChannelValue('brightness');
  const satNorm    = getEffectiveChannelValue('saturation');

  // --- Visual: brightness — direct lerp 0.5 .. 1.5, midpoint 1.0 = CSS identity ---
  const brightness = 0.5 + brightNorm * 1.0;
  // --- Visual: saturation — direct lerp 0.3 .. 1.7, midpoint 1.0 = CSS identity ---
  const saturation = 0.3 + satNorm * 1.4;
  video.style.filter = `brightness(${brightness.toFixed(2)}) saturate(${saturation.toFixed(2)})`;

  // --- Auditory: lowpass cutoff — direct lerp 300 .. 8000 Hz (spec range) from pitch ---
  if (videoLowpass) {
    const pitchNorm = getEffectiveChannelValue('pitch');
    const cutoff = 300 + pitchNorm * 7700;
    try { videoLowpass.frequency.setTargetAtTime(cutoff, videoLowpass.context.currentTime, 0.05); }
    catch (e) { videoLowpass.frequency.value = cutoff; }
  }

  // --- Auditory: per-stem gain (voice / bgm / sfx) ---
  // Spec's "source combo" realized after Demucs separation as 3 independent gains.
  // Each stem channel has its own effective value (baseline shared, override per-stem).
  // Layer boost from auditoryLayerCount adds a complexity nudge on top of the per-stem
  // canvas baseline.
  if (stemMixer && state.audioCtx) {
    const ctx = state.audioCtx;
    const layers = videoPreferences.auditory.layerCount || 0;
    const layerBoost = Math.min(0.2, (layers / 3) * 0.2);
    STEM_KEYS.forEach(k => {
      if (!stemGains[k]) return;
      const v = getEffectiveChannelValue(k);
      const g = Math.max(0.05, Math.min(1.5, 0.1 + v * 1.4 + layerBoost));
      try { stemGains[k].gain.setTargetAtTime(g, ctx.currentTime, 0.05); }
      catch (_) { stemGains[k].gain.value = g; }
    });
  }

  // playbackRate stays native — preparation interval is realized as pause-at-marker,
  // not playback speed. See triggerTemporalFreeze().
  try { video.playbackRate = 1.0; } catch (e) {}

  console.log('[applyVideoPreferences]',
    'level=' + (state.difficultyLevel || 'null'),
    'overrides=' + JSON.stringify(devOverrides),
    'brightness=' + brightness.toFixed(2),
    'saturation=' + saturation.toFixed(2),
    'lowpass=' + (videoLowpass ? Math.round(videoLowpass.frequency.value) + 'Hz' : '—'));
}

// --- Web Audio chain (multi-stem):
//   3 × AudioBufferSourceNode (voice/bgm/sfx) → 3 × GainNode → stemMixer → lowpass → destination
// The <video> element itself is muted; audio comes only through this graph.
function setupVideoAudioChain(videoEl) {
  if (audioChainBuilt) return; // already built (lowpass persists across event videos)
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = state.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    // Shared lowpass (auditory personalization) — both paths feed into it → destination.
    videoLowpass = ctx.createBiquadFilter();
    videoLowpass.type = 'lowpass';
    videoLowpass.frequency.value = 20000;
    videoLowpass.Q.value = 0.7;
    videoLowpass.connect(ctx.destination);

    if (EVENT_HAS_STEMS[state.eventType]) {
      // Birthday path: 3 stem buffer sources → gains → mixer → lowpass. Video muted.
      STEM_KEYS.forEach(k => {
        const g = ctx.createGain();
        g.gain.value = 1.0;
        stemGains[k] = g;
      });
      stemMixer = ctx.createGain();
      stemMixer.gain.value = 1.0;
      STEM_KEYS.forEach(k => stemGains[k].connect(stemMixer));
      stemMixer.connect(videoLowpass);
      videoEl.muted = true;
      loadStems(ctx); // async decode of the 3 stems
    } else {
      // Event videos: route the file's own embedded audio through the lowpass.
      // createMediaElementSource is one-shot per element, guarded by audioChainBuilt.
      mediaElementSource = ctx.createMediaElementSource(videoEl);
      mediaElementSource.connect(videoLowpass);
      videoEl.muted = false;
    }
    audioChainBuilt = true;
  } catch (e) {
    console.warn('Video audio routing failed:', e);
    stemMixer = null;
    videoLowpass = null;
  }
}

function loadStems(ctx) {
  if (stemsLoading) return stemsLoading;
  const files = stemFilesFor(state.eventType);
  stemsLoading = Promise.all(STEM_KEYS.map(async (k) => {
    try {
      const res = await fetch(files[k] + '?v=1');
      const buf = await res.arrayBuffer();
      stemBuffers[k] = await ctx.decodeAudioData(buf);
      console.log('[stems] loaded', k, stemBuffers[k].duration.toFixed(2) + 's');
    } catch (e) {
      console.warn('[stems] failed to load', k, e);
      stemBuffers[k] = null;
    }
  }));
  return stemsLoading;
}

// Start the 3 AudioBufferSourceNodes at the given video offset (seconds).
// AudioBufferSourceNode is one-shot, so we create a fresh trio every time.
function startStems(offsetSec) {
  const ctx = state.audioCtx;
  if (!ctx || !stemMixer) return;
  stopStems();
  STEM_KEYS.forEach(k => {
    const buf = stemBuffers[k];
    if (!buf || !stemGains[k]) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(stemGains[k]);
    const clipped = Math.max(0, Math.min(buf.duration - 0.01, offsetSec));
    try { src.start(0, clipped); } catch (e) { console.warn('[stems] start failed', k, e); }
    stemSources[k] = src;
  });
  stemsPlaying = true;
}

function stopStems() {
  STEM_KEYS.forEach(k => {
    const s = stemSources[k];
    if (s) {
      try { s.stop(); } catch (_) {}
      try { s.disconnect(); } catch (_) {}
      stemSources[k] = null;
    }
  });
  stemsPlaying = false;
}

// --- Preparation interval (Temporal): silent freeze, then resume.
// Just pauses the video for `freezeSec`; audio cuts out with it so the gap is already
// obvious without any overlay text or countdown. Spec: pause length = drumSMT directly. ---
function triggerTemporalFreeze(video, playPauseBtn, videoWrap) {
  if (!videoPreferences) return;
  // Bucketed prep interval — pipeline: override > difficulty-applied > canvas baseline.
  // See prep_cue_design_20260514.md.
  const bucket = getEffectiveChannelValue('prep') || 'typical';
  const freezeSec = PREP_BUCKETS[bucket] ?? 1.0;
  if (freezeSec < 0.15) return;

  video.pause(); // also fires `pause` event → stopStems()
  if (playPauseBtn) playPauseBtn.innerHTML = '&#9654;';
  if (videoWrap) videoWrap.classList.add('paused');

  if (freezeCountdownTimer) { clearTimeout(freezeCountdownTimer); freezeCountdownTimer = null; }
  freezeCountdownTimer = setTimeout(() => {
    freezeCountdownTimer = null;
    video.play().catch(() => {}); // `play` event will re-kick stems at the new currentTime
    if (playPauseBtn) playPauseBtn.innerHTML = '&#9646;&#9646;';
    if (videoWrap) videoWrap.classList.remove('paused');
  }, Math.round(freezeSec * 1000));
  logEvent('prep_freeze', { seconds: +freezeSec.toFixed(2) });
}

function populateProfile() {
  if (!videoPreferences) return;
  const dims = ['auditory', 'visual', 'spatial', 'temporal'];
  dims.forEach(dim => {
    const bar = document.getElementById(`bar-${dim}`);
    const label = document.getElementById(`label-${dim}`);
    if (bar && videoPreferences[dim]) {
      const pct = Math.round(videoPreferences[dim].score * 100);
      bar.style.width = pct + '%';
      if (label) label.textContent = pct + '%';
    }
  });
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// ============================================================
// INIT
// ============================================================
// ============================================================
// PINCH GESTURES (two-finger zoom/resize)
// ============================================================
(function initPinchGestures() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartMidX = 0, pinchStartMidY = 0;
  let panStartX = 0, panStartY = 0;
  let pinchTarget = null;
  let pinchStartSize = 0;
  let currentScale = 1;
  let currentX = 0, currentY = 0;
  const touches = {};

  function applyTransform() {
    container.style.transform = `translate(${currentX}px, ${currentY}px) scale(${currentScale})`;
    container.style.transformOrigin = 'center center';
  }

  container.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      touches[t.identifier] = { x: t.clientX, y: t.clientY };
    }

    if (Object.keys(touches).length === 2) {
      const ids = Object.keys(touches);
      const t1 = touches[ids[0]];
      const t2 = touches[ids[1]];
      pinchStartDist = Math.sqrt((t2.x - t1.x) ** 2 + (t2.y - t1.y) ** 2);
      pinchStartMidX = (t1.x + t2.x) / 2;
      pinchStartMidY = (t1.y + t2.y) / 2;
      panStartX = currentX;
      panStartY = currentY;

      // Check if pinch is on an element
      if (state.canvasSubPhase === 'add-elements' || state.canvasSubPhase === 'adjust') {
        const el = document.elementFromPoint(pinchStartMidX, pinchStartMidY);
        const canvasEl = el && el.closest('.canvas-element');
        if (canvasEl) {
          pinchTarget = canvasEl;
          pinchStartSize = parseInt(canvasEl.style.width) || 140;
          e.preventDefault();
          return;
        }
      }

      pinchTarget = null;
      pinchStartScale = currentScale;
      e.preventDefault();
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      touches[t.identifier] = { x: t.clientX, y: t.clientY };
    }

    if (Object.keys(touches).length === 2) {
      e.preventDefault();
      const ids = Object.keys(touches);
      const t1 = touches[ids[0]];
      const t2 = touches[ids[1]];
      const dist = Math.sqrt((t2.x - t1.x) ** 2 + (t2.y - t1.y) ** 2);
      const midX = (t1.x + t2.x) / 2;
      const midY = (t1.y + t2.y) / 2;
      const ratio = dist / pinchStartDist;

      if (pinchTarget) {
        const newSize = Math.max(60, Math.min(300, pinchStartSize * ratio));
        pinchTarget.style.width = newSize + 'px';
        pinchTarget.style.height = newSize + 'px';
        if (pinchTarget.dataset.dimension === 'auditory') {
          updateAudioForSize(newSize);
        }
      } else {
        // Zoom + Pan simultaneously
        currentScale = Math.max(0.5, Math.min(3, pinchStartScale * ratio));
        currentX = panStartX + (midX - pinchStartMidX);
        currentY = panStartY + (midY - pinchStartMidY);
        applyTransform();
      }
    }
  }, { passive: false });

  container.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      delete touches[t.identifier];
    }

    if (Object.keys(touches).length < 2) {
      if (pinchTarget) {
        updatePlacedElement(pinchTarget);
        logEvent('element_pinch_resized', {
          id: pinchTarget.id,
          size: parseInt(pinchTarget.style.width),
        });
        if (pinchTarget.dataset.dimension === 'auditory') {
          stopAudio();
        }
        pinchTarget = null;
      }
      pinchStartDist = 0;
    }
  });

  container.addEventListener('touchcancel', (e) => {
    for (const t of e.changedTouches) {
      delete touches[t.identifier];
    }
    pinchTarget = null;
    pinchStartDist = 0;
  });

  // Double-tap to reset zoom + pan
  let lastTap = 0;
  container.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1 && Object.keys(touches).length === 0) {
      const now = Date.now();
      if (now - lastTap < 300) {
        currentScale = 1;
        currentX = 0;
        currentY = 0;
        applyTransform();
      }
      lastTap = now;
    }
  });
})();

// ============================================================
// WRAP-UP SCREEN (Screen 7)
// Caregiver-guided closing beat: child picks a strategy for the
// upcoming social moment, optionally rewatches a video segment,
// then self-reports readiness. Logs both choices.
// ============================================================
// Wrap-up question pool, per event. Each question:
//   • anchors at a universal procedure beat (canonical next step transfers to real life)
//   • offers 3 options: exactly 1 canonical (real next step) + 2 plausible distractors
//   • has a single revealSegment timestamp (0..1) — the position in the video that
//     shows the canonical answer. There's only ONE video entry per question.
//   • is NOT scored — wrap-up purpose is procedure familiarity, not testing.
// At runtime, initWrapupScreen() picks one question at random from the event's pool.
const WRAPUP_QUESTIONS = {
  birthday: [
    {
      anchor: 'After you walk in',
      options: [
        { label: 'Walk to the cake', emoji: '🎂', canonical: true },
        { label: 'Hear loud music',  emoji: '🔊' },
        { label: 'Find a chair',     emoji: '🪑' },
      ],
      revealSegment: 0.13,
    },
    {
      anchor: 'After the candles are lit',
      options: [
        { label: 'Everyone sings Happy Birthday', emoji: '🎵', canonical: true },
        { label: 'Eat the cake right away',       emoji: '🍴' },
        { label: 'Open presents',                 emoji: '🎁' },
      ],
      revealSegment: 0.50,
    },
    {
      anchor: 'After everyone sings',
      options: [
        { label: 'Blow out the candles', emoji: '💨', canonical: true },
        { label: 'Eat the cake',         emoji: '🍴' },
        { label: 'Take a photo',         emoji: '📷' },
      ],
      revealSegment: 0.63,
    },
    {
      anchor: 'After you blow out the candles',
      options: [
        { label: 'Cut and share the cake', emoji: '🎂', canonical: true },
        { label: 'Light them again',       emoji: '🕯️' },
        { label: 'Leave the party',        emoji: '🚪' },
      ],
      revealSegment: 0.78,
    },
  ],
  // Other events fall back to birthday until per-event videos + scripts exist.
};

function pickWrapupQuestion(eventType) {
  const pool = WRAPUP_QUESTIONS[eventType] || WRAPUP_QUESTIONS.birthday;
  return pool[Math.floor(Math.random() * pool.length)];
}

function initWrapupScreen() {
  // If we're returning from a deliberate rewatch, keep the pick state so the
  // child doesn't lose their choice. Otherwise this is a fresh entry — reset.
  const returningFromRewatch = state.rewatching === true;
  state.rewatching = false;

  if (!returningFromRewatch) {
    state.wrapupStrategy = null;
    state.wrapupFeeling  = null;
    state.wrapupRevealed = false;
    // Pick a fresh question from the event's pool. Pinned to 'birthday' for now
    // because the demo's playing video is birthday_party.mp4 regardless of
    // Stage-1 event selection (until per-event videos are rendered).
    state.wrapupQuestion = pickWrapupQuestion('birthday');

    document.querySelectorAll('#wrapup-strategy-grid .wrapup-card').forEach(c => {
      c.classList.remove('selected', 'dimmed', 'locked');
    });
    document.querySelectorAll('.readiness-card').forEach(c => {
      c.classList.remove('selected', 'dimmed');
    });
    document.getElementById('readiness-panel').classList.add('hidden');
    document.getElementById('wrapup-done').classList.add('hidden');
  }

  // Render the current question (title + 3 option cards). Order is preserved as
  // listed in the pool so distractors stay in their authored positions; if we
  // ever want to shuffle option order per session, do it here.
  const q = state.wrapupQuestion || pickWrapupQuestion('birthday');
  const titleEl = document.getElementById('wrapup-title');
  if (titleEl) titleEl.textContent = `${q.anchor}, what happens next?`;

  const cards = document.querySelectorAll('#wrapup-strategy-grid .wrapup-card');
  cards.forEach((card, i) => {
    const opt = q.options[i];
    if (!opt) { card.style.display = 'none'; return; }
    card.style.display = '';
    card.querySelector('.wrapup-emoji').textContent = opt.emoji;
    card.querySelector('.wrapup-name').textContent  = opt.label;
    card.dataset.optionIndex = String(i);
    card.dataset.canonical   = opt.canonical ? '1' : '0';
    card.onclick = () => {
      if (state.wrapupStrategy) return;
      // No right/wrong — record the pick, dim the others, slide in readiness.
      state.wrapupStrategy = opt.label;
      logEvent('wrapup_strategy_pick', {
        anchor: q.anchor, picked: opt.label, canonical: !!opt.canonical,
      });
      card.classList.add('selected');
      cards.forEach(c => { if (c !== card) c.classList.add('dimmed'); });
      setTimeout(() => {
        document.getElementById('readiness-panel').classList.remove('hidden');
      }, 500);
    };
  });

  // Single shared "See what happens" button. Plays only the canonical-next clip
  // (about one scene worth, ~6 s), then auto-returns to wrap-up with cards locked
  // and the readiness panel + "Try another" exit shown.
  const revealBtn = document.getElementById('wrapup-reveal');
  if (revealBtn) {
    revealBtn.onclick = () => {
      const segPct = Math.min(0.98, Math.max(0, q.revealSegment ?? 0.5));
      const revealClipSec = 6;
      logEvent('wrapup_reveal', { anchor: q.anchor, segment: segPct });
      state.rewatching = true;
      goToPhase('video');
      const v = document.getElementById('sense-video');
      try { s2PauseTriggered = true; } catch (_) {}

      if (state.revealAutoStopTimer) {
        clearTimeout(state.revealAutoStopTimer);
        state.revealAutoStopTimer = null;
      }

      const seekAndPlay = () => {
        try {
          if (v.duration) v.currentTime = v.duration * segPct;
        } catch (_) {}
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
        const pp = document.getElementById('vc-play-pause');
        if (pp) pp.innerHTML = '&#9646;&#9646;';
        document.querySelector('.video-fullscreen')?.classList.remove('paused');

        state.revealAutoStopTimer = setTimeout(() => {
          state.revealAutoStopTimer = null;
          try { v.pause(); } catch (_) {}
          state.wrapupRevealed = true;
          goToPhase('wrapup');
        }, revealClipSec * 1000);
      };
      if (v.readyState >= 1 && v.duration) seekAndPlay();
      else v.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    };
  }

  // After a reveal, lock the option cards (no more picking on THIS question),
  // re-title the readiness prompt, slide readiness in. "Try another question"
  // lives inside the done panel below, so it only appears after readiness is picked.
  if (state.wrapupRevealed) {
    cards.forEach(c => c.classList.add('locked'));
    revealBtn?.classList.add('hidden');
    const readinessTitle = document.getElementById('readiness-title');
    if (readinessTitle) readinessTitle.textContent = 'You saw what happens. How do you feel?';
    document.getElementById('readiness-panel').classList.remove('hidden');
  } else {
    revealBtn?.classList.remove('hidden');
    const readinessTitle = document.getElementById('readiness-title');
    if (readinessTitle) readinessTitle.textContent = 'How are you feeling?';
  }

  const tryAnotherBtn = document.getElementById('wrapup-try-another');
  if (tryAnotherBtn) {
    tryAnotherBtn.onclick = () => {
      logEvent('wrapup_try_another');
      state.rewatching = false;
      state.wrapupRevealed = false;
      state.wrapupStrategy = null;
      state.wrapupFeeling  = null;
      state.wrapupQuestion = null;
      initWrapupScreen();
    };
  }

  // Readiness pick
  document.querySelectorAll('.readiness-card').forEach(card => {
    card.onclick = () => {
      if (state.wrapupFeeling) return;
      const feeling = card.dataset.feeling;
      state.wrapupFeeling = feeling;
      logEvent('wrapup_readiness_pick', { feeling });
      card.classList.add('selected');
      document.querySelectorAll('.readiness-card').forEach(c => {
        if (c !== card) c.classList.add('dimmed');
      });
      setTimeout(() => {
        document.getElementById('wrapup-done').classList.remove('hidden');
      }, 500);
    };
  });

  // Restart
  const restartBtn = document.getElementById('btn-wrapup-restart');
  if (restartBtn) {
    restartBtn.onclick = () => {
      logEvent('wrapup_restart');
      try { window.location.reload(); } catch (_) { goToPhase('welcome'); }
    };
  }
}

console.log('SENSE Canvas Demo loaded');

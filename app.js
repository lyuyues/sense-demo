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
  { id: 'sound-studio', instruction: 'Create your soundscape!', dotIndex: 2 },
  { id: 'animate', instruction: 'Drum time!', dotIndex: 3 },
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
  if (phase === 'processing') runProcessing();
  // drum is now a canvas sub-phase, not a separate screen
  if (phase === 'video') {
    // Clean up canvas state
    stopAllSpriteAnimations();
    const cc = document.getElementById('canvas-container');
    if (cc) { cc.style.transform = ''; cc.style.filter = ''; }
    initVideoPlayer();
  }
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
    const resp = await fetch(`templates/${eventId}.json`);
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
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
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
  img.src = imgSrc + (imgSrc.includes('?') ? '&' : '?') + 'v=' + Date.now();
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

  // Capture screenshot and trigger AI for the stage we're leaving
  if (subPhase === 'add-elements' || subPhase === 'color' || subPhase === 'sound-studio' || subPhase === 'animate') {
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

  switch (subPhase) {
    case 'place-self':
      // Auto-place avatar and sun (for playground)
      autoPlaceAvatar();
      if (state.eventType === 'playground') autoPlaceSun();
      setCanvasSubPhase('add-elements');
      return;

    case 'add-elements':
      renderElementPalette();
      break;

    case 'color':
      palette.classList.add('hidden');
      // Don't enable drawing yet — wait for Color me tap
      colorToolbar.classList.add('hidden');
      colorCanvas.style.pointerEvents = 'none';
      elementLayer.style.pointerEvents = 'none';
      // Show Color me hint after avatar loads
      setTimeout(() => {
        if (state.canvasSubPhase === 'color') showColorHint();
      }, 1500);
      break;

    case 'sound-studio':
      palette.classList.add('hidden');
      document.getElementById('element-palette').style.display = 'none';
      document.getElementById('sound-studio').classList.remove('hidden');
      document.getElementById('sound-palette').classList.remove('hidden');
      setupSoundStudio();
      break;

    case 'animate':
      document.getElementById('sound-studio').classList.add('hidden');
      stopAllStudioLayers();
      palette.classList.add('hidden');
      document.getElementById('element-palette').style.display = 'none';
      btnNext.classList.add('hidden');
      // Show drum overlay on canvas
      document.getElementById('drum-overlay').classList.remove('hidden');
      setupAnimatePhase();
      break;
  }

  // Start stage timer
  startStageTimer(subPhase);
}

function updatePhaseDots(activeIdx) {
  document.querySelectorAll('.phase-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.phase === state.canvasSubPhase);
  });
}

// --- Next / Back buttons ---
const SUB_PHASE_ORDER = ['place-self', 'add-elements', 'color', 'sound-studio', 'animate'];

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

  // Avatar proportional to canvas height (~40%)
  const container = document.getElementById('canvas-container');
  const cW = container.offsetWidth;
  const cH = container.offsetHeight;
  const avatarSize = Math.round(cH * 0.4);
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

function generateLineart(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
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

        // Dark pixels → keep as outline
        if (gray < 60) {
          d[i] = d[i+1] = d[i+2] = 40;
          d[i+3] = 255;
          continue;
        }

        // Skin tones: low-mid saturation, warm hue (r > g > b)
        const isSkin = r > 150 && g > 100 && b > 70 && r > g && g > b && sat < 0.55;
        // Hair/dark features: medium brightness, any saturation
        const isDarkDetail = gray < 120 && sat < 0.4;

        if (isSkin || isDarkDetail) {
          // Keep original color (face, hair, eyes, shoes)
          continue;
        }

        // Everything else (clothes, large color blocks) → white/near-transparent
        if (sat > 0.15 || gray > 200) {
          d[i] = d[i+1] = d[i+2] = 255;
          d[i+3] = 25; // very faint so outlines still show
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(c.toDataURL('image/png'));
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
  const layer = document.getElementById('element-layer');
  const el = document.createElement('div');
  const uniqueId = `placed-${elemDef.id}-${Date.now()}`;
  el.className = `canvas-element ${elemDef.type}-element`;
  el.id = uniqueId;
  el.dataset.type = elemDef.type;
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
// SOUND STUDIO — Five-line staff for sound composition
// ============================================================
const SOUND_ELEMENTS = [
  { type: 'bgm', asset: 'assets/music_note.png', label: 'Music', color: '#FF8C42' },
  { type: 'voice', asset: 'assets/microphone.png', label: 'Voices', color: '#4D96FF' },
  { type: 'sfx', asset: 'assets/bell.png', label: 'Sounds', color: '#6BCB77' },
];

function setupSoundStudio() {
  const palette = document.getElementById('sound-palette');
  const staffArea = document.getElementById('staff-area');
  const staffElements = document.getElementById('staff-elements');

  palette.innerHTML = '';
  staffElements.innerHTML = '';

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
    item.innerHTML = `
      <div class="sound-palette-icon"><img src="${snd.asset.startsWith('data:') ? snd.asset : snd.asset + '?v=' + Date.now()}" /></div>
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

function spawnStaffElement(snd, startEvent) {
  const staffArea = document.getElementById('staff-area');
  const staffElements = document.getElementById('staff-elements');
  const el = document.createElement('div');
  el.className = 'staff-element';
  el.dataset.soundType = snd.type;
  el.innerHTML = `<img src="${snd.asset.startsWith('data:') ? snd.asset : snd.asset + '?v=' + Date.now()}" draggable="false" />`;

  staffElements.appendChild(el);

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

  if (elemDef.type === 'friend') {
    // Say "Hi!" with gender-appropriate child voice
    sayHi(elemDef.id);
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

  // Show toolbar but keep canvas NOT intercepting clicks yet
  colorToolbar.classList.remove('hidden');
  colorCanvas.style.pointerEvents = 'none';  // hints need to be clickable first
  colorCanvas.classList.add('drawing-mode');
  colorCanvas.style.zIndex = '10';
  colorCanvas.style.mixBlendMode = 'multiply';
  // Keep element-layer BELOW color canvas so strokes stay visible
  document.getElementById('element-layer').style.zIndex = '3';
  state._coloringActive = true;

  // Add "Color me!" hint to EACH placed element
  document.querySelectorAll('.canvas-element').forEach(el => {
    const img = el.querySelector('img');
    if (!img) return;

    const hint = document.createElement('div');
    hint.className = 'color-hint-overlay color-hint-item';
    hint.innerHTML = `
      <div class="color-hint-icon">🖍️</div>
      <div class="color-hint-text">Color me!</div>
    `;
    hint.style.pointerEvents = 'auto';
    hint.style.cursor = 'pointer';
    hint.style.animationDelay = (Math.random() * 0.3) + 's';
    hint._targetElement = el; // link hint to its element

    // Position hint over the element but in canvas-container (above color-canvas)
    const container = document.getElementById('canvas-container');
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    hint.style.position = 'absolute';
    hint.style.left = (eRect.left - cRect.left + eRect.width / 2) + 'px';
    hint.style.top = (eRect.top - cRect.top + eRect.height / 2) + 'px';
    hint.style.transform = 'translate(-50%, -50%)';
    container.appendChild(hint);

    // Tap → swap THIS element to lineart
    hint.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (el.dataset.swappedToLineart) { hint.remove(); checkAllHintsDone(); return; }
      el.dataset.swappedToLineart = '1';
      el.dataset.originalSrc = img.src;

      if (el.id === 'avatar-main') {
        img.src = 'assets/test_avatar_lineart.png?v=' + Date.now();
        img.style.filter = '';
      } else {
        const src = img.src.split('?')[0];
        const lineartSrc = src.replace('.png', '_lineart.png');
        const testImg = new Image();
        testImg.onload = () => { img.src = lineartSrc + '?v=' + Date.now(); };
        testImg.onerror = () => {
          generateLineart(el.dataset.originalSrc).then(url => { img.src = url; });
        };
        testImg.src = lineartSrc + '?v=' + Date.now();
      }
      hint.remove();
      checkAllHintsDone();
    });
  });

  // When all hints are clicked, enable drawing on the canvas
  function checkAllHintsDone() {
    const remaining = document.querySelectorAll('.color-hint-item').length;
    if (remaining === 0) {
      enableDrawing();
    }
  }

  function enableDrawing() {
    colorCanvas.style.pointerEvents = 'auto';
    const elLayer = document.getElementById('element-layer');
    elLayer.style.zIndex = '3';
    elLayer.style.pointerEvents = 'none';
    setTimeout(updateCrayonCursor, 50);
  }

  // Also allow user to start drawing by tapping empty canvas area
  // (enable drawing but keep remaining hints — don't auto-swap)
  const startDrawing = (e) => {
    if (e.target.closest('.color-hint-item')) return; // don't trigger on hint clicks
    enableDrawing();
    document.getElementById('canvas-container').removeEventListener('pointerdown', startDrawing);
  };
  document.getElementById('canvas-container').addEventListener('pointerdown', startDrawing);
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

// --- Color toolbar events ---
document.querySelectorAll('.color-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    swatch.classList.add('selected');
    state.selectedColor = swatch.dataset.color;
    state.isEraser = false;
    document.getElementById('btn-eraser').classList.remove('active');
    updateCrayonCursor();
    updateTouchCrayonColor();
  });
});

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
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  } else {
    // Re-select first swatch
    const first = document.querySelector('.color-swatch');
    if (first) { first.classList.add('selected'); state.selectedColor = first.dataset.color; }
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
// DRUM RHYTHM PHASE — 4-round Taiko design
// Round 0: Intro (demo hands)
// Round 1: Visual following (taiko notes scroll, no sound cue)
// Round 2: Auditory following (sound cue only, no visual notes)
// Round 3: Free play (child's own tempo)
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

  // Data collection per round
  const drumData = {
    visual: { cueTimes: [], tapTimes: [], delays: [] },
    auditory: { cueTimes: [], tapTimes: [], delays: [] },
    free: { tapTimes: [] },
  };

  let currentRound = 0;
  const BEAT_INTERVAL = 700;
  const BEATS_PER_ROUND = 12;
  const FREE_TAPS_NEEDED = 30;
  let beatCount = 0;
  let roundTimer = null;
  let introTimer = null;
  let drumEnabled = false;
  let pendingCueTime = null;

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

    // Visual + sound feedback
    drumImg.classList.add('hit');
    setTimeout(() => drumImg.classList.remove('hit'), 100);
    const ripple = document.createElement('div');
    ripple.className = 'drum-ripple';
    document.getElementById('drum-hits').appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
    playDrumHit();

    // Visual round: check if a note is near the target, show hit effect
    if (currentRound === 1 && taikoTarget) {
      // Find any note near the target (wide 80px window)
      const targetX = taikoTrack.offsetWidth * 0.33;
      let hitNote = null;
      let closestDist = Infinity;
      taikoNotes.querySelectorAll('.taiko-note').forEach(n => {
        const noteX = parseFloat(n.style.left || 0) + 24;
        const dist = Math.abs(noteX - targetX);
        if (dist < 80 && dist < closestDist) {
          closestDist = dist;
          hitNote = n;
        }
      });

      // Target ring reacts
      taikoTarget.classList.add('hit');
      setTimeout(() => taikoTarget.classList.remove('hit'), 300);

      if (hitNote) {
        // Hit! — green burst + "Nice!" text + remove note
        hitNote.style.background = '#4CAF50';
        hitNote.style.transform = 'translateY(-50%) scale(1.4)';
        hitNote.style.opacity = '0';
        hitNote.style.transition = 'all 0.25s';
        setTimeout(() => hitNote.remove(), 250);

        // Burst ring
        const burst = document.createElement('div');
        burst.className = 'taiko-burst';
        burst.style.left = '33%';
        burst.style.top = '50%';
        taikoTrack.appendChild(burst);
        setTimeout(() => burst.remove(), 600);

        // "Nice!" floating text
        const nice = document.createElement('div');
        nice.className = 'taiko-nice';
        nice.textContent = closestDist < 30 ? 'Perfect!' : 'Nice!';
        nice.style.left = '33%';
        nice.style.top = '20%';
        taikoTrack.appendChild(nice);
        setTimeout(() => nice.remove(), 800);
      }
    }


    // Record data per round
    if (currentRound === 1) {
      drumData.visual.tapTimes.push(now);
      if (pendingCueTime) {
        drumData.visual.delays.push(now - pendingCueTime);
        pendingCueTime = null;
      }
      updateProgress(drumData.visual.tapTimes.length, BEATS_PER_ROUND);
    } else if (currentRound === 2) {
      drumData.auditory.tapTimes.push(now);
      if (pendingCueTime) {
        const delay = now - pendingCueTime;
        drumData.auditory.delays.push(delay);
        pendingCueTime = null;

        // Reward feedback based on reaction time
        const drumCenter = document.querySelector('.drum-center');
        const reward = document.createElement('div');
        reward.className = 'taiko-nice';
        reward.style.position = 'absolute';
        reward.style.left = '50%';
        reward.style.top = '10%';
        reward.style.zIndex = '20';
        if (delay < 200) {
          reward.textContent = 'Perfect!';
          reward.style.color = '#4CAF50';
        } else if (delay < 400) {
          reward.textContent = 'Nice!';
          reward.style.color = '#FF8C42';
        } else {
          reward.textContent = 'OK';
          reward.style.color = '#999';
        }
        drumCenter.appendChild(reward);
        setTimeout(() => reward.remove(), 800);
      }
      updateProgress(drumData.auditory.tapTimes.length, BEATS_PER_ROUND);
    } else if (currentRound === 3) {
      drumData.free.tapTimes.push(now);
      const tapCount = drumData.free.tapTimes.length;
      updateEnergyBar(tapCount);

      // Sound wave visual effect
      const wave1 = document.createElement('div');
      wave1.className = 'drum-soundwave';
      drumArea.appendChild(wave1);
      setTimeout(() => wave1.remove(), 800);
      const wave2 = document.createElement('div');
      wave2.className = 'drum-soundwave';
      wave2.style.animationDelay = '0.15s';
      drumArea.appendChild(wave2);
      setTimeout(() => wave2.remove(), 1000);

      // Encouragement text at milestones
      const drumCenter = document.querySelector('.drum-center');
      const encouragements = {
        3: 'Go! 🥁',
        8: 'Great rhythm!',
        14: 'Keep it up! 🔥',
        20: 'Almost there!',
        25: 'So close! ⭐',
      };
      if (encouragements[tapCount]) {
        const msg = document.createElement('div');
        msg.className = 'taiko-nice';
        msg.textContent = encouragements[tapCount];
        msg.style.position = 'absolute';
        msg.style.left = '50%';
        msg.style.top = '10%';
        msg.style.zIndex = '20';
        msg.style.color = '#FF8C42';
        drumCenter.appendChild(msg);
        setTimeout(() => msg.remove(), 1000);
      }

      if (tapCount >= FREE_TAPS_NEEDED) {
        drumEnabled = false;
        finishDrum();
      }
    }

    logEvent('drum_tap', { round: currentRound, timestamp: now });
  }

  drumArea._drumHandler && drumArea.removeEventListener('pointerdown', drumArea._drumHandler);
  drumArea._drumHandler = onDrumTap;
  drumArea.addEventListener('pointerdown', onDrumTap);

  // --- UI helpers ---
  // Put round indicators into the topbar instruction area
  const roundLabels = ['Demo', '👀', '👂', '🆓'];
  function setRound(r) {
    currentRound = r;
    // Build inline round indicators in the instruction area
    const roundsHTML = roundLabels.map((label, i) => {
      const cls = i < r ? 'drum-round done' : i === r ? 'drum-round active' : 'drum-round';
      return `<span class="${cls}">${label}</span>`;
    }).join('');
    instructionEl.innerHTML = roundsHTML;
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
    if (briefHint) {
      // Show brief instruction for 1.5s before countdown
      showCountdown(briefHint, () => {
        showCountdown('3', () => {
          showCountdown('2', () => {
            showCountdown('1', () => {
              showCountdown('Go!', callback);
            });
          });
        });
      });
    } else {
      showCountdown('3', () => {
        showCountdown('2', () => {
          showCountdown('1', () => {
            showCountdown('Go!', callback);
          });
        });
      });
    }
  }

  // --- Metronome click sound ---
  function playMetronomeClick() {
    const ctx = state.audioCtx;
    ctx.resume().then(() => {
      const now = ctx.currentTime;
      const bufSize = Math.floor(ctx.sampleRate * 0.02);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003));
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 15;
      const tone = ctx.createOscillator();
      tone.type = 'sine'; tone.frequency.value = 1200;
      const nG = ctx.createGain();
      nG.gain.setValueAtTime(0.25, now);
      nG.gain.exponentialRampToValueAtTime(0.01, now + 0.02);
      const tG = ctx.createGain();
      tG.gain.setValueAtTime(0.12, now);
      tG.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
      noise.connect(bp); bp.connect(nG); nG.connect(ctx.destination);
      tone.connect(tG); tG.connect(ctx.destination);
      noise.start(now); tone.start(now);
      noise.stop(now + 0.02); tone.stop(now + 0.05);
    });
  }

  // --- Taiko note animation (visual round) — circles scroll right to left ---
  function spawnTaikoNote() {
    const note = document.createElement('div');
    note.className = 'taiko-note';
    taikoNotes.appendChild(note);

    const trackWidth = taikoTrack.offsetWidth || 500;
    const targetCenterX = trackWidth * 0.33; // 1/3 of track
    const travelTime = 2500;
    const startTime = Date.now();

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / travelTime;
      if (progress >= 1) { note.remove(); return; }

      // Scroll from right edge to left
      const x = trackWidth - (progress * (trackWidth + 60));
      note.style.left = x + 'px';

      // Register cue when note overlaps target circle
      const noteCenter = x + 16; // half of note width
      if (!note._cueRegistered && Math.abs(noteCenter - targetCenterX) < 25) {
        note._cueRegistered = true;
        pendingCueTime = Date.now();
        drumData.visual.cueTimes.push(pendingCueTime);
      }

      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  // --- Audio-only cue (auditory round) ---
  function playAudioCue() {
    // Only play if we're actually in round 2
    if (currentRound !== 2) return;
    pendingCueTime = Date.now();
    drumData.auditory.cueTimes.push(pendingCueTime);
    playMetronomeClick();
  }

  // --- Round 0: Intro ---
  function startIntro() {
    setRound(0);
    hands.style.display = '';
    hands.classList.remove('tapped');
    if (taikoTrack) taikoTrack.classList.remove('visible');
    instructionEl.innerHTML += ' <span class="drum-hint-inline">Watch and learn!</span>';
    drumEnabled = false;

    let introBeats = 0;
    introTimer = setInterval(() => {
      if (currentRound !== 0) return;
      playDrumHit();
      drumImg.classList.add('hit');
      setTimeout(() => drumImg.classList.remove('hit'), 100);
      introBeats++;
      updateProgress(introBeats, 6);
      if (introBeats >= 6) {
        clearInterval(introTimer); introTimer = null;
        hands.classList.add('tapped');
        setTimeout(() => startVisualRound(), 500);
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
  };

  // --- Round 1: Visual following ---
  function startVisualRound() {
    clearAllTimers();
    setRound(1);
    if (taikoTrack) taikoTrack.classList.add('visible');
    instructionEl.innerHTML += ' <span class="drum-hint-inline">Tap when the ball hits!</span>';

    runCountdown(() => {
      drumEnabled = true;
      let localBeatCount = 0;
      let done = false;
      roundTimer = setInterval(() => {
        if (done || currentRound !== 1) return;
        spawnTaikoNote();
        localBeatCount++;
        if (localBeatCount >= BEATS_PER_ROUND) {
          done = true;
          clearAllTimers();
          setTimeout(() => {
            drumEnabled = false;
            if (taikoTrack) taikoTrack.classList.remove('visible');
            startAuditoryRound();
          }, 1500);
        }
      }, BEAT_INTERVAL);
    });
  }

  // --- Round 2: Auditory following ---
  function startAuditoryRound() {
    clearAllTimers();
    setRound(2);
    if (taikoTrack) taikoTrack.classList.remove('visible');
    instructionEl.innerHTML += ' <span class="drum-hint-inline">Listen and tap!</span>';

    runCountdown(() => {
      drumEnabled = true;
      let localBeatCount = 0;
      let done = false;
      roundTimer = setInterval(() => {
        if (done || currentRound !== 2) return;
        playAudioCue();
        localBeatCount++;
        if (localBeatCount >= BEATS_PER_ROUND) {
          done = true;
          clearAllTimers();
          setTimeout(() => {
            drumEnabled = false;
            startFreeRound();
          }, 1500);
        }
      }, BEAT_INTERVAL);
    });
  }

  // --- Round 3: Free play with energy bar ---
  function startFreeRound() {
    clearAllTimers();
    setRound(3);
    if (taikoTrack) taikoTrack.classList.remove('visible');
    instructionEl.innerHTML += ' <span class="drum-hint-inline">Play your own beat!</span>';

    // Show energy bar in the taiko track area
    taikoNotes.innerHTML = '';
    taikoTarget.style.display = 'none';
    // Add energy bar container
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

    runCountdown(() => {
      drumEnabled = true;
    });
  }

  function updateEnergyBar(tapCount) {
    const bar = document.getElementById('free-energy-bar');
    if (!bar) return;
    const segs = bar.querySelectorAll('.energy-seg');
    segs.forEach((seg, i) => {
      if (i < tapCount && !seg.classList.contains('lit')) {
        seg.classList.add('lit');
      }
    });
  }

  // --- Finish ---
  function finishDrum() {
    clearAllTimers();
    instructionEl.innerHTML += ' <span class="drum-hint-inline">Great job!</span>';

    state.drumData = drumData;

    const vDelays = drumData.visual.delays;
    const aDelays = drumData.auditory.delays;
    const fTaps = drumData.free.tapTimes;

    state.drumVisualLatency = vDelays.length > 0
      ? Math.round(vDelays.reduce((a, b) => a + b, 0) / vDelays.length) : null;
    state.drumAuditoryLatency = aDelays.length > 0
      ? Math.round(aDelays.reduce((a, b) => a + b, 0) / aDelays.length) : null;

    if (fTaps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < fTaps.length; i++) intervals.push(fTaps[i] - fTaps[i - 1]);
      state.drumAvgInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
      state.drumTaps = fTaps;
    }

    logEvent('drum_complete', {
      visualLatency: state.drumVisualLatency,
      auditoryLatency: state.drumAuditoryLatency,
      freeAvgInterval: state.drumAvgInterval,
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

function playDrumHit() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;
  // Always resume — iOS can suspend at any time
  ctx.resume().then(() => {
    const now = ctx.currentTime;

    // Realistic drum: body (pitch drop) + warmth (triangle) + stick hit (noise)

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

  // AUDITORY: average note count of auditory elements
  const audioElems = state.placedElements.filter(e => e.dimension === 'auditory');
  let auditoryScore = 0.5;
  if (audioElems.length > 0) {
    const avgNotes = audioElems.reduce((sum, e) => {
      return sum + ((e.volumeLevel !== undefined ? e.volumeLevel : 2) / MAX_NOTES);
    }, 0) / audioElems.length;
    auditoryScore = avgNotes;
  }

  // VISUAL: average saturation of colors used
  let visualScore = 0.5;
  const realStrokes = state.colorStrokes.filter(s => s.color !== 'eraser');
  if (realStrokes.length > 0) {
    const satValues = realStrokes.map(s => getColorSaturation(s.color));
    visualScore = satValues.reduce((a, b) => a + b, 0) / satValues.length;
  }

  // TEMPORAL: from drum rhythm — faster tapping = higher score
  let temporalScore = 0.5;
  if (state.drumAvgInterval) {
    // Map: 200ms (very fast) → 1.0, 1000ms (very slow) → 0.0
    temporalScore = Math.max(0, Math.min(1, (1000 - state.drumAvgInterval) / 800));
  }

  return {
    spatial: { score: spatialScore, friendCount: spatialElems.length },
    auditory: { score: auditoryScore, elementCount: audioElems.length },
    visual: { score: visualScore, strokeCount: realStrokes.length },
    temporal: { score: temporalScore, animatedCount: state.animatedElements.size, totalCount: nonAvatarElements.length },
  };
}

function getColorSaturation(hexColor) {
  if (!hexColor || hexColor.length < 7) return 0;
  const r = parseInt(hexColor.slice(1, 3), 16) / 255;
  const g = parseInt(hexColor.slice(3, 5), 16) / 255;
  const b = parseInt(hexColor.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
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
    drum: {
      visualLatency: state.drumVisualLatency || null,
      auditoryLatency: state.drumAuditoryLatency || null,
      freeAvgInterval: state.drumAvgInterval || null,
      visualDelays: state.drumData ? state.drumData.visual.delays : [],
      auditoryDelays: state.drumData ? state.drumData.auditory.delays : [],
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
  } else if (stageName === 'sound') {
    screenshot = state.stageScreenshots.sound;
  } else if (stageName === 'drum') {
    stageData.visualLatency = state.drumVisualLatency || null;
    stageData.auditoryLatency = state.drumAuditoryLatency || null;
    stageData.freeAvgInterval = state.drumAvgInterval || null;
    stageData.visualDelays = state.drumData ? state.drumData.visual.delays : [];
    stageData.auditoryDelays = state.drumData ? state.drumData.auditory.delays : [];
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
        setTimeout(() => goToPhase('video'), 4000);
      } else {
        setTimeout(() => goToPhase('video'), 1000);
      }
    }
  }, 1500);
}

// ============================================================
// VIDEO PLAYER (Stage 2 — simplified)
// ============================================================
let videoPreferences = null;
let currentLevel = 2; // 1=gentle, 2=baseline, 3=challenge
let s2PauseTriggered = false;

function initVideoPlayer() {
  videoPreferences = extractPreferences();
  s2PauseTriggered = false;

  const video = document.getElementById('sense-video');

  // Select video based on spatial preference (friend distance)
  const spatialScore = videoPreferences.spatial.score;
  let videoFile = 'video/base_medium.mp4';
  if (spatialScore > 0.65) {
    videoFile = 'video/base_far.mp4';    // child placed friends far → show far perspective
  } else if (spatialScore < 0.35) {
    videoFile = 'video/base_near.mp4';   // child placed friends close → show near perspective
  }
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

  // Apply initial preferences
  applyVideoPreferences();

  // Populate profile bars
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

  // Time update
  video.ontimeupdate = () => {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    progressFill.style.width = pct + '%';
    progressThumb.style.left = pct + '%';
    timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);

    // S2 pause at 22%
    if (!s2PauseTriggered && pct >= 22) {
      s2PauseTriggered = true;
      video.pause();
      playPause.innerHTML = '&#9654;';
      videoWrap.classList.add('paused');
      document.getElementById('s2-pause-overlay').classList.remove('hidden');
    }
  };

  // Timeline seek
  document.getElementById('timeline-track').onclick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
  };

  // Settings panel toggle
  document.getElementById('fab-dot').onclick = () => {
    document.getElementById('fab-panel').classList.toggle('hidden');
  };

  // Profile toggle
  document.getElementById('fab-profile-toggle').onclick = () => {
    document.getElementById('fab-profile').classList.toggle('hidden');
  };

  // Level buttons
  document.querySelectorAll('.fab-level').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.fab-level').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLevel = parseInt(btn.dataset.level);
      applyVideoPreferences();
    };
  });

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
}

function applyVideoPreferences() {
  if (!videoPreferences) return;

  const video = document.getElementById('sense-video');
  const levelMultiplier = currentLevel === 1 ? 0.5 : currentLevel === 3 ? 1.5 : 1.0;

  // Visual: CSS brightness
  const brightness = 0.6 + videoPreferences.visual.score * 0.4 * levelMultiplier;
  video.style.filter = `brightness(${Math.min(1.5, brightness)})`;
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

console.log('SENSE Canvas Demo loaded');

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
  brushSize: 4,
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
  { id: 'color', instruction: 'Color your picture!', dotIndex: 0 },
  { id: 'add-elements', instruction: 'Add friends and things!', dotIndex: 1 },
  { id: 'animate', instruction: 'Drum time!', dotIndex: 2 },
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
  if (phase === 'drum') setupAnimatePhase();
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
  goToPhase('photo');
});

// Sound test button — also initializes shared AudioContext for iPad
document.getElementById('btn-sound-test').addEventListener('click', () => {
  try {
    // Create and store a shared AudioContext
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.setTargetAtTime(0, ctx.currentTime + 0.3, 0.1);
    osc.stop(ctx.currentTime + 0.5);
    document.getElementById('btn-sound-test').textContent = '✅ Sound OK!';
  } catch(e) {
    document.getElementById('btn-sound-test').textContent = '❌ ' + e.message;
  }
});

document.getElementById('btn-test-drum').addEventListener('click', () => {
  goToPhase('drum');
});

document.getElementById('btn-skip').addEventListener('click', () => {
  // Skip to canvas with birthday template, use test avatar
  state.eventType = 'birthday';
  state.childPhoto = 'assets/test_avatar.png?v=' + Date.now();
  loadTemplate('birthday').then(() => {
    goToPhase('canvas');
  });
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

  // Show/hide back button
  const idx = SUB_PHASE_ORDER.indexOf(subPhase);
  btnBack.classList.toggle('hidden', idx <= 0);

  // Reset visibility
  palette.classList.remove('hidden');
  colorToolbar.classList.add('hidden');
  animateBar.classList.add('hidden');
  btnNext.classList.remove('hidden');
  colorCanvas.style.pointerEvents = 'none';
  colorCanvas.classList.remove('drawing-mode');
  colorCanvas.style.mixBlendMode = 'normal';
  elementLayer.style.zIndex = '3';
  elementLayer.style.pointerEvents = 'auto';
  hideTouchCrayon();
  hideColorHint();

  // Merge color strokes onto avatar image so coloring moves with character
  mergeColorOntoAvatar();
  // After merge, reset color canvas z-index (strokes are now on avatar)
  colorCanvas.style.zIndex = '2';

  // Remove tappable/animated hints
  document.querySelectorAll('.canvas-element').forEach(el => {
    el.classList.remove('tappable');
  });

  switch (subPhase) {
    case 'place-self':
      // Auto-place avatar and skip to color
      autoPlaceAvatar();
      setCanvasSubPhase('color');
      return;

    case 'add-elements':
      renderElementPalette();
      break;

    case 'color':
      palette.classList.add('hidden');
      colorToolbar.classList.remove('hidden');
      colorCanvas.style.pointerEvents = 'auto';
      colorCanvas.classList.add('drawing-mode');
      colorCanvas.style.zIndex = '10';
      colorCanvas.style.mixBlendMode = 'multiply';
      elementLayer.style.zIndex = '3';
      elementLayer.style.pointerEvents = 'none';
      setTimeout(updateCrayonCursor, 50);
      // Show coloring hint on avatar after it loads
      setTimeout(showColorHint, 1500);
      break;

    case 'animate':
      // Go to separate drum screen
      goToPhase('drum');
      return;
  }
}

function updatePhaseDots(activeIdx) {
  document.querySelectorAll('.phase-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIdx);
    dot.classList.toggle('done', i < activeIdx);
  });
}

// --- Next / Back buttons ---
const SUB_PHASE_ORDER = ['place-self', 'color', 'add-elements', 'animate'];

document.getElementById('btn-canvas-next').addEventListener('click', () => {
  const idx = SUB_PHASE_ORDER.indexOf(state.canvasSubPhase);
  if (idx < SUB_PHASE_ORDER.length - 1) {
    setCanvasSubPhase(SUB_PHASE_ORDER[idx + 1]);
  }
});

document.getElementById('btn-canvas-back').addEventListener('click', () => {
  const idx = SUB_PHASE_ORDER.indexOf(state.canvasSubPhase);
  if (idx > 0) {
    setCanvasSubPhase(SUB_PHASE_ORDER[idx - 1]);
  }
});

// --- Animate done button ---
document.getElementById('btn-animate-done').addEventListener('click', () => {
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
}

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
  const sizes = {
    friend: 250,
    lamp: 250,
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

    // Create a pleasant looping ambient: gentle chords + soft noise
    ambientGain = ctx.createGain();
    ambientGain.gain.value = ambientVolume;
    ambientGain.connect(ctx.destination);

    // Chord pad: C major (C4 E4 G4) with triangle waves
    const notes = [261.63, 329.63, 392.00];
    notes.forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      // Gentle vibrato
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 2 + Math.random();
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 1.5;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;

      osc.connect(filter);
      filter.connect(ambientGain);
      osc.start();

      // Store for cleanup
      if (!state._ambientOscs) state._ambientOscs = [];
      state._ambientOscs.push(osc, lfo);
    });

    // Soft noise layer (room tone)
    const bufSize = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'lowpass';
    nFilter.frequency.value = 400;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.3;
    noise.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(ambientGain);
    noise.start();
    if (!state._ambientOscs) state._ambientOscs = [];
    state._ambientOscs.push(noise);
  });
}

function setAmbientVolume(vol) {
  ambientVolume = vol;
  if (ambientGain) {
    ambientGain.gain.setTargetAtTime(vol, state.audioCtx.currentTime, 0.1);
  }
}

function stopAmbientLoop() {
  if (state._ambientOscs) {
    state._ambientOscs.forEach(o => { try { o.stop(); } catch(e) {} });
    state._ambientOscs = [];
  }
  ambientPlaying = false;
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

  cord.addEventListener('pointerup', (e) => {
    if (pullStartY === null) return;
    const dy = e.clientY - pullStartY;
    pullStartY = null;

    // Snap back
    cordSvg.style.transition = 'transform 0.3s ease-out';
    cordSvg.style.transform = 'scaleY(1)';
    setTimeout(() => { cordSvg.style.transition = ''; }, 300);

    if (dy > 25) {
      lampBrightness = (lampBrightness + 1) % 6;
      applyLampBrightness();

      // Persistent glow based on brightness level
      const glowIntensity = lampBrightness * 8;
      el.style.filter = lampBrightness > 0
        ? `drop-shadow(0 0 ${glowIntensity}px rgba(255,220,100,${lampBrightness * 0.15}))`
        : 'none';

      logEvent('lamp_pull', { brightness: lampBrightness });
    }
  });
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

  if (elemDef.dimension === 'spatial' || elemDef.type === 'friend') {
    // Say "Hi!" with gender-appropriate child voice
    sayHi(elemDef.id);
  }

  if (elemDef.type === 'lamp') {
    // Initial dim state — pull cord to brighten
    applyLampBrightness();
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

  el.addEventListener('pointerup', (e) => {
    if (state.canvasSubPhase === 'color' || state.canvasSubPhase === 'animate') return;
    const dx = Math.abs(e.clientX - (tapStartX || 0));
    const dy = Math.abs(e.clientY - (tapStartY || 0));
    const dt = Date.now() - (tapStartTime || 0);

    // Tap detection: minimal movement + short duration
    if (!moved && dx < 10 && dy < 10 && dt < 300) {
      showDeleteButton(el);
    }
  });
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
  };

  const onUp = () => {
    el.classList.remove('dragging');
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
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

// --- Color hint on avatar ---
function showColorHint() {
  hideColorHint();
  const avatar = document.getElementById('avatar-main');
  if (!avatar) return;

  const rect = avatar.getBoundingClientRect();

  const hint = document.createElement('div');
  hint.className = 'color-hint-overlay';
  hint.id = 'color-hint';
  hint.innerHTML = `
    <div class="color-hint-icon">🖍️</div>
    <div class="color-hint-text">Color me!</div>
  `;
  hint.style.left = (rect.left + rect.width / 2) + 'px';
  hint.style.top = (rect.top - 10) + 'px';
  hint.style.pointerEvents = 'auto';
  hint.style.cursor = 'pointer';
  document.body.appendChild(hint);

  // Tap "Color me!" → swap avatar to lineart, then remove hint
  hint.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    // Swap to lineart
    const img = avatar.querySelector('img');
    if (img) {
      avatar.dataset.originalSrc = img.src;
      img.src = 'assets/test_avatar_lineart.png?v=' + Date.now();
    }
    hideColorHint();
  });

  // Also remove hint on canvas touch (without swapping)
  const canvas = document.getElementById('color-canvas');
  const removeHint = () => {
    hideColorHint();
    canvas.removeEventListener('pointerdown', removeHint);
  };
  canvas.addEventListener('pointerdown', removeHint);
}

function hideColorHint() {
  document.getElementById('color-hint')?.remove();
}

// --- Touch crayon (iPad/touch) ---
const touchCrayon = document.getElementById('touch-crayon');
let touchCrayonVisible = false;

function initTouchCrayon() {
  // Build the crayon DOM structure
  touchCrayon.innerHTML = `
    <div class="touch-crayon-label"></div>
    <div class="touch-crayon-body"></div>
    <div class="touch-crayon-tip"></div>
  `;
  updateTouchCrayonColor();
}
initTouchCrayon();

function updateTouchCrayonColor() {
  const body = touchCrayon.querySelector('.touch-crayon-body');
  const tip = touchCrayon.querySelector('.touch-crayon-tip');
  if (!body || !tip) return;
  const color = state.isEraser ? '#ccc' : state.selectedColor;
  body.style.background = color;
  tip.style.borderTop = `10px solid ${color}`;
}

function showTouchCrayon(x, y) {
  if (state.canvasSubPhase !== 'color') return;
  touchCrayon.classList.remove('hidden');
  touchCrayon.style.left = x + 'px';
  touchCrayon.style.top = y + 'px';
  // Tilt based on screen position: left half → left hand tilt, right half → right hand tilt
  const isLeftHand = x < window.innerWidth / 2;
  touchCrayon.style.transform = isLeftHand
    ? 'translate(-32px, -52px) rotate(25deg)'   // left hand: tilt right
    : 'translate(-8px, -52px) rotate(-25deg)';   // right hand: tilt left
  touchCrayonVisible = true;
}

function moveTouchCrayon(x, y) {
  if (!touchCrayonVisible) return;
  touchCrayon.style.left = x + 'px';
  touchCrayon.style.top = y + 'px';
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
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
      '<rect x="10" y="10" width="28" height="28" rx="4" fill="#fff" stroke="#999" stroke-width="2" stroke-dasharray="4 2"/>' +
      '<line x1="16" y1="16" x2="32" y2="32" stroke="#ccc" stroke-width="2"/>' +
      '<line x1="32" y1="16" x2="16" y2="32" stroke="#ccc" stroke-width="2"/>' +
      '</svg>'
    ) + '") 24 24, crosshair';
    return;
  }

  const color = state.selectedColor;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <rect x="14" y="2" width="12" height="32" rx="3" fill="${color}" stroke="#333" stroke-width="1.5" transform="rotate(-35 20 24)"/>
    <rect x="14" y="2" width="12" height="6" rx="2" fill="#555" opacity="0.4" transform="rotate(-35 20 24)"/>
    <polygon points="10,38 16,30 22,38" fill="${color}" stroke="#333" stroke-width="1" opacity="0.9" transform="rotate(-5 16 34)"/>
  </svg>`;
  canvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 42, crosshair`;
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
    // iOS: resume suspended context
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    return;
  }
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // iOS: must resume after creation
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }

  // Music box tone: two sine oscillators
  state.oscillator = state.audioCtx.createOscillator();
  state.oscillator.type = 'sine';
  state.oscillator.frequency.value = 523.25; // C5

  state.oscillator2 = state.audioCtx.createOscillator();
  state.oscillator2.type = 'sine';
  state.oscillator2.frequency.value = 659.25; // E5

  state.filterNode = state.audioCtx.createBiquadFilter();
  state.filterNode.type = 'lowpass';
  state.filterNode.frequency.value = 2000;

  state.gainNode = state.audioCtx.createGain();
  state.gainNode.gain.value = 0;

  state.oscillator.connect(state.filterNode);
  state.oscillator2.connect(state.filterNode);
  state.filterNode.connect(state.gainNode);
  state.gainNode.connect(state.audioCtx.destination);

  state.oscillator.start();
  state.oscillator2.start();
}

// Pre-init audio on first user touch (iOS requirement)
document.addEventListener('touchstart', function initAudioOnTouch() {
  initAudio();
  document.removeEventListener('touchstart', initAudioOnTouch);
}, { once: true });

function updateAudioForSize(size) {
  initAudio();
  const t = Math.max(0, Math.min(1, (size - 40) / 260));
  const volume = 0.05 + t * 0.35;
  const filterFreq = 300 + t * 7700;
  state.gainNode.gain.setTargetAtTime(volume, state.audioCtx.currentTime, 0.08);
  state.filterNode.frequency.setTargetAtTime(filterFreq, state.audioCtx.currentTime, 0.08);
}

function stopAudio() {
  if (state.gainNode) {
    state.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.15);
  }
}

// ============================================================
// ANIMATE PHASE
// ============================================================
// ============================================================
// DRUM RHYTHM PHASE (Temporal pacing)
// ============================================================
function setupAnimatePhase() {
  const drumArea = document.getElementById('drum-area');
  const drumImg = document.getElementById('drum-img');
  const drumHint = document.getElementById('drum-hint');
  const tempoDisplay = document.getElementById('tempo-display');

  // State for rhythm detection
  const tapTimes = [];
  let avgInterval = 500; // default: medium tempo (ms between beats)

  // Build tempo indicator dots
  tempoDisplay.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement('div');
    dot.className = 'tempo-dot';
    tempoDisplay.appendChild(dot);
  }
  const tempoLabel = document.createElement('span');
  tempoLabel.className = 'tempo-label';
  tempoLabel.textContent = 'Tap!';
  tempoDisplay.appendChild(tempoLabel);

  // Remove old handler
  drumArea._drumHandler && drumArea.removeEventListener('pointerdown', drumArea._drumHandler);

  drumArea._drumHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    tapTimes.push(now);

    // Keep last 22 taps (need 20 for full energy bar)
    if (tapTimes.length > 22) tapTimes.shift();

    // Visual: drum bounce
    drumImg.classList.add('hit');
    setTimeout(() => drumImg.classList.remove('hit'), 100);

    // Visual: ripple
    const ripple = document.createElement('div');
    ripple.className = 'drum-ripple';
    document.getElementById('drum-hits').appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);

    // Sound: drum hit
    playDrumHit();

    // Fade out demo hands only after practice is done
    if (!state._isPractice) {
      const hands = document.querySelector('.drum-hands');
      if (hands && !hands.classList.contains('tapped')) {
        hands.classList.add('tapped');
      }
    }

    // Flash beat ball green on hit
    const beatBall = document.getElementById('beat-ball');
    if (beatBall) {
      beatBall.classList.add('hit');
      setTimeout(() => beatBall.classList.remove('hit'), 200);
    }

    // Calculate average interval from taps
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) {
        intervals.push(tapTimes[i] - tapTimes[i - 1]);
      }
      avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      // Update tempo display
      // Map interval: 200ms (very fast) → 5 dots, 1000ms (very slow) → 1 dot
      const tempoDots = Math.max(1, Math.min(5, Math.round(6 - avgInterval / 200)));
      tempoDisplay.querySelectorAll('.tempo-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i < tempoDots);
      });

      const tempoNames = ['', 'Very Slow', 'Slow', 'Medium', 'Fast', 'Very Fast'];
      tempoLabel.textContent = tempoNames[tempoDots] || '';

      // Animate canvas elements to match the beat
      updateCanvasAnimationSpeed(avgInterval);
    }

    // Energy bar: every 2 taps lights one segment
    const totalTaps = tapTimes.length;
    const litCount = Math.min(5, Math.floor(totalTaps / 4));
    document.querySelectorAll('.energy-seg').forEach((seg, i) => {
      if (i < litCount) {
        if (!seg.classList.contains('lit')) {
          seg.classList.add('lit', 'full-pulse');
          setTimeout(() => seg.classList.remove('full-pulse'), 400);
        }
      }
    });

    // Stop metronome in recording round — child plays freely
    if (!state._isPractice && state._stopMetronome) {
      state._stopMetronome();
      state._stopMetronome = null;
    }

    if (litCount < 5) {
      drumHint.textContent = totalTaps < 2 ? 'Follow the beat!' : 'Keep going!';
    } else {
      drumHint.textContent = 'Great rhythm!';
    }

    // Store for preference extraction
    state.drumTaps = tapTimes.slice();
    state.drumAvgInterval = avgInterval;

    logEvent('drum_tap', { tapCount: totalTaps, avgInterval: Math.round(avgInterval) });

    // Check if practice round is done
    if (state._checkPracticeEnd) state._checkPracticeEnd();

    // Auto-advance when energy bar is full (only in recording round)
    if (litCount >= 5) {
      if (state._stopMetronome) state._stopMetronome();
      setTimeout(() => {
        goToPhase('processing');
      }, 800);
    }
  };

  drumArea.addEventListener('pointerdown', drumArea._drumHandler);

  // Remove adjust handlers from elements
  document.querySelectorAll('.canvas-element').forEach(el => {
    el.classList.remove('audio-adjustable', 'lights-adjustable');
    el._audioClickHandler && el.removeEventListener('pointerdown', el._audioClickHandler);
    el._lightsClickHandler && el.removeEventListener('pointerdown', el._lightsClickHandler);
  });

  // Warm up AudioContext for drum phase (iOS needs this)
  if (state.audioCtx) {
    state.audioCtx.resume();
  }

  // Disable drum tapping during intro
  let drumEnabled = false;
  const origHandler = drumArea._drumHandler;

  // Metronome synced with hand animation: each hand cycle 1.4s, 2 hands offset 0.7s = hit every 700ms
  let beatInterval = 700;
  let metronomeTimer = null;

  function playMetronomeClick() {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = state.audioCtx;
    ctx.resume().then(() => {
      const now = ctx.currentTime;

      // Woodblock click — short bandpass noise + resonant tone
      const bufSize = Math.floor(ctx.sampleRate * 0.02);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003));
      const noise = ctx.createBufferSource();
      noise.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 15;

      const tone = ctx.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = 1200;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.25, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.02);

      const toneGain = ctx.createGain();
      toneGain.gain.setValueAtTime(0.12, now);
      toneGain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);

      noise.connect(bp);
      bp.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      tone.connect(toneGain);
      toneGain.connect(ctx.destination);

      noise.start(now);
      tone.start(now);
      noise.stop(now + 0.02);
      tone.stop(now + 0.05);
    });
  }

  function startMetronome() {
    stopMetronome();
    playMetronomeClick();
    metronomeTimer = setInterval(playMetronomeClick, beatInterval);
  }

  function stopMetronome() {
    if (metronomeTimer) {
      clearInterval(metronomeTimer);
      metronomeTimer = null;
    }
  }

  function updateMetronomeTempo(newInterval) {
    beatInterval = newInterval;
    startMetronome(); // restart with new interval
  }

  // Store reference so we can update tempo from tap handler
  state._updateMetronomeTempo = updateMetronomeTempo;
  state._stopMetronome = stopMetronome;

  // --- Two rounds: Practice + Record ---
  let isPractice = true;
  state._isPractice = true;
  drumHint.textContent = 'Practice! Try the beat';
  // Delay metronome start to sync with first hand hitting at 630ms (45% of 1.4s)
  setTimeout(() => startMetronome(), 630);
  drumArea.addEventListener('pointerdown', drumArea._drumHandler);

  // After 10 taps in practice, show 3-2-1 then start recording
  state._checkPracticeEnd = () => {
    if (isPractice && tapTimes.length >= 10) {
      isPractice = false;
      state._isPractice = false;
      // Reset taps and energy bar for real recording
      tapTimes.length = 0;
      document.querySelectorAll('.energy-seg').forEach(seg => seg.classList.remove('lit', 'full-pulse'));

      // 3-2-1 countdown — big shrinking numbers in center
      drumArea.removeEventListener('pointerdown', drumArea._drumHandler);
      drumHint.textContent = '';

      function showCountdown(text, callback) {
        const overlay = document.createElement('div');
        overlay.className = 'countdown-number';
        overlay.textContent = text;
        document.querySelector('.drum-center').appendChild(overlay);
        setTimeout(() => {
          overlay.remove();
          if (callback) callback();
        }, 800);
      }

      showCountdown('3', () => {
        showCountdown('2', () => {
          showCountdown('1', () => {
            showCountdown('Go!', () => {
              drumArea.addEventListener('pointerdown', drumArea._drumHandler);
              drumHint.textContent = 'Now for real!';
            });
          });
        });
      });
    }
  };
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
  const steps = ['step-reading', 'step-scene', 'step-prefs', 'step-ready'];
  let i = 0;

  // Reset all steps
  steps.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('active');
      const dot = el.querySelector('.step-dot');
      if (dot) dot.classList.remove('active');
    }
  });

  const interval = setInterval(() => {
    if (i < steps.length) {
      const el = document.getElementById(steps[i]);
      if (el) {
        el.classList.add('active');
        const dot = el.querySelector('.step-dot');
        if (dot) dot.classList.add('active');
      }
      i++;
    } else {
      clearInterval(interval);
      setTimeout(() => goToPhase('video'), 600);
    }
  }, 800);
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

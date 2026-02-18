// ============================================================
// SENSE 2D Sensory Elicitation Demo — Enhanced
// ============================================================

const HOLD_DURATION = 3000;
const SCENES = ['auditory', 'visual', 'spatial', 'temporal'];
const RING_CIRCUMFERENCE = 2 * Math.PI * 55; // matches SVG r=55

// --- State ---
const state = {
  currentScene: -1,
  results: {},
  isDragging: false,
  dragAvatar: null,
  dragOffset: { x: 0, y: 0 },
  lastPos: { x: 0, y: 0 },
  stillStart: null,
  audioCtx: null,
  oscillator: null,
  oscillator2: null,
  gainNode: null,
  filterNode: null,
  confirmed: false,
  interactionLog: [],
  pawCounter: 0,
};

// ============================================================
// PARTICLES — background canvas
// ============================================================
const particleCanvas = document.getElementById('particle-canvas');
const pCtx = particleCanvas.getContext('2d');
let particles = [];

const SCENE_PARTICLES = {
  welcome: { color: '255,255,255', count: 30, speed: 0.3, size: 3 },
  auditory: { color: '147,130,255', count: 25, speed: 0.4, size: 3 },
  visual: { color: '255,200,100', count: 20, speed: 0.25, size: 4 },
  spatial: { color: '255,255,255', count: 15, speed: 0.15, size: 3 },
  temporal: { color: '255,215,0', count: 0, speed: 0, size: 0 }, // stars handled separately
  results: { color: '255,255,255', count: 20, speed: 0.3, size: 3 },
};

function resizeCanvas() {
  particleCanvas.width = window.innerWidth;
  particleCanvas.height = window.innerHeight;
  const cc = document.getElementById('confetti-canvas');
  if (cc) { cc.width = window.innerWidth; cc.height = window.innerHeight; }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function spawnParticles(config) {
  particles = [];
  for (let i = 0; i < config.count; i++) {
    particles.push({
      x: Math.random() * particleCanvas.width,
      y: Math.random() * particleCanvas.height,
      vx: (Math.random() - 0.5) * config.speed,
      vy: -Math.random() * config.speed - 0.1,
      size: Math.random() * config.size + 1,
      alpha: Math.random() * 0.5 + 0.2,
      color: config.color,
    });
  }
}

function animateParticles() {
  pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.y < -10) { p.y = particleCanvas.height + 10; p.x = Math.random() * particleCanvas.width; }
    if (p.x < -10) p.x = particleCanvas.width + 10;
    if (p.x > particleCanvas.width + 10) p.x = -10;
    p.alpha += (Math.random() - 0.5) * 0.02;
    p.alpha = Math.max(0.1, Math.min(0.6, p.alpha));
    pCtx.beginPath();
    pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    pCtx.fillStyle = `rgba(${p.color},${p.alpha})`;
    pCtx.fill();
  });
  requestAnimationFrame(animateParticles);
}
spawnParticles(SCENE_PARTICLES.welcome);
animateParticles();

// ============================================================
// STARS — for temporal scene
// ============================================================
function createStars() {
  const field = document.getElementById('starfield');
  if (!field) return;
  field.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.width = (Math.random() * 3 + 1) + 'px';
    star.style.height = star.style.width;
    star.style.animationDelay = Math.random() * 3 + 's';
    star.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    field.appendChild(star);
  }
}

// ============================================================
// AUDIO
// ============================================================
function initAudio() {
  if (state.audioCtx) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  state.oscillator = state.audioCtx.createOscillator();
  state.oscillator.type = 'sine';
  state.oscillator.frequency.value = 440;

  state.filterNode = state.audioCtx.createBiquadFilter();
  state.filterNode.type = 'lowpass';
  state.filterNode.frequency.value = 2000;
  state.filterNode.Q.value = 1;

  state.gainNode = state.audioCtx.createGain();
  state.gainNode.gain.value = 0;

  state.oscillator2 = state.audioCtx.createOscillator();
  state.oscillator2.type = 'sine';
  state.oscillator2.frequency.value = 554.37;

  state.oscillator.connect(state.filterNode);
  state.oscillator2.connect(state.filterNode);
  state.filterNode.connect(state.gainNode);
  state.gainNode.connect(state.audioCtx.destination);

  state.oscillator.start();
  state.oscillator2.start();
}

function setAudioFromDistance(d) {
  if (!state.audioCtx || !state.filterNode) return;
  const cutoff = 4000 - d * 3800;
  state.filterNode.frequency.setTargetAtTime(cutoff, state.audioCtx.currentTime, 0.1);
  const vol = Math.max(0, 1 - d * 1.2) * 0.3;
  state.gainNode.gain.setTargetAtTime(vol, state.audioCtx.currentTime, 0.1);
}

function stopAudio() {
  if (state.gainNode) state.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.1);
}

// Bell chime sound — synthesized
function playBellChime() {
  const ctx = state.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (!state.audioCtx) state.audioCtx = ctx;
  if (ctx.state === 'suspended') ctx.resume();

  // Two sine tones for a bell-like timbre
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sine';
  osc1.frequency.value = 830; // high bell tone
  osc2.type = 'sine';
  osc2.frequency.value = 1245; // harmonic

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2); // ring decay

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 1.2);
  osc2.stop(now + 1.2);
}

// Floating music notes
let noteInterval = null;
function startFloatingNotes() {
  const container = document.getElementById('floating-notes');
  if (!container) return;
  const notes = ['♪', '♫', '♬', '🎵', '🎶'];
  noteInterval = setInterval(() => {
    const note = document.createElement('div');
    note.className = 'note-float';
    note.textContent = notes[Math.floor(Math.random() * notes.length)];
    const source = document.getElementById('sound-source');
    if (!source) return;
    const sr = source.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    note.style.left = (sr.left - cr.left + sr.width / 2 + (Math.random() - 0.5) * 60) + 'px';
    note.style.top = (sr.top - cr.top) + 'px';
    container.appendChild(note);
    setTimeout(() => note.remove(), 3000);
  }, 600);
}
function stopFloatingNotes() {
  if (noteInterval) { clearInterval(noteInterval); noteInterval = null; }
}

// ============================================================
// VISUAL EFFECTS
// ============================================================
function setVisualFromDistance(d) {
  const bg = document.getElementById('visual-bg');
  if (!bg) return;

  // Overall scene: saturation + brightness shift
  const sat = 0.3 + (1 - d) * 1.4;
  const bright = 0.4 + (1 - d) * 0.8;
  bg.style.filter = `saturate(${sat}) brightness(${bright})`;

  // Background flowers: bloom/wilt based on distance
  const flowers = bg.querySelectorAll('.bg-flower');
  const bloomed = ['🌸', '🌼', '🌺', '🌷', '🌻', '🌹'];
  const wilted = '🌱';
  const proximity = 1 - d; // 1 = very close, 0 = far away

  flowers.forEach((f, i) => {
    // Flowers bloom progressively as child gets closer
    const threshold = (i + 1) / (flowers.length + 1);
    if (proximity > threshold) {
      f.textContent = bloomed[i % bloomed.length];
      f.style.opacity = 0.5 + proximity * 0.5;
      f.style.transform = `scale(${0.8 + proximity * 0.4})`;
    } else {
      f.textContent = wilted;
      f.style.opacity = 0.25;
      f.style.transform = 'scale(0.7)';
    }
  });
}

// ============================================================
// SPATIAL EFFECTS
// ============================================================
let heartInterval = null;

function setSpatialFromDistance(d) {
  const dogAvatar = document.querySelector('.dog-avatar');
  const npcReaction = document.getElementById('npc-reaction');
  const tongue = document.querySelector('.dog-tongue');
  if (!dogAvatar || !npcReaction) return;

  if (d < 0.25) {
    dogAvatar.classList.add('excited');
    npcReaction.textContent = '❤️ Hi friend!';
    npcReaction.classList.add('visible');
    if (tongue) tongue.classList.remove('hidden');
    startHearts();
  } else if (d < 0.45) {
    dogAvatar.classList.remove('excited');
    npcReaction.textContent = '👋 Hello!';
    npcReaction.classList.add('visible');
    if (tongue) tongue.classList.add('hidden');
    stopHearts();
  } else if (d < 0.65) {
    dogAvatar.classList.remove('excited');
    npcReaction.textContent = '👀';
    npcReaction.classList.add('visible');
    if (tongue) tongue.classList.add('hidden');
    stopHearts();
  } else {
    dogAvatar.classList.remove('excited');
    npcReaction.classList.remove('visible');
    if (tongue) tongue.classList.add('hidden');
    stopHearts();
  }
}

function startHearts() {
  if (heartInterval) return;
  const container = document.getElementById('heart-particles');
  heartInterval = setInterval(() => {
    const h = document.createElement('div');
    h.className = 'heart-pop';
    h.textContent = ['❤️', '💕', '💖'][Math.floor(Math.random() * 3)];
    h.style.setProperty('--hx', (Math.random() - 0.5) * 60 + 'px');
    container.appendChild(h);
    setTimeout(() => h.remove(), 1500);
  }, 400);
}
function stopHearts() {
  if (heartInterval) { clearInterval(heartInterval); heartInterval = null; }
}

// ============================================================
// TEMPORAL — visible traveling light orb
// ============================================================
let temporalLoopTimeout = null;
let temporalRunning = false;
let currentTemporalDelay = 2000;

function setTemporalFromDistance(d) {
  currentTemporalDelay = 300 + d * 2500;
  if (!temporalRunning) startTemporalLoop();
}

function startTemporalLoop() {
  temporalRunning = true;
  fireTemporalPulse();
}

function fireTemporalPulse() {
  if (!temporalRunning) return;

  const orb = document.getElementById('light-orb');
  const avatar = document.getElementById('avatar-temporal');
  const target = document.getElementById('temporal-target');
  const container = document.getElementById('container-temporal');
  if (!orb || !avatar || !target || !container) return;

  const cRect = container.getBoundingClientRect();
  const aRect = avatar.getBoundingClientRect();
  const tRect = target.getBoundingClientRect();

  // Start position: near the cat
  const startX = aRect.left - cRect.left + aRect.width / 2 - 12;
  const startY = aRect.top - cRect.top + aRect.height / 2 - 12;
  // End position: at the bell
  const endX = tRect.left - cRect.left + tRect.width / 2 - 12;
  const endY = tRect.top - cRect.top + tRect.height / 2 - 12;

  // Position orb at start
  orb.style.transition = 'none';
  orb.style.left = startX + 'px';
  orb.style.top = startY + 'px';
  orb.classList.add('traveling');

  // Drop trail particles along the path
  const trailCount = 8;
  const delay = currentTemporalDelay;

  for (let i = 1; i <= trailCount; i++) {
    setTimeout(() => {
      if (!temporalRunning) return;
      const frac = i / trailCount;
      const tx = startX + (endX - startX) * frac;
      const ty = startY + (endY - startY) * frac;
      const trail = document.createElement('div');
      trail.className = 'light-orb-trail';
      trail.style.left = tx + 'px';
      trail.style.top = ty + 'px';
      const bg = container.querySelector('.scene-bg');
      if (bg) bg.appendChild(trail);
      setTimeout(() => trail.remove(), 800);
    }, (delay / trailCount) * i);
  }

  // Animate orb traveling
  requestAnimationFrame(() => {
    orb.style.transition = `left ${delay}ms ease-in-out, top ${delay}ms ease-in-out`;
    orb.style.left = endX + 'px';
    orb.style.top = endY + 'px';
  });

  // Bell reacts when orb arrives
  setTimeout(() => {
    if (!temporalRunning) return;
    const bell = document.querySelector('.bell-body');
    const glow = document.querySelector('.bell-glow');
    if (bell) {
      bell.classList.add('ringing');
      setTimeout(() => bell.classList.remove('ringing'), 400);
    }
    if (glow) {
      glow.style.opacity = '1';
      setTimeout(() => glow.style.opacity = '0', 600);
    }
    // Burst nearby stars when bell is hit
    const stars = document.querySelectorAll('.star');
    stars.forEach(s => {
      s.style.opacity = '1';
      s.style.transform = 'scale(2.5)';
      setTimeout(() => { s.style.opacity = ''; s.style.transform = ''; }, 500);
    });
    orb.classList.remove('traveling');

    // Schedule next pulse
    temporalLoopTimeout = setTimeout(fireTemporalPulse, 1200);
  }, delay);
}

function stopTemporalPulse() {
  temporalRunning = false;
  if (temporalLoopTimeout) { clearTimeout(temporalLoopTimeout); temporalLoopTimeout = null; }
  const orb = document.getElementById('light-orb');
  if (orb) orb.classList.remove('traveling');
}

// ============================================================
// DISTANCE COMPUTATION
// ============================================================
function getTargetElement(scene) {
  return {
    auditory: document.getElementById('sound-source'),
    visual: document.getElementById('visual-target'),
    spatial: document.getElementById('npc-character'),
    temporal: document.getElementById('temporal-target'),
  }[scene];
}

function computeNormalizedDistance(avatarEl, targetEl, containerEl) {
  const a = avatarEl.getBoundingClientRect();
  const t = targetEl.getBoundingClientRect();
  const c = containerEl.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const tx = t.left + t.width / 2, ty = t.top + t.height / 2;
  const dist = Math.hypot(ax - tx, ay - ty);
  const maxDist = Math.hypot(c.width, c.height) * 0.6;
  return Math.min(1, dist / maxDist);
}

// ============================================================
// SCENE FEEDBACK DISPATCH
// ============================================================
function updateSceneFeedback(scene, d) {
  // Update cat expression based on comfort
  const catAvatar = document.querySelector(`#avatar-${scene} .cat-avatar`);
  if (catAvatar) {
    catAvatar.classList.toggle('happy', d < 0.4);
    catAvatar.classList.toggle('squint', d > 0.7);
  }

  switch (scene) {
    case 'auditory':
      setAudioFromDistance(d);
      const rings = document.querySelectorAll('.ring');
      rings.forEach(r => { r.style.borderColor = `rgba(147,130,255,${0.1 + (1 - d) * 0.6})`; });
      break;
    case 'visual':
      setVisualFromDistance(d);
      break;
    case 'spatial':
      setSpatialFromDistance(d);
      break;
    case 'temporal':
      setTemporalFromDistance(d);
      break;
  }
}

// ============================================================
// HOLD DETECTION & RING
// ============================================================
const STILL_THRESHOLD = 15;

function checkStill(x, y) {
  const dx = x - state.lastPos.x;
  const dy = y - state.lastPos.y;
  if (Math.hypot(dx, dy) > STILL_THRESHOLD) {
    state.stillStart = null;
    hideHoldOverlay();
    updateHoldRing(0);
    state.lastPos = { x, y };
    return;
  }
  if (!state.stillStart) {
    state.stillStart = Date.now();
    showHoldOverlay();
  }
  const pct = (Date.now() - state.stillStart) / HOLD_DURATION;
  updateHoldProgress(pct);
  updateHoldRing(pct);
  if (pct >= 1 && !state.confirmed) confirmPreference();
}

function updateHoldRing(pct) {
  const scene = SCENES[state.currentScene];
  if (!scene) return;
  const svg = document.getElementById(`hold-ring-${scene}`);
  if (!svg) return;
  const fill = svg.querySelector('.ring-fill');
  if (!fill) return;
  const offset = RING_CIRCUMFERENCE * (1 - Math.min(1, pct));
  fill.style.strokeDashoffset = offset;
}

function showHoldOverlay() { document.getElementById('hold-overlay').classList.remove('hidden'); }
function hideHoldOverlay() {
  document.getElementById('hold-overlay').classList.add('hidden');
  document.getElementById('hold-progress-fill').style.width = '0%';
}
function updateHoldProgress(pct) {
  document.getElementById('hold-progress-fill').style.width = Math.min(100, pct * 100) + '%';
}

// ============================================================
// CELEBRATION — confetti
// ============================================================
function celebrate() {
  const cel = document.getElementById('celebration');
  cel.classList.remove('hidden');

  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const confetti = [];
  const colors = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b59b6','#ff9ff3','#feca57'];
  for (let i = 0; i < 80; i++) {
    confetti.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 100,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 15 - 5,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      alpha: 1,
    });
  }

  let frame = 0;
  function drawConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    confetti.forEach(c => {
      c.x += c.vx;
      c.vy += 0.4; // gravity
      c.y += c.vy;
      c.rotation += c.rotSpeed;
      c.alpha -= 0.008;
      if (c.alpha <= 0) return;
      alive = true;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rotation * Math.PI / 180);
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
      ctx.restore();
    });
    frame++;
    if (alive && frame < 120) requestAnimationFrame(drawConfetti);
    else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cel.classList.add('hidden');
    }
  }
  drawConfetti();
}

// ============================================================
// PAW TRAIL
// ============================================================
function dropPaw(x, y, containerEl) {
  state.pawCounter++;
  if (state.pawCounter % 6 !== 0) return; // every 6th move
  const paw = document.createElement('div');
  paw.className = 'paw-print';
  paw.textContent = '🐾';
  const cRect = containerEl.getBoundingClientRect();
  paw.style.left = (x - cRect.left) + 'px';
  paw.style.top = (y - cRect.top) + 'px';
  containerEl.appendChild(paw);
  setTimeout(() => paw.remove(), 2000);
}

// ============================================================
// CONFIRM PREFERENCE
// ============================================================
function confirmPreference() {
  state.confirmed = true;
  hideHoldOverlay();

  const scene = SCENES[state.currentScene];
  const avatarEl = document.getElementById(`avatar-${scene}`);
  const targetEl = getTargetElement(scene);
  const containerEl = document.querySelector(`#screen-${scene} .scene-container`);
  const d = computeNormalizedDistance(avatarEl, targetEl, containerEl);

  const result = {
    scene,
    normalizedDistance: d,
    timestamp: Date.now(),
    log: [...state.interactionLog],
  };

  switch (scene) {
    case 'auditory':
      result.parameter = 'frequencyCutoff';
      result.value = 200 + (1 - d) * 3800;
      result.label = d < 0.3 ? 'High tolerance' : d < 0.6 ? 'Medium tolerance' : 'Low tolerance';
      break;
    case 'visual':
      result.parameter = 'saturationLevel';
      result.value = d;
      result.label = d < 0.3 ? 'Vivid preference' : d < 0.6 ? 'Balanced' : 'Muted preference';
      break;
    case 'spatial':
      result.parameter = 'comfortableDistance';
      result.value = d;
      result.label = d < 0.3 ? 'Close comfort' : d < 0.6 ? 'Medium distance' : 'Prefers space';
      break;
    case 'temporal':
      result.parameter = 'bufferLatency';
      result.value = 300 + d * 2500;
      result.label = d < 0.3 ? 'Quick pace' : d < 0.6 ? 'Moderate pace' : 'Slow pace';
      break;
  }
  state.results[scene] = result;

  // Ring confirm animation
  const svg = document.getElementById(`hold-ring-${scene}`);
  if (svg) svg.classList.add('confirmed');

  // Celebration
  celebrate();

  // Cleanup
  if (scene === 'auditory') { stopAudio(); stopFloatingNotes(); }
  if (scene === 'spatial') stopHearts();
  if (scene === 'temporal') stopTemporalPulse();

  setTimeout(nextScene, 1500);
}

// ============================================================
// NAVIGATION
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  screen.classList.add('active', 'fade-in');
}

function nextScene() {
  state.currentScene++;
  state.confirmed = false;
  state.stillStart = null;
  state.interactionLog = [];
  state.pawCounter = 0;
  hideHoldOverlay();

  if (state.currentScene >= SCENES.length) {
    showResults();
    spawnParticles(SCENE_PARTICLES.results);
    return;
  }

  const scene = SCENES[state.currentScene];
  showScreen(`screen-${scene}`);
  spawnParticles(SCENE_PARTICLES[scene]);

  // Reset hold ring
  const svg = document.getElementById(`hold-ring-${scene}`);
  if (svg) {
    svg.classList.remove('confirmed');
    const fill = svg.querySelector('.ring-fill');
    if (fill) fill.style.strokeDashoffset = RING_CIRCUMFERENCE;
  }

  // Position avatar
  const avatarEl = document.getElementById(`avatar-${scene}`);
  const container = document.querySelector(`#screen-${scene} .scene-container`);
  const rect = container.getBoundingClientRect();
  avatarEl.style.left = `${rect.width / 2 - 45}px`;
  avatarEl.style.top = `${rect.height * 0.72}px`;

  // Scene-specific init
  if (scene === 'auditory') {
    initAudio();
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    state.gainNode.gain.setTargetAtTime(0.15, state.audioCtx.currentTime, 0.1);
    startFloatingNotes();
  }
  if (scene === 'temporal') {
    createStars();
    setTemporalFromDistance(0.7);
  }
}

function showResults() {
  showScreen('screen-results');
  const grid = document.getElementById('results-grid');
  const dataDiv = document.getElementById('results-data');
  grid.innerHTML = '';

  const icons = { auditory: '🎵', visual: '🌈', spatial: '🐶', temporal: '🔔' };
  const labels = { auditory: 'Sound', visual: 'Brightness', spatial: 'Proximity', temporal: 'Pace' };

  SCENES.forEach(scene => {
    const r = state.results[scene];
    if (!r) return;
    const barPct = (1 - r.normalizedDistance) * 100;
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="result-card-icon">${icons[scene]}</div>
      <div class="result-card-label">${labels[scene]}</div>
      <div class="result-card-value">${r.label}</div>
      <div class="result-bar"><div class="result-bar-fill" style="width:${barPct}%"></div></div>
    `;
    grid.appendChild(card);
  });

  const exportData = {
    sessionId: `SENSE_${Date.now()}`,
    timestamp: new Date().toISOString(),
    results: Object.fromEntries(
      Object.entries(state.results).map(([k, v]) => [k, {
        parameter: v.parameter, value: v.value, normalizedDistance: v.normalizedDistance, label: v.label,
      }])
    ),
  };
  dataDiv.innerHTML = `<pre>${JSON.stringify(exportData, null, 2)}</pre>`;
}

// ============================================================
// DRAG HANDLING
// ============================================================
function getEventPos(e) {
  if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function onDragStart(e) {
  if (state.confirmed) return;
  const avatar = e.target.closest('.avatar');
  if (!avatar) return;
  e.preventDefault();

  state.isDragging = true;
  state.dragAvatar = avatar;
  avatar.classList.add('dragging');

  const pos = getEventPos(e);
  const rect = avatar.getBoundingClientRect();
  state.dragOffset.x = pos.x - rect.left;
  state.dragOffset.y = pos.y - rect.top;
  state.lastPos = { x: pos.x, y: pos.y };
  state.stillStart = null;

  const scene = SCENES[state.currentScene];
  const hint = document.getElementById(`hint-${scene}`);
  if (hint) hint.classList.add('fade-out');
}

function onDragMove(e) {
  if (!state.isDragging || !state.dragAvatar || state.confirmed) return;
  e.preventDefault();

  const pos = getEventPos(e);
  const scene = SCENES[state.currentScene];
  const container = document.querySelector(`#screen-${scene} .scene-container`);
  const cRect = container.getBoundingClientRect();

  let newX = pos.x - cRect.left - state.dragOffset.x;
  let newY = pos.y - cRect.top - state.dragOffset.y;
  newX = Math.max(0, Math.min(newX, cRect.width - 90));
  newY = Math.max(0, Math.min(newY, cRect.height - 90));

  state.dragAvatar.style.left = `${newX}px`;
  state.dragAvatar.style.top = `${newY}px`;

  // Paw trail
  dropPaw(pos.x, pos.y, container);

  // Distance + feedback
  const targetEl = getTargetElement(scene);
  if (targetEl) {
    const d = computeNormalizedDistance(state.dragAvatar, targetEl, container);
    updateSceneFeedback(scene, d);
    state.interactionLog.push({ t: Date.now(), x: newX, y: newY, dist: d });
  }

  checkStill(pos.x, pos.y);
}

function onDragEnd() {
  if (!state.isDragging || !state.dragAvatar) return;
  state.dragAvatar.classList.remove('dragging');
  state.isDragging = false;
  state.dragAvatar = null;
  state.stillStart = null;
  hideHoldOverlay();
  updateHoldRing(0);
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-start').addEventListener('click', nextScene);

  document.getElementById('btn-restart').addEventListener('click', () => {
    state.currentScene = -1;
    state.results = {};
    state.confirmed = false;
    state.interactionLog = [];
    spawnParticles(SCENE_PARTICLES.welcome);
    showScreen('screen-welcome');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const data = {
      sessionId: `SENSE_${Date.now()}`,
      timestamp: new Date().toISOString(),
      results: state.results,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sense_results_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Touch
  document.addEventListener('touchstart', onDragStart, { passive: false });
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend', onDragEnd);
  // Mouse
  document.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
});

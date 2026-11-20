// OrbPet 光球：物理、互動、番茄鐘、碎片與繪製
// 座標系：螢幕全域座標（DIP，y 向下）。視窗覆蓋整個螢幕，只移動畫的位置，不移動視窗。
'use strict';

// ======================== 參數（可依喜好調整） ========================
const Cfg = {
  orbDiameter: 92,          // 光球直徑
  windowSize: 280,          // 光球繪製範圍（含光暈與形變）
  collisionScale: 0.42,     // 碰撞半徑 = 直徑 × 此值
  gravity: 2400,
  floorRestitution: 0.55,
  wallRestitution: 0.7,
  airDrag: 0.35,
  floatDrag: 1.2,
  groundFriction: 3.5,
  maxSpeed: 5000,
  dragStiffness: 240,       // 拖拽跟隨：越小越慢、越有拖曳感
  dragDampingRatio: 0.8,    // 越接近 1 越少過衝
  throwScale: 1.0,          // 放開時保留多少速度
  dragStretchMax: 0.42,
  dragStretchSpeed: 1800,
  flyStretchMax: 0.18,
  coreLead: 0.16,
  trailMinSpeed: 1500,      // 非拖拽時，速度超過此值才灑碎片
  spinFactor: 0.3,
  maxSpin: 3,
  breathPeriod: 5.5,
  breathAmplitude: 0.06,
};

const Behave = {
  gazeRange: 380,
  idleAfter: 15,
  sleepAfter: 90,
  wakeDistance: 160,
  dizzySpeed: 2000,
  dizzyDuration: 2.6,
  focusMinutes: 25,
  breakMinutes: 5,
  dotGather: 0.5,           // 小亮點往滑鼠方向聚集的程度
  dotSize: 0.9,             // 小亮點大小倍數
  dotBright: 1.1,           // 小亮點亮度倍數
  innerArcPeriod: 9,
  brandText: 'J.A.R.V.I.S.',
  brandFontSize: 8.5,
  timerFontSize: 20,
  celebrateSeconds: 6,
};

const D = Cfg.orbDiameter;
const S = D * 1.1;            // 圖案貼圖大小
const RPT = S * 0.44;         // 內核半徑（貼圖座標）
const TAU = Math.PI * 2;
const rand = (a, b) => a + (b - a) * Math.random();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const api = window.orbpet;

// ======================== 狀態 ========================
// 兩張畫布：fx 覆蓋全螢幕畫碎片（沒碎片時不重畫）；orb 只有光球大小，靠 CSS 位移跟著光球走
const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');
const orbCanvas = document.getElementById('orb');
const octx = orbCanvas.getContext('2d');
const OC = 320; // 光球畫布大小（DIP）
let dpr = window.devicePixelRatio || 1;
let win = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
let work = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

let settings = { theme: 'orange', clipboardReact: true, gravity: true };
let themeName = 'orange';
let art = null; // 在 prepareArt 定義後設定
let theme = OrbArt.THEMES.orange;

const pos = { x: 0, y: 0 };
const vel = { x: 0, y: 0 };
let placed = false;
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let grounded = false;
let hidden = false;

let sqX = 1, sqY = 1, sqVX = 0, sqVY = 0;
let spin = 0, spinVel = 0, midSpin = 0, coreSpin = 0, arcSpin = 0;
let hover = 0, motion = 0, stretchAmt = 0, breathPhase = 0;
const dirVec = { x: 1, y: 0 };

let now = performance.now() / 1000;
let lastTime = now;
let cursor = { x: -9999, y: -9999 };
let lastCursor = { x: -9999, y: -9999 };
const gaze = { x: 0, y: 0 };
let rubEnergy = 0, happy = 0;
let dizzyUntil = 0;
let lastInteraction = now;
let nextIdleAction = 0;
let idleLook = { x: 0, y: 0 }, idleLookUntil = 0;
let asleep = false, sleepAmt = 0;
let cpu = 0, heat = 0;
let battery = null;

let pomoEnd = null, pomoDuration = 1, pomoIsBreak = false;
let alarmUntil = 0, nextAlarmHop = 0, hopSide = 1, firstCelebrateHop = false;
let apexBurstCount = 0, apexBurstAt = 0;
let clipFlashAt = 0, clipPulse = 0;

const radius = () => D * Cfg.collisionScale;

// 512px 的原圖先縮到實際顯示大小，每幀貼圖比較省
function shrink(img) {
  // 縮到螢幕實際需要的大小（1× 螢幕約 120px、Retina 約 240px），每次最多縮一半，細線才不會糊掉
  const target = Math.ceil(S * (window.devicePixelRatio || 1) * 1.2);
  let src = img;
  while (src.width / 2 > target) {
    const half = document.createElement('canvas');
    half.width = half.height = Math.ceil(src.width / 2);
    const h = half.getContext('2d');
    h.imageSmoothingQuality = 'high';
    h.drawImage(src, 0, 0, half.width, half.height);
    src = half;
  }
  const c = document.createElement('canvas');
  c.width = c.height = target;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, target, target);
  return c;
}
const preparedCache = new Map();
function prepareArt(a) {
  if (preparedCache.has(a)) return preparedCache.get(a);
  const p = {
    ...a,
    shell: shrink(a.shell), mid: a.mid && shrink(a.mid),
    coreGlow: shrink(a.coreGlow), coreBase: shrink(a.coreBase), coreSpinner: a.coreSpinner && shrink(a.coreSpinner),
    arms: a.arms.map((arm) => ({ ...arm, image: shrink(arm.image) })),
  };
  preparedCache.set(a, p);
  return p;
}
art = prepareArt(OrbArt.getArt('orange'));

// 每顆內核小亮點的隨機個性
let dotStates = [];
function buildDotStates() {
  dotStates = art.dots.map((d) => ({
    ...d,
    pull: rand(0.3, 1.8), skew: rand(-0.6, 0.6), speed: rand(2, 9),
    f1: rand(0.4, 1.3), f2: rand(0.4, 1.3), ph1: rand(0, TAU), ph2: rand(0, TAU),
    ox: 0, oy: 0,
  }));
}
buildDotStates();

// ======================== 視窗 / 螢幕 ========================
function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(win.width * dpr);
  canvas.height = Math.round(win.height * dpr);
  canvas.style.width = `${win.width}px`;
  canvas.style.height = `${win.height}px`;
  orbCanvas.width = orbCanvas.height = Math.round(OC * dpr);
  orbCanvas.style.width = orbCanvas.style.height = `${OC}px`;
  prevBox = null;
  fxDirty = true;
}

api.on('display', (d) => {
  win = d.bounds;
  work = d.workArea;
  resizeCanvas();
  if (!placed) {
    placed = true;
    pos.x = work.x + work.width * 0.8;
    pos.y = work.y + radius();
  }
});
window.addEventListener('resize', () => { win.width = window.innerWidth; win.height = window.innerHeight; resizeCanvas(); });

api.on('settings', (s) => {
  settings = s;
  if (s.theme !== themeName) setTheme(s.theme, true);
  if (!s.gravity) grounded = false;
});

function setTheme(name, playful) {
  if (!OrbArt.THEMES[name]) return;
  const changed = themeName !== name;
  themeName = name;
  theme = OrbArt.THEMES[name];
  art = prepareArt(OrbArt.getArt(name));
  buildDotStates();
  lastTimerText = '';
  if (changed && playful && placed) { hop(500); queueApexBurst(18); }
}

api.on('cursor', (p) => { cursor = p; });
api.on('cpu', (v) => { cpu = v; });
api.on('clipboard', () => { if (settings.clipboardReact && !hidden) onClipboard(); });
api.on('hidden', (h) => {
  hidden = h;
  if (!h) { lastInteraction = now; lastTime = performance.now() / 1000; hop(500); }
});
api.on('action', (type) => {
  noteInteraction();
  if (type === 'startFocus') startPomodoro(Behave.focusMinutes, false);
  else if (type === 'startBreak') startPomodoro(Behave.breakMinutes, true);
  else if (type === 'stopPomodoro') { pomoEnd = null; alarmUntil = 0; }
  else if (type.startsWith('debugPomo:')) startPomodoro(Number(type.split(':')[1]) / 60, false);
  else if (type === 'recenter') {
    pos.x = work.x + work.width / 2; pos.y = work.y + work.height / 2;
    vel.x = vel.y = 0; grounded = false;
  }
});

if (navigator.getBattery) navigator.getBattery().then((b) => { battery = b; }).catch(() => {});
const lowBattery = () => battery && !battery.charging && battery.level <= 0.2;

// ======================== 滑鼠 ========================
const toGlobal = (e) => ({ x: e.clientX + win.x, y: e.clientY + win.y });
const DOUBLE_CLICK_TIME = 0.35; // 兩次按下的間隔小於此秒數算雙擊
let lastDown = { t: 0, x: 0, y: 0 };

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  cursor = toGlobal(e);
  noteInteraction();
  if (pomoEnd !== null) { sqVX += 1.2; sqVY -= 1.2; return; } // 番茄鐘計時中：鎖定
  // 雙擊：自己計時判斷（pointer 事件的 e.detail 在 Chromium 永遠是 0，不能用）
  const t = performance.now() / 1000;
  const isDouble = t - lastDown.t < DOUBLE_CLICK_TIME && Math.hypot(cursor.x - lastDown.x, cursor.y - lastDown.y) < 8;
  lastDown = isDouble ? { t: 0, x: 0, y: 0 } : { t, x: cursor.x, y: cursor.y };
  if (isDouble) { endDrag(); poke(); return; }
  dragging = true;
  grounded = false;
  dragOffset = { x: pos.x - cursor.x, y: pos.y - cursor.y };
  e.target.setPointerCapture(e.pointerId);
  document.body.style.cursor = 'grabbing';
});
window.addEventListener('pointermove', (e) => { if (dragging) cursor = toGlobal(e); });
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  vel.x *= Cfg.throwScale; vel.y *= Cfg.throwScale;
  document.body.style.cursor = '';
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('lostpointercapture', endDrag);
window.addEventListener('contextmenu', (e) => { e.preventDefault(); noteInteraction(); api.send('menu'); });

function poke() {
  sqVX -= 4; sqVY += 4;
  if (settings.gravity) { vel.y -= 900; grounded = false; }
  spinVel += rand(-2.5, 2.5);
}

function hop(strength = 700) {
  if (settings.gravity && grounded) {
    vel.y = -strength; vel.x += rand(-120, 120); grounded = false;
    sqVY -= 2.5; sqVX += 2.5;
  } else {
    sqVY += 3; sqVX -= 3;
    vel.y -= strength * 0.3;
  }
}

function noteInteraction() {
  lastInteraction = now;
  if (asleep) { asleep = false; hop(650); queueApexBurst(14); }
}

// 跳起來後，到最高點才爆碎片
function queueApexBurst(count) { apexBurstCount = count; apexBurstAt = now; }
function checkApexBurst() {
  if (apexBurstCount <= 0) return;
  const rising = settings.gravity ? vel.y < 0 : vel.y < -40;
  if ((!rising && now - apexBurstAt > 0.08) || now - apexBurstAt > 0.6) {
    burst(pos.x, pos.y, apexBurstCount);
    apexBurstCount = 0;
  }
}

// ======================== 番茄鐘 ========================
function startPomodoro(minutes, isBreak) {
  pomoDuration = minutes * 60;
  pomoEnd = now + pomoDuration;
  pomoIsBreak = isBreak;
  alarmUntil = 0;
  hop(500);
}

function chime() {
  try {
    const ac = new AudioContext();
    [[880, 0], [1320, 0.12]].forEach(([f, t0]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ac.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + 0.9);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + 1);
    });
    setTimeout(() => ac.close(), 1500);
  } catch { /* 沒有音效裝置就略過 */ }
}

function checkPomodoroEnd() {
  if (pomoEnd !== null && now >= pomoEnd) {
    pomoEnd = null;
    alarmUntil = now + Behave.celebrateSeconds;
    nextAlarmHop = now;
    firstCelebrateHop = true;
    chime();
    if (hidden) api.send('requestShow'); // 隱藏時也要出來慶祝
  }
}

function updateCelebration() {
  if (now >= alarmUntil) return;
  lastInteraction = now;
  asleep = false;
  rubEnergy = 4;
  if (now >= nextAlarmHop) {
    nextAlarmHop = now + 0.55;
    hopSide = -hopSide;
    if (settings.gravity && grounded) {
      vel.y = -rand(700, 900);
      vel.x = hopSide * rand(180, 280);
      grounded = false;
      sqVY -= 3; sqVX += 3;
    } else {
      vel.x += hopSide * 200; vel.y -= 300;
      sqVY += 3; sqVX -= 3;
    }
    spinVel += hopSide * 3;
    queueApexBurst(firstCelebrateHop ? 34 : 14);
    firstCelebrateHop = false;
  }
}

// ======================== 剪貼簿 ========================
function onClipboard() {
  absorb(pos.x, pos.y, 18);
  clipFlashAt = now + 0.52;
}
function updateClipboardFlash(dt) {
  if (clipFlashAt > 0 && now >= clipFlashAt) {
    clipFlashAt = 0;
    clipPulse = 1;
    sqVX -= 3.2; sqVY -= 3.2; // 吞下去：先縮一下再彈回
  }
  clipPulse *= Math.exp(-2.2 * dt);
}

// ======================== 碎片 ========================
const particles = [];

function spawnFragment(x, y, spread, speed) {
  const shard = Math.random() < 0.8 / 1.8;
  const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * spread;
  const v = shard ? rand(0, speed * 1.7) : rand(0, speed * 2);
  const dir = rand(0, TAU);
  particles.push({
    kind: shard ? 'shard' : 'spark',
    x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr,
    vx: Math.cos(dir) * v, vy: Math.sin(dir) * v,
    age: 0, life: shard ? rand(0.7, 1.3) : rand(0.6, 1.2),
    size: shard ? 32 * rand(0.38, 0.98) : 24 * rand(0.18, 0.42),
    sizeSpeed: shard ? -0.3 * 32 : -0.2 * 24,
    alpha: 1, alphaSpeed: shard ? -0.85 : -0.9,
    rot: rand(0, TAU), spin: shard ? rand(-4, 4) : 0,
  });
}

let trailCarry = 0;
function emitTrail(rate, dt) {
  trailCarry += rate * 1.8 * dt;
  while (trailCarry >= 1) { trailCarry -= 1; spawnFragment(pos.x, pos.y, D * 0.275, 30); }
}

function burst(x, y, count) {
  for (let i = 0; i < count; i++) spawnFragment(x, y, 10, 170);
}

function absorb(x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU), dist = D * rand(0.9, 1.6);
    const shard = Math.random() < 0.5;
    particles.push({
      kind: 'absorb', img: shard ? 'shard' : 'spark',
      fx: x + Math.cos(a) * dist, fy: y + Math.sin(a) * dist, tx: x, ty: y,
      age: 0, life: rand(0.42, 0.58), size: shard ? rand(18, 26) : rand(10, 14), rot: a,
    });
  }
}

let moteCarry = 0;
function emitMotes(dt) {
  if (sleepAmt <= 0.6) return;
  moteCarry += 1.4 * dt;
  while (moteCarry >= 1) {
    moteCarry -= 1;
    const ang = -Math.PI / 2 + rand(-0.35, 0.35), v = rand(9, 19);
    particles.push({
      kind: 'spark', x: pos.x + rand(-D * 0.25, D * 0.25), y: pos.y - D * 0.3,
      vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
      age: 0, life: rand(2.2, 3.8), size: 24 * rand(0.14, 0.3), sizeSpeed: -0.04 * 24,
      alpha: rand(0.7, 1), alphaSpeed: -0.32, rot: 0, spin: 0,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    if (p.kind === 'absorb') continue;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.size = Math.max(0, p.size + p.sizeSpeed * dt);
    p.alpha += p.alphaSpeed * dt;
    p.rot += p.spin * dt;
    if (p.alpha <= 0 || p.size <= 0) particles.splice(i, 1);
  }
}

// ======================== 物理 ========================
function integrateFree(dt) {
  const b = { minX: work.x, maxX: work.x + work.width, minY: work.y, maxY: work.y + work.height };
  const r = radius();
  if (settings.gravity && !grounded) vel.y += Cfg.gravity * dt;
  if (!settings.gravity) vel.y += 60 * sleepAmt * dt; // 漂浮模式睡著會慢慢往下沉
  const drag = settings.gravity ? Cfg.airDrag : Cfg.floatDrag;
  vel.x *= Math.exp(-drag * dt);
  vel.y *= Math.exp(-drag * dt);
  if (grounded) vel.x *= Math.exp(-Cfg.groundFriction * dt);
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;

  if (pos.x - r < b.minX) {
    pos.x = b.minX + r;
    if (vel.x < 0) { impact(-vel.x, true, b.minX, pos.y); vel.x = -vel.x * Cfg.wallRestitution; }
  } else if (pos.x + r > b.maxX) {
    pos.x = b.maxX - r;
    if (vel.x > 0) { impact(vel.x, true, b.maxX, pos.y); vel.x = -vel.x * Cfg.wallRestitution; }
  }
  if (pos.y - r < b.minY) {
    pos.y = b.minY + r;
    if (vel.y < 0) { impact(-vel.y, false, pos.x, b.minY); vel.y = -vel.y * Cfg.wallRestitution; }
  }
  if (pos.y + r > b.maxY) {
    pos.y = b.maxY - r;
    if (vel.y > 0) {
      impact(vel.y, false, pos.x, b.maxY);
      vel.y = -vel.y * (settings.gravity ? Cfg.floorRestitution : Cfg.wallRestitution);
      if (settings.gravity && vel.y > -90) { vel.y = 0; grounded = true; }
    }
  }
  if (grounded && pos.y + r < b.maxY - 1) grounded = false;

  if (grounded) spinVel += (-vel.x / r * Cfg.spinFactor - spinVel) * Math.min(1, 10 * dt);
  else spinVel *= Math.exp(-0.6 * dt);
}

function impact(speed, horizontal, cx, cy) {
  if (speed <= 60) return;
  const imp = Math.min(speed / 3800, 0.4) * 12;
  if (horizontal) { sqVX -= imp; sqVY += imp * 0.8; } else { sqVY -= imp; sqVX += imp * 0.8; }
  if (speed > Behave.dizzySpeed) {
    dizzyUntil = now + Behave.dizzyDuration;
    burst(cx, cy, Math.round(Math.min(40, speed / 80)));
  } else if (speed > 300) {
    burst(cx, cy, Math.round(Math.min(9, 2 + speed / 300)));
  }
}

function updateSquash(dt) {
  const k = 380, c = 13, h = dt / 2;
  for (let i = 0; i < 2; i++) {
    sqVX += (-k * (sqX - 1) - c * sqVX) * h;
    sqVY += (-k * (sqY - 1) - c * sqVY) * h;
    sqX += sqVX * h; sqY += sqVY * h;
  }
  sqX = clamp(sqX, 0.6, 1.4); sqY = clamp(sqY, 0.6, 1.4);

  const sp = Math.hypot(vel.x, vel.y);
  let target;
  if (dragging) target = Cfg.dragStretchMax * Math.min(1, sp / Cfg.dragStretchSpeed);
  else if (grounded) target = 0;
  else target = Math.min(sp / 9000, Cfg.flyStretchMax);
  stretchAmt += (target - stretchAmt) * Math.min(1, 14 * dt);

  if (sp > 20) {
    const w = Math.min(1, 16 * dt);
    dirVec.x += (vel.x / sp - dirVec.x) * w;
    dirVec.y += (vel.y / sp - dirVec.y) * w;
    const l = Math.hypot(dirVec.x, dirVec.y);
    if (l > 0.001) { dirVec.x /= l; dirVec.y /= l; }
  }
}

// ======================== 情緒：看滑鼠、撫摸、閒置、睡覺 ========================
function updateMood(dt) {
  const dx = cursor.x - pos.x, dy = cursor.y - pos.y;
  const dm = Math.hypot(dx, dy);
  const inside = dm <= D * 0.5;
  hover += ((inside || dragging ? 1 : 0) - hover) * Math.min(1, 8 * dt);
  if (dm < Behave.wakeDistance) noteInteraction();

  if (inside && !dragging) rubEnergy += Math.hypot(cursor.x - lastCursor.x, cursor.y - lastCursor.y) / D * 0.5;
  rubEnergy = Math.min(4, rubEnergy * Math.exp(-1.2 * dt));
  const happyTarget = clamp((rubEnergy - 0.6) / 1.2, 0, 1);
  happy += (happyTarget - happy) * Math.min(1, (happyTarget > happy ? 4 : 1.2) * dt);

  const timing = pomoEnd !== null; // 計時中保持安靜：不睡、不自己東張西望
  const idle = now - lastInteraction;
  if (!asleep && !timing && idle > Behave.sleepAfter && alarmUntil < now) asleep = true;
  sleepAmt += ((asleep ? 1 : 0) - sleepAmt) * Math.min(1, (asleep ? 0.6 : 3) * dt);
  if (!asleep && !timing && !dragging && idle > Behave.idleAfter && now > nextIdleAction && now > dizzyUntil) {
    nextIdleAction = now + rand(6, 14);
    const a = rand(0, TAU);
    idleLook = { x: Math.cos(a) * D * 0.11, y: Math.sin(a) * D * 0.11 }; // 只東張西望，不移動
    idleLookUntil = now + rand(1.2, 2.6);
  }

  let g = now < idleLookUntil && !timing ? idleLook : { x: 0, y: 0 };
  if (!dragging && dm > D * 0.5 && dm < Behave.gazeRange && sleepAmt < 0.5) {
    const k = D * 0.11 * Math.min(1, (Behave.gazeRange - dm) / 150);
    g = { x: dx / dm * k, y: dy / dm * k };
  }
  if (sleepAmt > 0.5) g = { x: 0, y: 0 };
  gaze.x += (g.x - gaze.x) * Math.min(1, 6 * dt);
  gaze.y += (g.y - gaze.y) * Math.min(1, 6 * dt);
}

// ======================== 主迴圈 ========================
function tick() {
  now = performance.now() / 1000;
  const dt = Math.min(now - lastTime, 1 / 30);
  lastTime = now;
  if (!placed || hidden || dt <= 0) return;

  if (dragging) {
    noteInteraction();
    const tx = cursor.x + dragOffset.x, ty = cursor.y + dragOffset.y;
    const k = Cfg.dragStiffness, c = 2 * Math.sqrt(k) * Cfg.dragDampingRatio;
    vel.x += (k * (tx - pos.x) - c * vel.x) * dt;
    vel.y += (k * (ty - pos.y) - c * vel.y) * dt;
    pos.x += vel.x * dt; pos.y += vel.y * dt;
    spinVel += (-vel.x / radius() * Cfg.spinFactor * 0.4 - spinVel) * Math.min(1, 3 * dt);
  } else {
    integrateFree(dt);
  }
  spinVel = clamp(spinVel, -Cfg.maxSpin, Cfg.maxSpin);
  const sp = Math.hypot(vel.x, vel.y);
  if (sp > Cfg.maxSpeed) { vel.x *= Cfg.maxSpeed / sp; vel.y *= Cfg.maxSpeed / sp; }

  heat += (clamp((cpu - 0.5) / 0.4, 0, 1) - heat) * Math.min(1, 0.6 * dt); // CPU 超過 50% 才開始變紅

  updateSquash(dt);
  updateMood(dt);
  updateCelebration();
  checkApexBurst();
  updateClipboardFlash(dt);

  const speed = Math.hypot(vel.x, vel.y);
  let rate = (dragging && speed > 40) || speed > Cfg.trailMinSpeed ? Math.min(speed / 18, 180) : 0;
  if (happy > 0.4) rate += happy * 10; // 被摸得開心時冒碎片
  emitTrail(rate, dt);
  emitMotes(dt);
  updateParticles(dt);

  if (Math.abs(pos.x - sentOrb.x) > 0.5 || Math.abs(pos.y - sentOrb.y) > 0.5 || dragging !== sentOrb.dragging) {
    sentOrb = { x: pos.x, y: pos.y, dragging };
    api.send('orb', { x: pos.x, y: pos.y, r: D * 0.5, dragging });
  }
  render(dt);
  lastCursor = { ...cursor };
}

// 平靜時（沒在動、沒碎片、沒特效）降低更新率，省電
const CALM_FPS = 20; // 平靜時的畫面更新率
let lastFrame = 0;
function calm() {
  return !dragging && Math.hypot(vel.x, vel.y) < 5 && particles.length === 0 && clipPulse < 0.01
    && now > dizzyUntil && now > alarmUntil && happy < 0.01 && apexBurstCount === 0;
}
let sentOrb = { x: -1e9, y: -1e9, dragging: false };
function frame(t) {
  const ts = t / 1000;
  if (!calm() || ts - lastFrame >= 1 / CALM_FPS - 0.002) { lastFrame = ts; tick(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 低頻：番茄鐘（隱藏時畫面不更新也要計時）＋ 回報選單用的狀態
setInterval(() => {
  now = performance.now() / 1000;
  checkPomodoroEnd();
  api.send('state', {
    pomo: pomoEnd !== null ? { remain: pomoEnd - now, isBreak: pomoIsBreak } : null,
    cpu,
    battery: battery ? { level: battery.level, charging: battery.charging } : null,
  });
}, 250);

// ======================== 繪製 ========================
function breath(phase) {
  const p = phase % 1;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  if (p < 0.4) return ease(p / 0.4);
  if (p < 0.9) return 1 - ease((p - 0.4) / 0.5);
  return 0;
}

const fmt = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

let prevBox = null;
let fxDirty = true;
let lastTimerText = '';
let timerPaths = null;

function render(dt) {
  // 呼吸節奏：CPU 忙、開心時變快；睡覺、低電量時變慢
  let period = Cfg.breathPeriod / (1 + 1.2 * heat + 1.5 * happy);
  period *= 1 + 0.8 * sleepAmt;
  if (lowBattery()) period *= 1.3;
  breathPhase += dt / period;
  const b = breath(breathPhase);
  const amp = Cfg.breathAmplitude * (1 - 0.5 * happy);
  const breathScale = 1 - amp + 2 * amp * b + hover * 0.03 + happy * 0.04 + clipPulse * 0.06;

  // 形變矩陣 = R(θ)·diag(1+e, 1/(1+e))·R(-θ) · diag(sx, sy)
  const e = stretchAmt, co = dirVec.x, si = dirVec.y;
  const A = 1 + e, B = 1 / (1 + e);
  const m00 = A * co * co + B * si * si, m01 = (A - B) * co * si, m11 = A * si * si + B * co * co;
  const purr = happy * 0.02 * Math.sin(now * 38);
  const flatY = 1 - 0.08 * sleepAmt, flatX = 1 + 0.05 * sleepAmt;
  const sx = sqX * breathScale * (1 + purr) * flatX;
  const sy = sqY * breathScale * (1 - purr) * flatY;
  let ty = 0;
  if (pos.y + radius() > work.y + work.height - 2) ty = -(sqY * flatY - 1) * D * 0.5; // 落地壓扁時貼著地面

  const lead = e * D * 0.18, coreOff = e * D * Cfg.coreLead, glowOff = -e * D * 0.22;
  const moveTarget = grounded && !dragging ? 0 : Math.min(1, Math.hypot(vel.x, vel.y) / 500);
  motion += (moveTarget - motion) * Math.min(1, 10 * dt);

  const rateScale = 1 - 0.7 * sleepAmt;
  const dizzy = clamp((dizzyUntil - now) / 0.8, 0, 1);
  const rate = (p) => (p ? TAU / p : 0);
  spin += (spinVel + rate(theme.spin.shell) * rateScale) * dt;
  midSpin += (rate(theme.spin.mid) * rateScale - spinVel * 0.3) * dt;
  coreSpin += -dizzy * 14 * dt; // 內核不自轉，只有撞暈時會轉
  arcSpin += rate(Behave.innerArcPeriod) * rateScale * dt;

  const dim = (1 - 0.4 * sleepAmt) * (lowBattery() ? 0.65 : 1);
  const wobX = Math.cos(now * 9) * D * 0.08 * dizzy, wobY = Math.sin(now * 11) * D * 0.08 * dizzy;
  const coreScale = (0.92 + 0.14 * b) * (1 - 0.12 * sleepAmt) * (1 + 0.1 * happy);
  const hasArms = art.arms.length > 0;
  const gz = hasArms ? { x: 0, y: 0 } : gaze;      // 藍色：整個準星偏向滑鼠
  const par = hasArms ? { x: 0, y: 0 } : gaze;     // 橙色：外殼不位移

  const gx0 = pos.x - win.x, gy0 = pos.y - win.y;
  const ox = Math.round(gx0 - OC / 2), oy = Math.round(gy0 - OC / 2);
  orbCanvas.style.transform = `translate(${ox}px, ${oy}px)`;
  const lx = gx0 - ox, ly = gy0 - oy; // 在光球畫布裡的位置
  const ctx = octx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, OC, OC);
  renderOrb(ctx, lx, ly, { dt, b, e, co, si, m00, m01, m11, sx, sy, ty, lead, coreOff, glowOff, dizzy, dim, wobX, wobY, coreScale, hasArms, gz, par });
  renderParticles();
}

function renderParticles() {
  if (particles.length === 0 && !fxDirty) return;
  fxDirty = particles.length > 0;
  let box = null;
  for (const p of particles) {
    const px = (p.kind === 'absorb' ? p.fx : p.x) - win.x, py = (p.kind === 'absorb' ? p.fy : p.y) - win.y;
    const m = 30;
    if (!box) box = { x0: px - m, y0: py - m, x1: px + m, y1: py + m };
    box.x0 = Math.min(box.x0, px - m); box.y0 = Math.min(box.y0, py - m);
    box.x1 = Math.max(box.x1, px + m); box.y1 = Math.max(box.y1, py + m);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!box) box = prevBox || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const clear = prevBox ? {
    x0: Math.min(prevBox.x0, box.x0), y0: Math.min(prevBox.y0, box.y0),
    x1: Math.max(prevBox.x1, box.x1), y1: Math.max(prevBox.y1, box.y1),
  } : { x0: 0, y0: 0, x1: win.width, y1: win.height };
  ctx.clearRect(clear.x0 - 2, clear.y0 - 2, clear.x1 - clear.x0 + 4, clear.y1 - clear.y0 + 4);
  prevBox = particles.length ? box : null;
  drawParticles();
}

function renderOrb(ctx, lx, ly, v) {
  const { dt, b, e, co, si, m00, m01, m11, sx, sy, ty, lead, coreOff, glowOff, dizzy, dim, wobX, wobY, coreScale, hasArms, gz, par } = v;
  // ---- 光球本體 ----
  ctx.save();
  ctx.translate(lx + co * lead, ly + ty + si * lead);
  ctx.transform(m00 * sx, m01 * sx, m01 * sy, m11 * sy, 0, 0);

  // 光暈
  const glowAlpha = clamp((0.45 + 0.45 * b + 0.25 * hover + 0.45 * happy) * (1 - 0.9 * motion) * (1 - 0.5 * sleepAmt) + 0.8 * clipPulse, 0, 1.6);
  if (glowAlpha > 0.01) {
    const gx = co * glowOff, gy = si * glowOff, gr = D * 0.95;
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    for (const [o, c] of theme.glowStops) grad.addColorStop(o, c);
    ctx.globalAlpha = Math.min(1, glowAlpha) * dim;
    ctx.fillStyle = grad;
    ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    if (glowAlpha > 1) { ctx.globalAlpha = (glowAlpha - 1) * dim; ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2); }
  }

  const drawImg = (img, ox, oy, rot, alpha) => {
    ctx.save();
    ctx.translate(ox, oy);
    if (rot) ctx.rotate(rot);
    ctx.globalAlpha = alpha * dim;
    ctx.drawImage(img, -S / 2, -S / 2, S, S);
    ctx.restore();
  };
  drawImg(art.shell, par.x * 0.35, par.y * 0.35, spin, 0.85 + 0.15 * b);
  if (art.mid) drawImg(art.mid, par.x * 0.65, par.y * 0.65, midSpin, 0.85 + 0.15 * b);

  if (heat > 0.01) {
    const hr = D * 0.51;
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, hr);
    hg.addColorStop(0, 'rgba(242,38,13,0.85)'); hg.addColorStop(0.7, 'rgba(230,26,13,0.55)'); hg.addColorStop(1, 'rgba(230,26,13,0)');
    ctx.globalAlpha = heat * 0.4 * dim;
    ctx.fillStyle = hg;
    ctx.fillRect(-hr, -hr, hr * 2, hr * 2);
  }

  // 內核
  const coreAlpha = Math.min(1, 0.75 + 0.25 * b + 0.2 * e + 0.2 * happy + 0.4 * clipPulse);
  ctx.save();
  ctx.translate(co * coreOff + gz.x + wobX, si * coreOff + gz.y + wobY);
  ctx.rotate(coreSpin);
  ctx.scale(coreScale, coreScale);
  // 藍色：光暈抵銷準星的偏移，固定在中間
  let cgx = 0, cgy = 0;
  if (!hasArms) {
    const cr = Math.cos(-coreSpin), sr = Math.sin(-coreSpin);
    cgx = -(gz.x * cr - gz.y * sr) / coreScale;
    cgy = -(gz.x * sr + gz.y * cr) / coreScale;
  }
  drawImg(art.coreGlow, cgx, cgy, 0, coreAlpha);
  drawImg(art.coreBase, 0, 0, 0, coreAlpha);
  if (art.coreSpinner) drawImg(art.coreSpinner, 0, 0, arcSpin, coreAlpha);
  for (const arm of art.arms) drawImg(arm.image, 0, 0, 0, coreAlpha);

  // 小亮點：各自隨機地往滑鼠方向聚集
  if (dotStates.length) {
    const reach = Math.min(1, Math.hypot(gaze.x, gaze.y) / (D * 0.11));
    const gl = Math.atan2(gaze.y, gaze.x) - coreSpin;
    const gv = { x: Math.cos(gl) * reach, y: Math.sin(gl) * reach };
    ctx.fillStyle = 'rgb(255,238,180)';
    ctx.shadowColor = 'rgba(255,170,60,0.9)'; // 小光暈，讓亮點在小尺寸下也看得到
    ctx.shadowBlur = 2;
    for (const dl of dotStates) {
      const r = Math.hypot(dl.x, dl.y);
      const cs = Math.cos(dl.skew), sn = Math.sin(dl.skew);
      const k = r * Behave.dotGather * dl.pull;
      const tx = (gv.x * cs - gv.y * sn) * k, tyy = (gv.x * sn + gv.y * cs) * k;
      const w = Math.min(1, dl.speed * dt);
      dl.ox += (tx - dl.ox) * w; dl.oy += (tyy - dl.oy) * w;
      let qx = dl.x + dl.ox + Math.sin(now * dl.f1 + dl.ph1) * 0.018;
      let qy = dl.y + dl.oy + Math.cos(now * dl.f2 + dl.ph2) * 0.018;
      const qr = Math.hypot(qx, qy);
      if (qr > 0.98) { qx *= 0.98 / qr; qy *= 0.98 / qr; } // 聚集時不跑出光球
      const px = qx * RPT, py = qy * RPT;
      let gain = 1;
      if (reach > 0.001) {
        const align = Math.max(0, (dl.x * gv.x + dl.y * gv.y) / (Math.max(r, 0.0001) * reach));
        gain = (0.2 + 0.8 * (align * reach + (1 - reach) * 0.6)) / 0.68; // 朝滑鼠那側更亮、背側更暗
      }
      ctx.globalAlpha = Math.min(1, dl.alpha * gain * Behave.dotBright) * dim;
      const sz = Math.max(1.4, dl.size * Behave.dotSize);
      ctx.beginPath(); ctx.arc(px, py, sz / 2, 0, TAU); ctx.fill();
    }
  }
  ctx.restore(); // 內核
  ctx.restore(); // 本體

  // ---- 中央文字：倒計時 / J.A.R.V.I.S.（不跟滑鼠、不跟呼吸）----
  ctx.save();
  ctx.translate(lx + co * lead, ly + ty + si * lead);
  if (pomoEnd !== null) {
    const text = fmt(pomoEnd - now);
    const h = Behave.timerFontSize * 0.95;
    if (text !== lastTimerText) { lastTimerText = text; timerPaths = OrbArt.segmentPaths(text, h); }
    ctx.globalAlpha = 1 - 0.6 * sleepAmt;
    ctx.translate(-timerPaths.width / 2, h / 2);
    ctx.scale(1, -1);
    ctx.fillStyle = theme.timerColor;
    ctx.save(); ctx.globalAlpha *= 0.12; ctx.fill(timerPaths.all); ctx.restore();
    ctx.shadowColor = theme.accent; ctx.shadowBlur = 5;
    ctx.fill(timerPaths.lit);
  } else if (themeName === 'blue') {
    ctx.globalAlpha = 0.95 - 0.4 * sleepAmt;
    ctx.font = `600 ${Behave.brandFontSize}px -apple-system, "Segoe UI", system-ui, sans-serif`;
    ctx.letterSpacing = `${(Behave.brandFontSize * 0.12).toFixed(2)}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgb(26,140,255)'; ctx.shadowBlur = 5;
    ctx.fillStyle = 'rgb(217,247,255)';
    ctx.fillText(Behave.brandText, 0, 0);
  }
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    if (p.kind === 'absorb') {
      const t = p.age / p.life;
      const ease = t * t; // easeIn
      const x = p.fx + (p.tx - p.fx) * ease - win.x, y = p.fy + (p.ty - p.fy) * ease - win.y;
      const op = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
      const sz = p.size * (1 - 0.55 * t);
      ctx.save();
      ctx.globalAlpha = op;
      ctx.translate(x, y); ctx.rotate(p.rot);
      ctx.drawImage(p.img === 'shard' ? art.shard : art.spark, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = clamp(p.alpha, 0, 1);
      ctx.translate(p.x - win.x, p.y - win.y);
      if (p.rot) ctx.rotate(p.rot);
      ctx.drawImage(p.kind === 'shard' ? art.shard : art.spark, -p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }
}

// 光球圖案：啟動時用程式畫進離屏畫布，之後每幀只做貼圖與變形
// 隨機數產生器與 Swift 版相同（同樣的種子 → 同樣的圖案）
'use strict';

const LINE_WEIGHT = 1.7;   // 線條粗細倍數
const DOT_SPREAD = 0.9;    // 內核小亮點分佈範圍（內核半徑的比例）
const BRIGHT_ARM = { width: 0.62, alpha: 0.85 }; // 亮光絲相對原本的粗細與亮度（1 = Swift 版）
const GLOW_BLUR = 11;      // 內核光絲的光暈模糊量（小一點：光暈輕、外圈淡）

class RNG {
  constructor(seed) { this.s = BigInt.asUintN(64, BigInt(seed)); }
  next() {
    this.s = BigInt.asUintN(64, this.s * 6364136223846793005n + 1442695040888963407n);
    return Number(this.s >> 11n) / 9007199254740992; // 2^53
  }
  r(a, b) { return a + (b - a) * this.next(); }
}

function mk(n) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  ctx.globalCompositeOperation = 'lighter'; // 疊加發光
  ctx.lineCap = 'round';
  return { c, ctx };
}

const rgba = (r, g, b, a) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
const orbColor = (t, a) => rgba(1, 0.42 + 0.4 * t, 0.04 + 0.22 * t * t, a);
// t 越大越亮。紅、綠分量壓低一點，亮的地方才是飽和的藍，不會發白
const blueColor = (t, a) => rgba(0.04 + 0.42 * t * t, 0.36 + 0.44 * t, 1, a);

function radial(ctx, cx, cy, radius, stops) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function stroke(ctx, col, w) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w * LINE_WEIGHT;
  ctx.stroke();
}

// ---------------- 橙色光球 ----------------

function drawShell(n = 512, midAlpha = 0.68) {
  const { c, ctx } = mk(n);
  const rng = new RNG(20261119);
  const C = n / 2, R = n * 0.44;

  radial(ctx, C, C, R * 1.02, [[0, orbColor(0.2, 0)], [0.6, orbColor(0.1, 0.1)], [0.93, orbColor(0, 0.22)], [1, orbColor(0, 0)]]);

  const sphere = (count, radius, alphaScale, tone = 1) => {
    for (let i = 0; i < count; i++) {
      const z = rng.r(-1, 1), phi = rng.r(0, 2 * Math.PI);
      const rr = Math.sqrt(1 - z * z);
      const x = rr * Math.cos(phi), y = rr * Math.sin(phi);
      const rim = Math.pow(rr, 4);
      const front = z > 0 ? 1 : 0.5;
      const alpha = (0.06 + 0.75 * rim * rng.r(0.3, 1)) * front * alphaScale;
      const ang = Math.atan2(y, x) + Math.PI / 2 + rng.r(-0.6, 0.6);
      const len = rng.r(2, 11) * (0.4 + rim);
      const px = C + x * radius, py = C + y * radius;
      const col = orbColor(Math.pow(rng.next(), 2) * tone, alpha);
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(ang) * len / 2, py - Math.sin(ang) * len / 2);
      ctx.lineTo(px + Math.cos(ang) * len / 2, py + Math.sin(ang) * len / 2);
      stroke(ctx, col, rng.r(0.8, 2.6));
    }
  };
  sphere(2600, R, 1);
  sphere(900, R * 0.56, midAlpha, 0.7); // 中圈：比外圈淡，色調稍深

  // 徑向光絲
  for (let i = 0; i < 170; i++) {
    const a = rng.r(0, 2 * Math.PI), r0 = R * rng.r(0.3, 0.85), l = R * rng.r(0.04, 0.22);
    const col = orbColor(rng.next(), rng.r(0.04, 0.22));
    ctx.beginPath();
    ctx.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
    ctx.lineTo(C + Math.cos(a) * (r0 + l), C + Math.sin(a) * (r0 + l));
    stroke(ctx, col, rng.r(0.6, 1.6));
  }

  // 傾斜光環弧線
  for (let i = 0; i < 4; i++) {
    const rot = rng.r(0, Math.PI), sy = rng.r(0.22, 0.6);
    const start = rng.r(0, 2 * Math.PI);
    const rad = R * rng.r(0.62, 0.97), end = start + rng.r(1.4, 4.2);
    ctx.save();
    ctx.translate(C, C); ctx.rotate(rot); ctx.scale(1, sy);
    ctx.beginPath();
    ctx.arc(0, 0, rad, start, end);
    ctx.restore(); // 路徑已變形，線寬不受縮放影響
    const col = orbColor(0.8, rng.r(0.35, 0.65));
    const w = rng.r(1.2, 2.4);
    ctx.setLineDash([rng.r(6, 20), rng.r(2, 8)]);
    stroke(ctx, col, w);
  }
  ctx.setLineDash([]);

  // 邊緣亮片
  for (let i = 0; i < 80; i++) {
    const a = rng.r(0, 2 * Math.PI), rad = R * rng.r(0.92, 1.0);
    ctx.beginPath();
    ctx.arc(C, C, rad, a, a + rng.r(0.03, 0.22));
    stroke(ctx, orbColor(rng.r(0.4, 1), rng.r(0.35, 0.9)), rng.r(1.2, 3.2));
  }
  return c;
}

/** 內核拆層：glow（亮核光暈）、base（短弧與細環）、arms（每條光絲各一張）、dots（小亮點資料）
 *  與 Swift 版相同的演算法與種子：9 條光絲各佔一個扇區，角度、長度、彎曲、粗細各自隨機 */
function drawCoreParts(n = 512) {
  const { c: base, ctx } = mk(n);
  const { c: glowC, ctx: gctx } = mk(n);
  const C = n / 2, R = n * 0.44;

  radial(gctx, C, C, R * 0.5, [[0, rgba(1, 0.97, 0.85, 1)], [0.18, rgba(1, 0.78, 0.3, 0.65)],
    [0.5, rgba(1, 0.5, 0.08, 0.18)], [1, rgba(1, 0.4, 0, 0)]]);

  const rng = new RNG(2026);
  const glow = rgba(1, 0.55, 0.1, 0.9);
  // Swift 版的座標 y 向上，這裡上下翻轉，圖案才會和 Swift 版一模一樣
  const p = (r, a) => [C + Math.cos(a) * r, C - Math.sin(a) * r];
  const arms = [];
  for (let i = 0; i < 9; i++) {
    const { c: ac, ctx: actx } = mk(n);
    actx.shadowColor = glow; actx.shadowBlur = GLOW_BLUR;
    const sector = 2 * Math.PI / 9;
    const a0 = i * sector + rng.r(-0.35, 0.35) * sector;
    const bright = rng.next() < 0.45;
    const span = rng.r(0.9, 2.1) * (rng.next() < 0.8 ? 1 : -1);
    const r0 = R * rng.r(0.04, 0.12), r1 = R * rng.r(0.22, 0.4);
    const to = p(r1, a0 + span);
    const c1 = p(R * rng.r(0.15, 0.32), a0 + span * rng.r(0.2, 0.4));
    const c2 = p(R * rng.r(0.22, 0.42), a0 + span * rng.r(0.6, 0.8));
    actx.beginPath();
    actx.moveTo(...p(r0, a0));
    actx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], to[0], to[1]);
    // 亂數呼叫順序不變（排列與 Swift 版相同），只縮小亮絲和暗絲的差距，看起來比較平均
    const alpha = bright ? rng.r(0.8, 0.95) * BRIGHT_ARM.alpha : rng.r(0.5, 0.75);
    actx.strokeStyle = bright ? rgba(1, 0.86, 0.48, alpha) : rgba(1, 0.76, 0.3, alpha);
    actx.lineWidth = LINE_WEIGHT * (bright ? rng.r(2.2, 3.4) * BRIGHT_ARM.width : rng.r(1, 2));
    actx.stroke();
    arms.push({ image: ac, angle: -(a0 + span * 0.6) });
  }

  ctx.shadowColor = glow; ctx.shadowBlur = GLOW_BLUR;
  for (let i = 0; i < 6; i++) {
    const a0 = i / 6 * 2 * Math.PI + rng.r(-0.4, 0.4);
    const r = R * rng.r(0.18, 0.36), span = rng.r(0.25, 0.6);
    ctx.beginPath();
    ctx.arc(C, C, r, -a0 - span, -a0); // 翻轉後的同一段弧
    stroke(ctx, rgba(1, 0.85, 0.45, rng.r(0.35, 0.65)), rng.r(0.8, 1.4));
  }
  ctx.shadowColor = rgba(1, 0.55, 0.1, 0.6); ctx.shadowBlur = GLOW_BLUR * 0.4;
  ctx.setLineDash([4, 5, 10, 4, 2, 7, 14, 6]);
  ctx.beginPath();
  ctx.arc(C, C, R * 0.44, 0, 2 * Math.PI);
  stroke(ctx, rgba(1, 0.8, 0.4, 0.45), 1.2);
  ctx.setLineDash([]);

  const golden = Math.PI * (3 - Math.sqrt(5));
  const dots = [];
  for (let i = 0; i < 42; i++) {
    const rr = DOT_SPREAD * Math.pow((i + rng.r(0.1, 0.9)) / 42, 0.4); // 次方 < 0.5 → 比較少擠在中間
    const a = i * golden + rng.r(-0.3, 0.3);
    const near = 1 - rr / DOT_SPREAD;
    dots.push({ x: Math.cos(a) * rr, y: -Math.sin(a) * rr, size: 1.4 + 1.6 * near, alpha: 0.5 + 0.4 * near });
  }
  return { base, glow: glowC, arms, dots };
}

// ---------------- 藍色光環 ----------------

function drawBlueShell(n = 512, outerArcs = true) {
  const { c, ctx } = mk(n);
  const rng = new RNG(77);
  const C = n / 2, R = n * 0.44;
  radial(ctx, C, C, R * 1.02, [[0, blueColor(0.3, 0)], [0.6, blueColor(0.2, 0.06)], [0.95, blueColor(0.1, 0.2)], [1, blueColor(0, 0)]]);

  const ring = (r, w, col, dash = []) => {
    ctx.setLineDash(dash);
    ctx.beginPath(); ctx.arc(C, C, r, 0, 2 * Math.PI);
    stroke(ctx, col, w);
    ctx.setLineDash([]);
  };
  const arc = (r, a0, span, w, col) => {
    ctx.beginPath(); ctx.arc(C, C, r, a0, a0 + span);
    stroke(ctx, col, w);
  };
  ring(R, 1.2, blueColor(0.6, 0.55));
  ring(R * 0.84, 1.4, blueColor(0.5, 0.5), [3, 6]);

  ctx.lineCap = 'butt';
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * 2 * Math.PI, long = i % 5 === 0;
    const r0 = R * (long ? 0.87 : 0.9), r1 = R * 0.94;
    ctx.beginPath();
    ctx.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
    ctx.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
    stroke(ctx, blueColor(long ? 0.8 : 0.5, long ? 0.75 : 0.4), long ? 1.6 : 1);
  }
  ctx.lineCap = 'round';

  ctx.shadowColor = blueColor(0.6, 0.9); ctx.shadowBlur = 12;
  for (let i = 0; i < 3; i++) {
    const a0 = rng.r(0, 2 * Math.PI), span = rng.r(0.35, 0.9); // 不畫也要取亂數，後面的圖案才不會變
    if (outerArcs) arc(R * 0.975, a0, span, 4, blueColor(0.85, 0.95));
  }
  for (let i = 0; i < 4; i++) arc(R * 0.8, rng.r(0, 2 * Math.PI), rng.r(0.15, 0.45), 2.5, blueColor(0.7, 0.8));
  return c;
}

function drawBlueMid(n = 512) {
  const { c, ctx } = mk(n);
  const rng = new RNG(909);
  const C = n / 2, R = n * 0.44;

  ctx.lineCap = 'butt';
  for (let i = 0; i < 48; i++) {
    const a0 = i / 48 * 2 * Math.PI;
    const lit = rng.next() < 0.45;
    ctx.beginPath();
    ctx.arc(C, C, R * 0.7, a0, a0 + 2 * Math.PI / 48 * 0.7);
    stroke(ctx, blueColor(lit ? 0.75 : 0.3, lit ? 0.85 : 0.25), 6);
  }
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(C, C, R * 0.62, 0, 2 * Math.PI);
  stroke(ctx, blueColor(0.5, 0.4), 1);

  for (let i = 0; i < 72; i++) {
    const a = i / 72 * 2 * Math.PI, s = 2.4 * LINE_WEIGHT;
    ctx.fillStyle = blueColor(0.7, i % 6 === 0 ? 0.9 : 0.4);
    ctx.beginPath();
    ctx.arc(C + Math.cos(a) * R * 0.56, C + Math.sin(a) * R * 0.56, s / 2, 0, 2 * Math.PI);
    ctx.fill();
  }

  ctx.shadowColor = blueColor(0.6, 0.9); ctx.shadowBlur = 10;
  for (let i = 0; i < 3; i++) {
    const a0 = rng.r(0, 2 * Math.PI);
    ctx.beginPath(); ctx.arc(C, C, R * 0.765, a0, a0 + rng.r(0.4, 1.2));
    stroke(ctx, blueColor(0.95, 0.95), 2.5);
  }
  return c;
}

/** 藍色內核拆四層：glow（中心光暈，固定）、inner（最內圈細環，固定）、base（外側細環＋準星）、arcs（粗亮弧，旋轉） */
function drawBlueCoreParts(n = 512) {
  const { c: glowC, ctx: gctx } = mk(n);
  const { c: base, ctx } = mk(n);
  const { c: arcs, ctx: actx } = mk(n);
  const rng = new RNG(31);
  const C = n / 2, R = n * 0.44;

  radial(gctx, C, C, R * 0.48, [[0, rgba(0.92, 0.99, 1, 1)], [0.18, blueColor(0.85, 0.6)], [0.5, blueColor(0.4, 0.18)], [1, blueColor(0, 0)]]);

  // 最內圈單獨一層：目送時它和中心光暈不動，其他層才偏過去
  const { c: inner, ctx: ictx } = mk(n);
  ictx.beginPath(); ictx.arc(C, C, R * 0.3, 0, 2 * Math.PI);
  stroke(ictx, blueColor(0.7, 0.55), 1);
  ctx.beginPath(); ctx.arc(C, C, R * 0.42, 0, 2 * Math.PI);
  stroke(ctx, blueColor(0.7, 0.35), 1);
  actx.shadowColor = blueColor(0.6, 0.9); actx.shadowBlur = 8;
  for (let i = 0; i < 4; i++) {
    const a0 = rng.r(0, 2 * Math.PI);
    const rad = R * rng.r(0.34, 0.38), end = a0 + rng.r(0.5, 1.4);
    actx.beginPath(); actx.arc(C, C, rad, a0, end);
    stroke(actx, blueColor(0.95, 0.9), 2.2);
  }
  ctx.shadowColor = blueColor(0.6, 0.9); ctx.shadowBlur = 8;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(C + Math.cos(a) * R * 0.44, C + Math.sin(a) * R * 0.44);
    ctx.lineTo(C + Math.cos(a) * R * 0.5, C + Math.sin(a) * R * 0.5);
    stroke(ctx, blueColor(0.9, 0.9), 1.6);
  }
  return { glow: glowC, base, arcs, inner };
}

// ---------------- 聖誕帽 ----------------
// 機械風：全部是直線，像 HUD 零件。帽子整頂浮在球外面，帽緣底邊和球之間留一點空隙。
// 畫布是外殼的兩倍大（n = 1024 對應 2S），球心在畫布中央、球半徑和外殼一樣是 0.44 × 512。
const HAT = {
  tilt: 0.6,      // 往右傾斜（弧度）
  gap: 0.07,      // 帽緣底邊離球面的空隙（球半徑的倍數）
  halfW: 0.4,     // 帽緣半寬
  band: 0.15,     // 帽緣高度
  height: 0.78,   // 帽身高度
  pom: 0.08,      // 頂端六角形的半徑
};

function drawHat(color, n = 1024) {
  const { c, ctx } = mk(n);
  const C = n / 2, R = 512 * 0.44;
  const cs = Math.cos(HAT.tilt), sn = Math.sin(HAT.tilt);
  const seat = 1 + HAT.gap; // 帽緣底邊（y = 0）剛好和球相切再往外推一點
  const ox = C + sn * seat * R, oy = C - cs * seat * R;
  // 帽子自己的座標（單位：球半徑，y 往下為正）→ 畫布座標
  const P = (x, y) => [ox + (x * cs - y * sn) * R, oy + (x * sn + y * cs) * R];
  const path = (pts, close) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    if (close) ctx.closePath();
  };
  const line = (pts, t, a, w, close) => { path(pts, close); stroke(ctx, color(t, a), w); };
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';

  const hw = HAT.halfW, bh = HAT.band, top = -bh;
  // 帽身：直的三角形，不折
  const bw = hw * 0.8;
  const BL = [-bw, top], BR = [bw, top], TIP = [0, top - HAT.height];
  const body = [BL, TIP, BR];
  const mid = [0, top - HAT.height * 0.35];

  // 淡底色
  path(body, true);
  ctx.fillStyle = color(0.1, 0.1);
  ctx.fill();
  // 外框：一條亮線 + 一條稍微內縮的暗線（雙線，像面板邊）
  ctx.shadowColor = color(0.6, 0.8);
  ctx.shadowBlur = 5;
  line(body, 0.85, 0.95, 1.3, false);
  ctx.shadowBlur = 0;
  line(body.map((p) => lerp(p, mid, 0.12)), 0.5, 0.4, 0.6, false);
  // 面板分割線：橫切帽身的直線
  for (const t of [0.3, 0.58]) line([lerp(BL, TIP, t), lerp(BR, TIP, t)], 0.6, 0.55, 0.8);
  // 鉚釘
  ctx.fillStyle = color(0.9, 0.85);
  for (const t of [0.15, 0.44, 0.7]) {
    for (const p of [BL, BR]) {
      const [x, y] = lerp(lerp(p, TIP, t), mid, 0.2);
      const [px, py] = P(x, y);
      ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 帽緣：兩條平行硬線，中間一排刻度
  ctx.shadowColor = color(0.6, 0.8);
  ctx.shadowBlur = 5;
  line([[-hw, top], [hw, top], [hw + 0.04, top + bh / 2], [hw, 0], [-hw, 0], [-hw - 0.04, top + bh / 2]], 0.9, 1, 1.4, true);
  ctx.shadowBlur = 0;
  const ticks = 15;
  for (let i = 1; i < ticks; i++) {
    const x = -hw + (2 * hw * i) / ticks, long = i % 5 === 0 ? 0.2 : 0.33;
    line([[x, top + bh * long], [x, -bh * long]], 0.75, i % 5 === 0 ? 0.9 : 0.6, i % 5 === 0 ? 1.1 : 0.7);
  }

  // 頂端：六角形 + 中心亮點，和帽尖用一小段短桿連起來
  const dir = -Math.PI / 2; // 直直往上
  const PC = [TIP[0] + Math.cos(dir) * HAT.pom * 1.5, TIP[1] + Math.sin(dir) * HAT.pom * 1.5];
  line([TIP, lerp(TIP, PC, 0.45)], 0.8, 0.9, 1.1);
  const hex = (r) => Array.from({ length: 6 }, (_, i) => [PC[0] + Math.cos(dir + i * Math.PI / 3) * r, PC[1] + Math.sin(dir + i * Math.PI / 3) * r]);
  ctx.shadowColor = color(0.7, 0.9);
  ctx.shadowBlur = 6;
  line(hex(HAT.pom), 0.95, 1, 1.3, true);
  ctx.shadowBlur = 0;
  line(hex(HAT.pom * 0.55), 0.6, 0.6, 0.7, true);
  const [cx, cy] = P(...PC);
  radial(ctx, cx, cy, HAT.pom * R * 0.5, [[0, color(1, 0.95)], [0.5, color(0.8, 0.4)], [1, color(0.5, 0)]]);
  return c;
}

// ---------------- 番茄鐘齒輪 ----------------
// 球邊齒圈：光球右上那段邊緣是一圈外齒，一個小齒輪咬在上面沿著球邊來回滾。
// 兩者用同樣的齒距和齒高才咬得起來。回傳的 Path2D 單位是 px，中心在原點，每幀旋轉後描邊。
const GEAR_PITCH = 5.6; // 齒距（節圓上相鄰兩齒的距離，px）
const GEAR_DEPTH = 2.6; // 齒高
function makeGear(teeth, spokes) {
  const pitchR = (teeth * GEAR_PITCH) / (Math.PI * 2);
  const ro = pitchR + GEAR_DEPTH / 2, ri = pitchR - GEAR_DEPTH / 2;
  const step = (Math.PI * 2) / teeth;
  const outline = new Path2D();
  for (let i = 0; i < teeth; i++) {
    const a = i * step; // 齒的中心在角度 a
    [[ri, a - step * 0.5], [ri, a - step * 0.3], [ro, a - step * 0.17], [ro, a + step * 0.17], [ri, a + step * 0.3]]
      .forEach(([r, t], j) => (i || j ? outline.lineTo(Math.cos(t) * r, Math.sin(t) * r) : outline.moveTo(Math.cos(t) * r, Math.sin(t) * r)));
  }
  outline.closePath();
  const detail = new Path2D();
  if (spokes) {
    const rim = pitchR * 0.62, hub = Math.max(1.6, pitchR * 0.2);
    detail.moveTo(rim, 0); detail.arc(0, 0, rim, 0, Math.PI * 2);
    detail.moveTo(hub, 0); detail.arc(0, 0, hub, 0, Math.PI * 2);
    for (let i = 0; i < spokes; i++) {
      const t = (i * Math.PI * 2) / spokes, c = Math.cos(t), s = Math.sin(t);
      detail.moveTo(c * hub, s * hub); detail.lineTo(c * rim, s * rim);
    }
  }
  return { outline, detail, teeth, pitchR, ro, ri };
}

/** ringTeeth：齒圈齒數（決定齒圈半徑）；span：齒圈露出的角度範圍 [起, 迄]（弧度，0 = 右、-π/2 = 上） */
function gearArc(ringTeeth = 58, rollerTeeth = 9, span = [-Math.PI / 2 - 0.12, 0.12]) {
  const ring = makeGear(ringTeeth, 0), roller = makeGear(rollerTeeth, 3);
  const T1 = ring.teeth, T2 = roller.teeth;
  return {
    ring, roller, span,
    /** ringAngle：齒圈轉過的角度；at：小齒輪在球邊的位置角。回傳小齒輪中心與它自己的轉角（齒剛好卡進齒圈的齒縫） */
    rollerAt(ringAngle, at) {
      const d = ring.pitchR + roller.pitchR;
      return { x: Math.cos(at) * d, y: Math.sin(at) * d, angle: at + Math.PI + Math.PI / T2 - (ringAngle - at) * (T1 / T2) };
    },
    draw(ctx, ringAngle, at, theme, flash, withRoller = true) {
      const [a0, a1] = span;
      // 齒圈：只露出右上那一段，兩端用扇形裁掉
      ctx.save();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, ring.ro + 4, a0, a1); ctx.closePath(); ctx.clip();
      ctx.rotate(ringAngle);
      ctx.shadowColor = theme.accent; ctx.shadowBlur = 3;
      ctx.strokeStyle = theme.gearColor; ctx.lineWidth = 0.9;
      ctx.stroke(ring.outline);
      ctx.restore();
      // 齒圈內側一條細線當輪轂，兩端各一個小端蓋
      ctx.strokeStyle = theme.gearDim; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(0, 0, ring.ri - 1.6, a0, a1); ctx.stroke();
      for (const a of [a0, a1]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (ring.ri - 3), Math.sin(a) * (ring.ri - 3));
        ctx.lineTo(Math.cos(a) * (ring.ro + 1), Math.sin(a) * (ring.ro + 1));
        ctx.stroke();
      }
      // 小齒輪
      if (!withRoller) return;
      const r = this.rollerAt(ringAngle, at);
      ctx.save();
      ctx.translate(r.x, r.y); ctx.rotate(r.angle);
      ctx.strokeStyle = theme.gearDim; ctx.lineWidth = 0.6;
      ctx.stroke(roller.detail);
      ctx.shadowColor = theme.accent; ctx.shadowBlur = 3 + 4 * flash;
      ctx.strokeStyle = theme.gearColor; ctx.lineWidth = 0.9;
      ctx.stroke(roller.outline);
      ctx.restore();
    },
  };
}

// ---------------- 碎片圖 ----------------

function makeSpark(core, mid, edge, edge0) {
  const n = 24;
  const { c, ctx } = mk(n);
  radial(ctx, n / 2, n / 2, n / 2, [[0, core], [0.3, mid], [0.55, edge], [0.75, edge0], [1, edge0]]);
  return c;
}

function makeShard(outer, inner) {
  const { c, ctx } = mk(32);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath(); ctx.moveTo(10, 16); ctx.lineTo(22, 16);
  ctx.strokeStyle = outer; ctx.lineWidth = 4.5; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(11.5, 16); ctx.lineTo(20.5, 16);
  ctx.strokeStyle = inner; ctx.lineWidth = 1.8; ctx.stroke();
  return c;
}

// ---------------- 主題 ----------------

const THEMES = {
  orange: {
    glowStops: [[0, rgba(1, 0.62, 0.15, 0.28)], [0.45, rgba(1, 0.5, 0.08, 0.07)], [1, rgba(1, 0.45, 0, 0)]], // 光暈輕、往外淡出
    accent: rgba(0.78, 0.3, 0.02, 1),
    timerColor: rgba(1, 0.97, 0.9, 1),
    gearColor: rgba(1, 0.78, 0.4, 1), gearDim: rgba(1, 0.6, 0.2, 0.55), // 番茄鐘齒輪：外框、細節
    coreBoost: 0.6,   // 內核再疊一層的強度：越大越亮，0 = 不加亮
    zColor: rgba(1, 0.9, 0.68, 1),
    spin: { shell: 40, mid: 0 },
    build() {
      const core = drawCoreParts();
      return {
        shell: drawShell(), mid: null,
        shellPlain: drawShell(512, 0.38), // 有終端機工作階段時用：中圈調暗，讓位給分段弧線
        hat: drawHat(orbColor),
        coreGlow: core.glow, coreBase: core.base, coreSpinner: null, arms: core.arms, dots: core.dots,
        spark: makeSpark(rgba(1, 0.97, 0.8, 1), rgba(1, 0.7, 0.15, 1), rgba(0.95, 0.45, 0, 0.85), rgba(0.95, 0.45, 0, 0)),
        shard: makeShard(rgba(0.95, 0.42, 0, 1), rgba(1, 0.93, 0.6, 1)),
      };
    },
  },
  blue: {
    glowStops: [[0, rgba(0.25, 0.7, 1, 0.28)], [0.45, rgba(0.1, 0.5, 1, 0.07)], [1, rgba(0.05, 0.4, 1, 0)]],
    accent: rgba(0.04, 0.36, 0.85, 1),
    timerColor: rgba(0.92, 0.98, 1, 1),
    gearColor: rgba(0.55, 0.85, 1, 1), gearDim: rgba(0.3, 0.65, 1, 0.55),
    coreBoost: 0,
    zColor: rgba(0.85, 0.97, 1, 1),
    spin: { shell: 60, mid: -22 },
    build() {
      const core = drawBlueCoreParts();
      return {
        shell: drawBlueShell(), mid: drawBlueMid(),
        shellPlain: drawBlueShell(512, false), // 有終端機工作階段時用：最外圈三段亮弧換成分段弧線
        hat: drawHat(blueColor),
        coreGlow: core.glow, coreBase: core.base, coreInner: core.inner, coreSpinner: core.arcs, arms: [], dots: [],
        spark: makeSpark(rgba(0.9, 1, 1, 1), rgba(0.35, 0.85, 1, 1), rgba(0.05, 0.4, 0.9, 0.85), rgba(0.05, 0.4, 0.9, 0)),
        shard: makeShard(rgba(0.05, 0.4, 0.88, 1), rgba(0.75, 0.97, 1, 1)),
      };
    },
  },
};

const artCache = {};
function getArt(name) {
  if (!artCache[name]) artCache[name] = THEMES[name].build();
  return artCache[name];
}

// ---------------- 七段數碼管 ----------------

/** 回傳 { lit, all, width }，座標 y 向上、原點在左下（繪製時需翻轉） */
function segmentPaths(text, h) {
  const t = h * 0.18, w = h * 0.58, g = t * 0.18, skew = 0.1;
  const lit = new Path2D(), all = new Path2D();
  const segs = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  const sk = ([x, y]) => [x + y * skew, y];
  const poly = (pts, path) => {
    const q = pts.map(sk);
    path.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) path.lineTo(q[i][0], q[i][1]);
    path.closePath();
  };
  const hSeg = (x0, x1, y) => [[x0, y], [x0 + t / 2, y + t / 2], [x1 - t / 2, y + t / 2], [x1, y], [x1 - t / 2, y - t / 2], [x0 + t / 2, y - t / 2]];
  const vSeg = (xx, y0, y1) => [[xx, y0], [xx + t / 2, y0 + t / 2], [xx + t / 2, y1 - t / 2], [xx, y1], [xx - t / 2, y1 - t / 2], [xx - t / 2, y0 + t / 2]];
  let x = 0;
  for (const ch of text) {
    if (ch === ':') {
      for (const cy of [h * 0.3, h * 0.7]) {
        poly([[x + t * 0.4, cy - t / 2], [x + t * 1.4, cy - t / 2], [x + t * 1.4, cy + t / 2], [x + t * 0.4, cy + t / 2]], lit);
      }
      x += t * 1.8;
      continue;
    }
    const l = x + t / 2, r = x + w - t / 2;
    const shapes = {
      a: hSeg(l + g, r - g, h - t / 2), g: hSeg(l + g, r - g, h / 2), d: hSeg(l + g, r - g, t / 2),
      f: vSeg(l, h / 2 + g, h - t / 2 - g), b: vSeg(r, h / 2 + g, h - t / 2 - g),
      e: vSeg(l, t / 2 + g, h / 2 - g), c: vSeg(r, t / 2 + g, h / 2 - g),
    };
    const on = segs[ch] || '';
    for (const k of Object.keys(shapes)) {
      poly(shapes[k], all);
      if (on.includes(k)) poly(shapes[k], lit);
    }
    x += w + t * 0.9;
  }
  return { lit, all, width: x - t * 0.9 + h * skew };
}

// 帽子當剛體用的資料（單位：球半徑，y 往下為正）
// com：重心相對球心的位置（圖裡的位置，已含傾斜）；hull：外框頂點相對重心（未傾斜）；gyration：迴轉半徑
function hatBody() {
  const hw = HAT.halfW, bh = HAT.band, bw = hw * 0.8, tipY = -bh - HAT.height;
  const pomY = tipY - HAT.pom * 1.5;
  // 各部分以面積當重量：帽緣（矩形）、帽身（三角形）、頂端（六角形）
  const parts = [
    { m: 2 * hw * bh, y: -bh / 2 },
    { m: bw * HAT.height, y: -bh - HAT.height / 3 },
    { m: 2.6 * HAT.pom * HAT.pom, y: pomY },
  ];
  const M = parts.reduce((t, q) => t + q.m, 0);
  const cy = parts.reduce((t, q) => t + q.m * q.y, 0) / M;
  const pts = [
    [-hw, 0], [hw, 0], [hw + 0.04, -bh / 2], [hw, -bh], [bw * 0.45, -bh - HAT.height * 0.55],
    [HAT.pom, pomY], [0, pomY - HAT.pom], [-HAT.pom, pomY],
    [-bw * 0.45, -bh - HAT.height * 0.55], [-hw, -bh], [-hw - 0.04, -bh / 2],
  ];
  const seat = 1 + HAT.gap, cs = Math.cos(HAT.tilt), sn = Math.sin(HAT.tilt);
  return {
    com: { x: sn * seat - cy * sn, y: -cs * seat + cy * cs },
    hull: pts.map(([x, y]) => [x, y - cy]),
    gyration: 0.36,
    tilt: HAT.tilt,
  };
}

window.OrbArt = { getArt, THEMES, segmentPaths, hatBody, gearArc, makeGear };

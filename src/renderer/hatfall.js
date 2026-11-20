// 帽子掉落：簡單的 2D 剛體（重力、旋轉、和地面與左右牆的碰撞、摩擦）
// 帽子用外框的幾個頂點代表；哪個頂點先碰地，就在那一點施加衝量，所以會自然地翻倒、彈跳、停在穩定的那一面。
// 不依賴畫面，Node 也能跑（方便測試）。
'use strict';
(function (root) {
  const SUBSTEPS = 6;
  const RESTITUTION = 0.25; // 彈性：越大彈越高
  const FRICTION = 0.6;     // 和地面的摩擦
  const AIR_SPIN_DAMP = 0.15;

  /**
   * hull：外框頂點（相對重心，單位 px，帽子未旋轉時的座標）；baseAngle：圖本身已經帶的傾斜
   * 回傳的 body.angle 是「額外」旋轉的角度，畫圖時直接 rotate(body.angle)
   */
  function create({ x, y, vx, vy, w, hull, baseAngle, gyration }) {
    return { x, y, vx, vy, w, angle: 0, hull, baseAngle, I: gyration * gyration, still: 0, resting: false };
  }

  function contact(b, px, py, nx, ny, depth) {
    // 接觸點相對重心的向量
    const rx = px - b.x, ry = py - b.y;
    // 接觸點速度 = v + ω × r
    const vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx;
    const vn = vpx * nx + vpy * ny;
    // 位置修正：推出牆外（只推一部分，避免抖動）
    b.x += nx * depth * 0.8; b.y += ny * depth * 0.8;
    if (vn >= 0) return;
    const rn = rx * ny - ry * nx;
    const jn = -(1 + RESTITUTION) * vn / (1 + (rn * rn) / b.I);
    b.vx += jn * nx; b.vy += jn * ny; b.w += (rn * jn) / b.I;
    // 摩擦：切線方向
    const tx = -ny, ty = nx;
    const vt = (b.vx - b.w * ry) * tx + (b.vy + b.w * rx) * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (1 + (rt * rt) / b.I);
    const max = FRICTION * jn;
    jt = Math.max(-max, Math.min(max, jt));
    b.vx += jt * tx; b.vy += jt * ty; b.w += (rt * jt) / b.I;
  }

  /** bounds：{ left, right, floor }（畫面座標，y 往下）；g：重力 px/s² */
  function step(b, dt, bounds, g) {
    if (b.resting) return;
    const h = dt / SUBSTEPS;
    let touching = false;
    for (let s = 0; s < SUBSTEPS; s++) {
      b.vy += g * h;
      b.x += b.vx * h; b.y += b.vy * h;
      b.angle += b.w * h;
      b.w *= 1 - AIR_SPIN_DAMP * h;
      const a = b.angle + b.baseAngle, cs = Math.cos(a), sn = Math.sin(a);
      for (const [hx, hy] of b.hull) {
        const px = b.x + hx * cs - hy * sn, py = b.y + hx * sn + hy * cs;
        if (py > bounds.floor) { contact(b, px, py, 0, -1, py - bounds.floor); touching = true; }
        if (px < bounds.left) contact(b, px, py, 1, 0, bounds.left - px);
        if (px > bounds.right) contact(b, px, py, -1, 0, px - bounds.right);
      }
    }
    // 在地上幾乎不動一小段時間 → 停下
    const slow = Math.abs(b.vx) < 6 && Math.abs(b.vy) < 6 && Math.abs(b.w) < 0.25;
    b.still = touching && slow ? b.still + dt : 0;
    if (b.still > 0.25) { b.resting = true; b.vx = b.vy = b.w = 0; }
  }

  root.HatFall = { create, step };
})(typeof window !== 'undefined' ? window : module.exports);

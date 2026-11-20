// 把兩種主題的光球畫大一點，用來檢查圖案（npm run preview）
'use strict';
const c = document.getElementById('c');
const g = c.getContext('2d');
const SZ = 500;
g.fillStyle = '#0a0807';
g.fillRect(0, 0, c.width, c.height);
['orange', 'blue'].forEach((name, i) => {
  const a = OrbArt.getArt(name);
  const x = 20 + i * (SZ + 20), y = 20;
  const layers = [a.shell, a.mid, a.coreGlow, a.coreBase, a.coreSpinner, ...a.arms.map((m) => m.image)].filter(Boolean);
  for (const img of layers) g.drawImage(img, x, y, SZ, SZ);
  const rpt = SZ * 0.44;
  g.fillStyle = 'rgb(255,230,153)';
  for (const d of a.dots) {
    g.globalAlpha = d.alpha;
    g.beginPath(); g.arc(x + SZ / 2 + d.x * rpt, y + SZ / 2 + d.y * rpt, d.size * 1.2, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
});
document.title = 'ready';

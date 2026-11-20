// 終端機工作階段：在光球上畫分段弧線、顯示懸浮彈窗
// 資料來源：主程序（src/claude.js）收到 Claude Code 的 hooks 事件後，用 'sessions' 訊息把整份清單送過來 → sync()
// 沒有任何工作階段時，光球上什麼都不畫
'use strict';

(function () {
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  // ---------------- 可調參數 ----------------
  const SessCfg = {
    popupSeconds: 8,        // 「完成」「等你指示」的彈窗停留秒數；「請求授權」會留到處理完
    maxPopups: 3,           // 同時最多幾張彈窗
    popupWidth: 236,
    waitPulse: 1.8,         // 等你（指示／授權）：一明一暗一次的秒數
    ringPeriod: 14,         // 整圈弧線順時針轉一圈的秒數；所有段一起轉，彼此間距不變。0 = 不轉
    flashSeconds: 0.7,      // 狀態改變時，那一段閃一下的秒數
  };

  // 每個主題：弧線畫在哪一圈（相對內核半徑 RPT）、段與段的間隙（度）、虛線每節長度（度）、線條粗細倍數 w、整體透明度 alpha、光暈倍數 blur、顏色
  const LOOK = {
    blue: {
      r: 0.975, gap: 10, gapMany: 7, dash: 5, w: 1.35, alpha: 1, blur: 1,
      idle: 'rgba(36,140,255,0.65)', base: 'rgba(36,140,255,0.65)', head: 'rgb(110,196,255)',
      wait: 'rgba(72,170,255,0.95)', done: 'rgb(205,236,255)', glow: 'rgba(40,150,255,0.9)',
    },
    orange: {
      r: 0.56, gap: 16, gapMany: 12, dash: 9, w: 0.75, alpha: 0.6, blur: 0.4, // 橙色：細一點、淡一點，不搶光球本身的戲
      idle: 'rgba(255,138,26,0.65)', base: 'rgba(255,154,46,0.7)', head: 'rgb(255,233,176)',
      wait: 'rgba(255,197,107,0.95)', done: 'rgb(255,246,220)', glow: 'rgba(255,176,32,0.9)',
    },
  };

  // ---------------- 狀態 ----------------
  // state：'work' 工作中｜'ask' 等你指示｜'perm' 請求授權｜'done' 完成未查看｜'idle' 已看過
  let sessions = [];
  let themeName = 'orange';
  let now = 0;
  const popups = [];   // { s, kind, el, hideAt }
  let rect = null;     // 彈窗區塊的螢幕座標，給主程序判斷滑鼠要不要穿透
  let rectKey = '';
  let dirty = false;
  let stackHeight = 0;
  let host = null;

  const api = {
    onNotify: null,    // (kind) => {}：pet.js 用來讓光球跳一下
    active: () => sessions.length > 0,
    setTheme(name) {
      if (!LOOK[name]) return;
      themeName = name;
      if (host) host.dataset.theme = name;
    },
    setState,
    sync,
    update,
    layout,
    draw,
    rects: () => (rect ? [rect] : []),
    consumeDirty() { const d = dirty; dirty = false; return d; },
  };

  // ---------------- 狀態切換 ----------------
  function setState(id, state) {
    const s = sessions.find((x) => x.id === id);
    if (!s || s.state === state) return;
    const used = now - s.since;
    s.state = state;
    s.since = now;
    s.flashAt = now;
    removePopup(s);
    if (state === 'done' || state === 'ask' || state === 'perm') {
      addPopup(s, state, used);
      if (api.onNotify) api.onNotify(state);
    }
  }

  // 點彈窗
  function openTerminal(s) {
    // 請主程序把那個終端機帶到前面。「完成」會被標成已看過；
    // 「等你指示／請求授權」只收起彈窗，弧線等 Claude Code 真的繼續了才會變
    removePopup(s);
    bridge.send('openTerminal', s.id);
  }

  /** 主程序送來整份清單：{ list: [{id,name,where,state,line,since}], silent } */
  function sync(msg) {
    if (!msg || !Array.isArray(msg.list)) return;
    const seen = new Set();
    for (const d of msg.list) {
      seen.add(d.id);
      let s = sessions.find((x) => x.id === d.id);
      const fresh = !s;
      if (!s) {
        s = { id: d.id, state: 'idle', since: now, flashAt: -9 };
        sessions.push(s);
      }
      s.name = d.name; s.where = d.where || ''; s.line = d.line || '';
      if (msg.silent) { if (s.state !== d.state) { removePopup(s); s.state = d.state; s.since = now; } }
      else if (s.state !== d.state) setState(s.id, d.state);
      else if (fresh) s.flashAt = now;
    }
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (!seen.has(sessions[i].id)) { removePopup(sessions[i]); sessions.splice(i, 1); }
    }
  }

  // ---------------- 彈窗 ----------------
  // 彈窗文字（預設英文）
  const STATUS = { done: 'Done', ask: 'Needs input', perm: 'Permission' };
  const TEXT = { took: 'Took', open: 'Open terminal ↗' };
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  function ensureHost() {
    if (host) return host;
    host = document.getElementById('pops');
    if (host) host.dataset.theme = themeName;
    return host;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function addPopup(s, kind, used) {
    if (!ensureHost()) return;
    const b = el('button', 'jp-pop');
    b.type = 'button';
    b.dataset.kind = kind;
    const top = el('span', 'jp-top');
    top.append(el('span', 'jp-name', s.name), el('span', 'jp-status', STATUS[kind]));
    const line = el('span', 'jp-line', s.line || '');
    const foot = el('span', 'jp-foot');
    foot.append(el('span', 'jp-meta', kind === 'done' ? `${TEXT.took} ${mmss(Math.max(1, used))}` : s.where), el('span', 'jp-open', TEXT.open));
    b.append(top, line, foot);
    b.addEventListener('pointerdown', (e) => e.stopPropagation()); // 不要觸發拖拽光球
    b.addEventListener('click', (e) => { e.stopPropagation(); openTerminal(s); });
    popups.push({ s, kind, el: b, hideAt: kind === 'perm' ? Infinity : now + SessCfg.popupSeconds });
    while (popups.length > SessCfg.maxPopups) {
      // 超過上限：先收掉最舊的「非授權」彈窗（弧線狀態還在，不會漏）
      let i = popups.findIndex((p) => p.kind !== 'perm');
      if (i < 0) i = 0;
      popups.splice(i, 1)[0].el.remove();
    }
    reflow();
  }

  function removePopup(s) {
    const i = popups.findIndex((p) => p.s === s);
    if (i < 0) return;
    popups.splice(i, 1)[0].el.remove();
    reflow();
  }

  function clearPopups() {
    for (const p of popups) p.el.remove();
    popups.length = 0;
    reflow();
  }

  // 授權排最上面，其餘新的在下面（靠近光球）
  function reflow() {
    if (!ensureHost()) return;
    const order = [...popups.filter((p) => p.kind === 'perm'), ...popups.filter((p) => p.kind !== 'perm')];
    for (const p of order) host.appendChild(p.el);
    host.style.display = popups.length ? 'flex' : 'none';
    stackHeight = popups.length ? host.offsetHeight : 0;
  }

  // ---------------- 每幀 ----------------
  function update(t) {
    now = t;
    for (let i = popups.length - 1; i >= 0; i--) {
      if (now >= popups[i].hideAt) { popups.splice(i, 1)[0].el.remove(); reflow(); }
    }
  }

  /** 把彈窗擺在光球旁邊（光球在螢幕右半就擺左邊），並算出螢幕座標給主程序 */
  function layout(o) {
    let key = '';
    if (popups.length && ensureHost()) {
      const w = SessCfg.popupWidth, h = stackHeight, pad = 8;
      const onRight = o.pos.x > o.work.x + o.work.width / 2;
      let x = onRight ? o.pos.x - o.D * 0.78 - w : o.pos.x + o.D * 0.78;
      let y = o.pos.y + o.D * 0.3 - h;
      x = Math.max(o.work.x + pad, Math.min(o.work.x + o.work.width - w - pad, x));
      y = Math.max(o.work.y + pad, Math.min(o.work.y + o.work.height - h - pad, y));
      host.style.transform = `translate(${Math.round(x - o.win.x)}px, ${Math.round(y - o.win.y)}px)`;
      rect = { x: Math.round(x), y: Math.round(y), w, h };
      key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    } else {
      rect = null;
    }
    if (key !== rectKey) { rectKey = key; dirty = true; }
  }

  /** 畫在光球本體的座標系裡（原點＝球心），會跟著呼吸與形變；整圈以固定速度順時針轉（不跟外殼的自轉） */
  function draw(ctx, RPT, dim) {
    const n = sessions.length;
    if (!n) return;
    const k = LOOK[themeName];
    const r = RPT * k.r;
    const gap = n === 1 ? 0 : (n <= 6 ? k.gap : k.gapMany) * DEG;
    const per = TAU / n, L = per - gap;
    const rot = SessCfg.ringPeriod ? (now / SessCfg.ringPeriod) * TAU : 0;
    ctx.save();
    const arc = (a0, a1, w, col, alpha, cap, blur) => {
      ctx.globalAlpha = Math.min(1, alpha) * k.alpha * dim;
      ctx.strokeStyle = col; ctx.lineWidth = w * k.w; ctx.lineCap = cap || 'round';
      ctx.shadowColor = k.glow; ctx.shadowBlur = (blur || 0) * k.blur;
      ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    };
    // 每一段都從 a0 畫到 a1、一律平頭，所以不管什麼狀態，各段長度完全一樣
    sessions.forEach((s, i) => {
      const a0 = -Math.PI / 2 + rot + i * per + gap / 2, a1 = a0 + L;
      if (s.state === 'idle') {
        arc(a0, a1, 1.2, k.idle, 1, 'butt');
      } else if (s.state === 'work') {
        arc(a0, a1, 1.5, k.head, 1, 'butt', 3); // 工作中：整段亮線
      } else if (s.state === 'done') {
        arc(a0, a1, 2.3, k.done, 1, 'butt', 4);
      } else { // ask / perm：整段實線，亮度慢慢一明一暗（不切成虛線，圓周上才不會出現細碎的小段）
        const pulse = 0.5 - 0.5 * Math.cos((now / SessCfg.waitPulse) * TAU);
        arc(a0, a1, 1.5, k.wait, 0.3 + 0.7 * pulse, 'butt', 2);
      }
      const f = (now - s.flashAt) / SessCfg.flashSeconds;
      if (f >= 0 && f < 1 && s.state !== 'idle') arc(a0, a1, 4.5, k.done, 0.45 * (1 - f), 'butt', 6);
    });
    ctx.restore();
  }

  // 和主程序的訊息通道（preload.js）；沒有的話（例如預覽工具）就用空的
  const bridge = window.orbpet || { on() {}, send() {} };
  bridge.on('sessions', sync);
  bridge.send('sessionsSync'); // 畫面載入時先要一次目前的清單

  window.Sessions = api;
})();

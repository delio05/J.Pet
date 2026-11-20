// 和終端機裡的 Claude Code 連線（主程序這一側）
//
// 做法：Claude Code 的 hooks 會在「開始工作／需要授權／做完」等時間點執行一個指令。
// OrbPet 啟動時在本機開一個只接受 127.0.0.1 的小伺服器，並在 ~/.claude/settings.json 加上 hooks，
// 讓每個 Claude Code 工作階段把事件 POST 過來。
//
// 設計原則：
// - 電腦沒有裝 Claude Code（沒有 ~/.claude）→ 什麼都不做，OrbPet 照常使用。
// - OrbPet 沒開 → hook 指令發現沒有 port 檔就直接結束，不會拖慢或干擾 Claude Code。
// - 不需要任何系統權限；事件內容只留在本機記憶體，不存檔、不外傳。
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const HOME = os.homedir();
const DATA_DIR = path.join(HOME, '.orbpet');
const PORT_FILE = path.join(DATA_DIR, 'port');          // 內容：「port token」，OrbPet 結束時刪掉
const HOOK_FILE = path.join(DATA_DIR, 'orbpet-hook.sh');
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const BACKUP_FILE = path.join(CLAUDE_DIR, 'settings.json.orbpet-backup');

const BASE_PORT = 47800;
const MARK = 'orbpet-hook.sh'; // 用來認出「這是 OrbPet 加的 hook」
// 外層 shell 的 $PPID 是 Claude Code 本身，用來判斷那個工作階段是否還活著
const HOOK_COMMAND = `ORBPET_PPID=$PPID sh "$HOME/.orbpet/${MARK}" 2>/dev/null; true`;
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];

const HOOK_SCRIPT = `#!/bin/sh
# OrbPet (J.Pet) hook for Claude Code. Installed and updated by OrbPet; safe to delete.
# Forwards the hook event (JSON on stdin) to OrbPet on this machine only.
# If OrbPet is not running there is no port file, and this exits at once.
IFS=' ' read -r port token 2>/dev/null < "$HOME/.orbpet/port" || exit 0
[ -n "$port" ] && [ -n "$token" ] || exit 0
curl -s -m 2 -o /dev/null -X POST \\
  -H 'Content-Type: application/json' \\
  -H "X-Orbpet-Token: $token" \\
  -H "X-Orbpet-Term: $TERM_PROGRAM" \\
  -H "X-Orbpet-Tmux: $TMUX_PANE" \\
  -H "X-Orbpet-Pid: $ORBPET_PPID" \\
  --data-binary @- "http://127.0.0.1:$port/hook" >/dev/null 2>&1
exit 0
`;

const supported = process.platform !== 'win32'; // Windows 的 hook 指令還沒做
const claudeInstalled = () => fs.existsSync(CLAUDE_DIR);

// ---------------- hooks 安裝／移除 ----------------
const isOurs = (group) => Array.isArray(group && group.hooks)
  && group.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(MARK));

function readClaudeSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return { data: {}, text: null };
  const text = fs.readFileSync(CLAUDE_SETTINGS, 'utf8');
  if (!text.trim()) return { data: {}, text };
  const data = JSON.parse(text); // 解析失敗就丟例外，呼叫端不會動這個檔
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('settings.json is not an object');
  return { data, text };
}

function writeClaudeSettings(data, oldText) {
  const next = `${JSON.stringify(data, null, 2)}\n`;
  if (next === oldText) return false;
  if (oldText !== null && !fs.existsSync(BACKUP_FILE)) fs.writeFileSync(BACKUP_FILE, oldText); // 第一次改之前留一份備份
  const tmp = `${CLAUDE_SETTINGS}.orbpet-tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, CLAUDE_SETTINGS);
  return true;
}

/** 回傳 'installed' | 'absent'（沒裝 Claude Code）| 'unsupported' | 'error' */
function installHooks() {
  if (!supported) return 'unsupported';
  if (!claudeInstalled()) return 'absent';
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HOOK_FILE, HOOK_SCRIPT, { mode: 0o755 });
    const { data, text } = readClaudeSettings();
    const hooks = (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) ? data.hooks : {};
    for (const ev of HOOK_EVENTS) {
      const groups = Array.isArray(hooks[ev]) ? hooks[ev].filter((g) => !isOurs(g)) : [];
      groups.push({ hooks: [{ type: 'command', command: HOOK_COMMAND, async: true, timeout: 5 }] });
      hooks[ev] = groups;
    }
    data.hooks = hooks;
    writeClaudeSettings(data, text);
    return 'installed';
  } catch (e) {
    console.error('OrbPet: could not install Claude Code hooks:', e.message);
    return 'error';
  }
}

function uninstallHooks() {
  if (!supported || !fs.existsSync(CLAUDE_SETTINGS)) return;
  try {
    const { data, text } = readClaudeSettings();
    if (!data.hooks || typeof data.hooks !== 'object') return;
    for (const ev of Object.keys(data.hooks)) {
      if (!Array.isArray(data.hooks[ev])) continue;
      data.hooks[ev] = data.hooks[ev].filter((g) => !isOurs(g));
      if (data.hooks[ev].length === 0) delete data.hooks[ev];
    }
    if (Object.keys(data.hooks).length === 0) delete data.hooks;
    writeClaudeSettings(data, text);
  } catch (e) {
    console.error('OrbPet: could not remove Claude Code hooks:', e.message);
  }
}

// ---------------- 工作階段狀態 ----------------
// state：'work' 工作中｜'ask' 等你指示｜'perm' 請求授權｜'done' 完成未查看｜'idle' 已看過／剛開
const sessions = new Map();
let onChange = () => {};

const TERM_NAMES = {
  Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm2', vscode: 'VS Code', ghostty: 'Ghostty',
  WarpTerminal: 'Warp', WezTerm: 'WezTerm', kitty: 'kitty', Hyper: 'Hyper', tmux: 'tmux', zed: 'Zed', Alacritty: 'Alacritty',
};
// 點彈窗時要帶到前面的 App（macOS）。只列得出名字的；其他的就不動
const MAC_APPS = {
  Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm', vscode: 'Visual Studio Code', ghostty: 'Ghostty',
  WarpTerminal: 'Warp', WezTerm: 'WezTerm', kitty: 'kitty', Hyper: 'Hyper', zed: 'Zed', Alacritty: 'Alacritty',
};

function oneLine(text, max, fromEnd) {
  const lines = String(text || '').split(/\r?\n/)
    .filter((l) => !/^\s*(#|```|---|\|)/.test(l)) // 跳過標題、程式碼圍欄、分隔線、表格
    .map((l) => l.replace(/^[>\-*\s]+/, '').replace(/[*_`]/g, '').trim()).filter(Boolean);
  if (!lines.length) return '';
  const l = fromEnd ? lines[lines.length - 1] : lines[0];
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
}

function publish(changedId, silent) {
  onChange({
    silent: !!silent, changed: changedId || null,
    list: [...sessions.values()].map((s) => ({ id: s.id, name: s.name, where: s.where, state: s.state, line: s.line, since: s.since })),
  });
}

function handleEvent(body, headers) {
  const id = typeof body.session_id === 'string' && body.session_id ? body.session_id : null;
  const ev = body.hook_event_name;
  if (!id || typeof ev !== 'string') return;
  if (ev === 'SessionEnd') { if (sessions.delete(id)) publish(); return; }

  let s = sessions.get(id);
  const isNew = !s;
  if (!s) {
    s = { id, name: 'claude', where: '', state: 'idle', line: '', since: Date.now(), term: '', tmux: '', pid: 0, pidSeen: 0, pidStable: false };
    sessions.set(id, s);
  }
  if (typeof body.cwd === 'string' && body.cwd) s.name = path.basename(body.cwd) || s.name;
  const term = String(headers['x-orbpet-term'] || '');
  const tmux = String(headers['x-orbpet-tmux'] || '');
  if (term) s.term = term;
  if (/^%\d+$/.test(tmux)) s.tmux = tmux;
  s.where = [s.term === 'tmux' ? '' : (TERM_NAMES[s.term] || s.term), s.tmux ? `tmux ${s.tmux}` : (s.term === 'tmux' ? 'tmux' : '')].filter(Boolean).join(' · ');
  // 同一個 pid 隔一段時間又出現，才當成「這是 Claude Code 本身」，之後用它判斷工作階段還在不在
  const pid = Number(headers['x-orbpet-pid']) || 0;
  if (pid > 1) {
    if (pid === s.pid) { if (Date.now() - s.pidSeen > 5000) s.pidStable = true; } else { s.pid = pid; s.pidSeen = Date.now(); s.pidStable = false; }
  }

  const prev = s.state;
  let next = prev, line = s.line;
  if (ev === 'UserPromptSubmit' || ev === 'PostToolUse') {
    next = 'work'; line = '';
  } else if (ev === 'Stop') {
    const msg = String(body.last_assistant_message || '').trim();
    const asking = /[?？]\s*$/.test(msg); // 最後一句是問句 → 在等你下一步指示
    next = asking ? 'ask' : 'done';
    line = asking ? oneLine(msg, 110, true) : oneLine(msg, 90, false);
  } else if (ev === 'Notification') {
    const type = String(body.notification_type || '');
    const msg = oneLine(body.message, 110, false);
    if (type === 'permission_prompt') { next = 'perm'; line = msg || 'Claude needs your permission'; }
    else if (type === 'elicitation_dialog' || type === 'agent_needs_input') { next = 'ask'; line = msg || 'Claude is waiting for your input'; }
    else if (type === 'idle_prompt' && prev === 'work') { next = 'ask'; line = msg || 'Claude is waiting for your input'; }
  }
  if (next !== prev) { s.state = next; s.line = line; s.since = Date.now(); publish(id); } else if (isNew) publish(id);
}

/** 使用者點了彈窗：把那個終端機帶到前面（做得到的範圍內），並把「完成」標成已看過 */
function openTerminal(id) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.state === 'done') { s.state = 'idle'; s.since = Date.now(); publish(id, true); }
  if (s.tmux) {
    execFile('tmux', ['switch-client', '-t', s.tmux], () => {});
    execFile('tmux', ['select-window', '-t', s.tmux], () => {});
    execFile('tmux', ['select-pane', '-t', s.tmux], () => {});
  }
  if (process.platform === 'darwin' && MAC_APPS[s.term]) execFile('open', ['-a', MAC_APPS[s.term]], () => {});
}

// Claude Code 被直接關掉時不會有 SessionEnd：定期看行程還在不在
function pruneDead() {
  let removed = false;
  for (const s of sessions.values()) {
    if (!s.pidStable) continue;
    try { process.kill(s.pid, 0); } catch (e) { if (e.code === 'ESRCH') { sessions.delete(s.id); removed = true; } }
  }
  if (removed) publish();
}

// ---------------- 本機伺服器 ----------------
let server = null;
let token = '';
let pruneTimer = null;

function startServer() {
  if (server) return;
  token = crypto.randomBytes(16).toString('hex');
  const srv = http.createServer((req, res) => {
    const done = (code) => { res.writeHead(code); res.end(); };
    if (req.method !== 'POST' || req.url !== '/hook') return done(404);
    if (req.headers['x-orbpet-token'] !== token) return done(403); // 只有讀得到 ~/.orbpet/port 的本機程式能送
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      done(204);
      try { handleEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')), req.headers); } catch { /* 不是合法 JSON：忽略 */ }
    });
    req.on('error', () => {});
  });
  let port = BASE_PORT;
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < BASE_PORT + 9) { port += 1; srv.listen(port, '127.0.0.1'); } else console.error('OrbPet: hook server failed:', e.message);
  });
  srv.on('listening', () => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PORT_FILE, `${port} ${token}\n`, { mode: 0o600 });
    } catch (e) { console.error('OrbPet: could not write port file:', e.message); }
  });
  srv.listen(port, '127.0.0.1');
  server = srv;
  pruneTimer = setInterval(pruneDead, 20000);
}

function stopServer() {
  if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
  if (server) { server.close(); server = null; }
  try { fs.unlinkSync(PORT_FILE); } catch { /* 本來就沒有 */ }
  if (sessions.size) { sessions.clear(); publish(); }
}

// ---------------- 對外 ----------------
let status = 'off'; // 'installed' | 'absent' | 'unsupported' | 'error' | 'off'

/** enabled=true：裝 hooks、開伺服器；false：移除 hooks、關伺服器。可重複呼叫 */
function setEnabled(enabled) {
  if (enabled) {
    status = installHooks();
    if (status === 'installed') startServer(); else stopServer();
  } else {
    uninstallHooks();
    stopServer();
    status = 'off';
  }
  return status;
}

module.exports = {
  setEnabled,
  /** 結束程式時：只關伺服器、刪 port 檔；hooks 留著，下次開 OrbPet 直接接上 */
  shutdown: stopServer,
  getStatus: () => status,
  claudeInstalled,
  supported,
  setListener(fn) { onChange = fn || (() => {}); },
  resend: () => publish(null, true),
  openTerminal,
};

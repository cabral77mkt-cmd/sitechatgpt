const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultStore() {
  return { users: [], sessions: [], schedules: [], waStates: [] };
}

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return defaultStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return defaultStore();
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function ensureDefaultUser() {
  const store = readStore();
  const defaultUsername = process.env.DEFAULT_USERNAME || 'admin';
  const defaultPassword = process.env.DEFAULT_PASSWORD || 'admin123';

  const exists = store.users.some((user) => user.username.toLowerCase() === defaultUsername.toLowerCase());
  if (exists) return;

  store.users.push({
    id: Date.now(),
    username: defaultUsername,
    passwordHash: hashPassword(defaultPassword),
    createdAt: new Date().toISOString(),
    isDefault: true
  });
  writeStore(store);
  console.log(`Usuário padrão criado: ${defaultUsername}`);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, saved) {
  const [salt, hash] = String(saved).split(':');
  if (!salt || !hash) return false;
  return hashPassword(password, salt) === `${salt}:${hash}`;
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(cookieHeader.split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
    const idx = c.indexOf('=');
    return [c.slice(0, idx), decodeURIComponent(c.slice(idx + 1))];
  }));
}

function getSession(req, store) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (!sid) return null;
  const session = store.sessions.find((s) => s.id === sid && s.expiresAt > Date.now());
  if (!session) return null;
  return session;
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function getOrCreateWaState(store, userId) {
  let state = store.waStates.find((s) => s.userId === userId);
  if (!state) {
    state = { userId, connected: false, token: crypto.randomBytes(16).toString('hex') };
    store.waStates.push(state);
  }
  return state;
}

function normalizeTarget(targetType, target) {
  if (targetType === 'grupo') {
    const clean = String(target || '').trim();
    if (!clean) throw new Error('Informe o grupo/pessoal.');
    return clean;
  }
  const digits = String(target || '').replace(/\D/g, '');
  if (digits.length < 10) throw new Error('Número inválido. Use DDI+DDD+número.');
  return digits;
}

function buildSendUrl(targetType, target, message) {
  if (targetType === 'numero') return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
  return `https://web.whatsapp.com/?text=${encodeURIComponent(message)}`;
}

function processQueue() {
  const store = readStore();
  const now = Date.now();
  let changed = false;

  for (const item of store.schedules) {
    if (item.status !== 'pending') continue;
    if (new Date(item.scheduledAt).getTime() > now) continue;

    const wa = getOrCreateWaState(store, item.userId);
    if (!wa.connected) {
      item.status = 'failed';
      item.error = 'WhatsApp não conectado para este usuário.';
      changed = true;
      continue;
    }

    item.status = 'ready';
    item.sentAt = new Date().toISOString();
    item.sendUrl = buildSendUrl(item.targetType, item.target, item.message);
    changed = true;
  }

  if (changed) writeStore(store);
}

setInterval(processQueue, 3000);

ensureDefaultUser();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const store = readStore();

  if (req.method === 'GET' && url.pathname === '/api/session') {
    const session = getSession(req, store);
    if (!session) return sendJson(res, 200, { authenticated: false });
    const user = store.users.find((u) => u.id === session.userId);
    if (!user) return sendJson(res, 200, { authenticated: false });
    return sendJson(res, 200, { authenticated: true, user: { id: user.id, username: user.username } });
  }

  if (req.method === 'POST' && (url.pathname === '/api/register' || url.pathname === '/api/login')) {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return sendJson(res, 400, { error: 'Informe usuário e senha.' });

    if (url.pathname === '/api/register') {
      if (password.length < 6) return sendJson(res, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
      if (store.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return sendJson(res, 409, { error: 'Usuário já existe.' });
      const user = { id: Date.now(), username, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
      store.users.push(user);
      const sid = crypto.randomBytes(24).toString('hex');
      store.sessions.push({ id: sid, userId: user.id, expiresAt: Date.now() + (8 * 60 * 60 * 1000) });
      writeStore(store);
      return sendJson(res, 200, { ok: true, user: { id: user.id, username: user.username } }, { 'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; Max-Age=28800` });
    }

    const user = store.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) return sendJson(res, 401, { error: 'Credenciais inválidas.' });
    const sid = crypto.randomBytes(24).toString('hex');
    store.sessions.push({ id: sid, userId: user.id, expiresAt: Date.now() + (8 * 60 * 60 * 1000) });
    writeStore(store);
    return sendJson(res, 200, { ok: true, user: { id: user.id, username: user.username } }, { 'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; Max-Age=28800` });
  }

  const session = getSession(req, store);
  const userId = session?.userId;

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    if (!session) return sendJson(res, 401, { error: 'Não autenticado.' });
    store.sessions = store.sessions.filter((s) => s.id !== session.id);
    writeStore(store);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
  }

  if (!session && url.pathname.startsWith('/api/')) {
    return sendJson(res, 401, { error: 'Não autenticado.' });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/connect') {
    const state = getOrCreateWaState(store, userId);
    state.connected = false;
    state.token = crypto.randomBytes(16).toString('hex');
    writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/confirm') {
    const state = getOrCreateWaState(store, userId);
    state.connected = true;
    writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/status') {
    const state = getOrCreateWaState(store, userId);
    writeStore(store);
    return sendJson(res, 200, {
      connected: state.connected,
      qrData: `https://web.whatsapp.com/?session=${state.token}`,
      openUrl: 'https://web.whatsapp.com/'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/schedules') {
    const body = await readBody(req);
    try {
      const targetType = body.targetType;
      const target = normalizeTarget(targetType, body.target);
      const message = String(body.message || '').trim();
      const scheduledAt = new Date(body.scheduledAt);
      if (!targetType || !message || Number.isNaN(scheduledAt.getTime())) throw new Error('Campos inválidos no agendamento.');
      if (scheduledAt.getTime() < Date.now() + 5000) throw new Error('Escolha uma data futura (mínimo 5 segundos).');

      store.schedules.push({
        id: crypto.randomBytes(8).toString('hex'),
        userId,
        targetType,
        target,
        message,
        scheduledAt: scheduledAt.toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        error: null,
        sendUrl: null
      });
      writeStore(store);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/schedules') {
    const schedules = store.schedules.filter((s) => s.userId === userId)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    return sendJson(res, 200, { schedules });
  }

  const safePath = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(fs.readFileSync(filePath));
    return;
  }

  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(indexPath));
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

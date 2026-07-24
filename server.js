const express = require('express');
const path = require('path');

// Load .env for local dev
try {
  const fs = require('fs');
  const envFile = fs.readFileSync(require('path').join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.substring(0, idx).trim();
      const val = line.substring(idx + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  });
} catch (e) {}

const app = express();
app.use(express.json({ limit: '100mb' }));

// ===== Storage: Vercel KV if available, file fallback =====
let kv = null;
const DB_FILE = require('path').join(__dirname, 'db.json');

async function readDB() {
  if (kv) {
    try {
      const data = await kv.get('app_db');
      if (data) return data;
    } catch (e) { console.log('KV read error:', e.message); }
  }
  try {
    if (require('fs').existsSync(DB_FILE)) {
      return JSON.parse(require('fs').readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {}
  return { users: [], lessons: [], files: [], transactions: [], exams: [], examResults: [], reports: [], notifications: [], community: [], unlocks: {}, aiChats: {} };
}

async function writeDB(data) {
  if (kv) {
    try {
      await kv.set('app_db', data);
      return;
    } catch (e) { console.log('KV write error:', e.message); }
  }
  try {
    require('fs').writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

// Try to init KV
async function initKV() {
  try {
    const mod = require('@vercel/kv');
    kv = mod;
    console.log('✅ Vercel KV connected');
  } catch (e) {
    console.log('⚠️ Vercel KV not available, using file storage');
  }
}

const ADMIN_EMAIL = 'DrMomenYosriTheTopADMINONLY19191#3@ADMIN.COM';
const ADMIN_PASS = 'DrMomenYosriTheTopADMINONLY19191#32026/2027';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

// ===== Serve index.html =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== Auth: Login =====
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });
  const db = await readDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.json({ error: 'البريد الإلكتروني غير مسجل' });
  if (user.password !== password) return res.json({ error: 'كلمة المرور غير صحيحة' });
  if (user.status === 'pending') return res.json({ pending: true });
  res.json({ ok: true, user: user });
});

// ===== Auth: Signup =====
app.post('/api/auth/signup', async (req, res) => {
  const userData = req.body;
  if (!userData || !userData.email) return res.status(400).json({ error: 'Missing data' });
  const db = await readDB();
  if (db.users.find(u => u.email === userData.email)) {
    return res.json({ error: 'هذا البريد الإلكتروني مسجل بالفعل' });
  }
  userData.id = userData.id || ('_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
  userData.status = 'pending';
  userData.role = 'student';
  userData.wallet = 0;
  userData.badges = [];
  userData.joinedAt = Date.now();
  db.users.push(userData);
  await writeDB(db);
  res.json({ ok: true, user: userData });
});

// ===== Get single user =====
app.get('/api/user/:email', async (req, res) => {
  const db = await readDB();
  const email = decodeURIComponent(req.params.email);
  const user = db.users.find(u => u.email === email);
  if (!user) return res.json({ user: null });
  res.json({ user: user });
});

// ===== Update single user =====
app.post('/api/user/update', async (req, res) => {
  const db = await readDB();
  const userData = req.body;
  if (!userData || !userData.email) return res.status(400).json({ error: 'Missing email' });
  const idx = db.users.findIndex(u => u.email === userData.email);
  if (idx >= 0) {
    db.users[idx] = { ...db.users[idx], ...userData };
  } else {
    db.users.push(userData);
  }
  await writeDB(db);
  res.json({ ok: true, user: db.users[idx >= 0 ? idx : db.users.length - 1] });
});

// ===== Full sync =====
app.get('/api/sync/:email', async (req, res) => {
  const db = await readDB();
  const email = decodeURIComponent(req.params.email);
  const user = db.users.find(u => u.email === email);
  if (!user) return res.json({ user: null, data: null });
  res.json({
    user: user,
    allUsers: db.users,
    data: {
      lessons: db.lessons,
      files: db.files,
      transactions: db.transactions,
      exams: db.exams,
      examResults: db.examResults,
      reports: db.reports,
      notifications: db.notifications,
      community: db.community,
      unlocks: db.unlocks || {},
      aiChats: db.aiChats || {}
    }
  });
});

// ===== Batch update =====
app.post('/api/batch', async (req, res) => {
  const db = await readDB();
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: 'Empty payload' });

  if (payload.users) {
    payload.users.forEach(userData => {
      const idx = db.users.findIndex(u => u.email === userData.email);
      if (idx >= 0) db.users[idx] = { ...db.users[idx], ...userData };
      else db.users.push(userData);
    });
  }
  if (payload.lessons !== undefined) db.lessons = payload.lessons;
  if (payload.files !== undefined) db.files = payload.files;
  if (payload.transactions !== undefined) db.transactions = payload.transactions;
  if (payload.exams !== undefined) db.exams = payload.exams;
  if (payload.examResults !== undefined) db.examResults = payload.examResults;
  if (payload.reports !== undefined) db.reports = payload.reports;
  if (payload.notifications !== undefined) db.notifications = payload.notifications;
  if (payload.community !== undefined) db.community = payload.community;
  if (payload.unlocks !== undefined) db.unlocks = payload.unlocks;
  if (payload.aiChats !== undefined) db.aiChats = payload.aiChats;

  await writeDB(db);
  res.json({ ok: true });
});

// ===== AI Bot Proxy =====
app.post('/api/ai', async (req, res) => {
  if (!GEMINI_KEY) return res.status(500).json({ error: 'AI key not configured' });
  const { contents, generationConfig } = req.body;
  if (!contents) return res.status(400).json({ error: 'Missing contents' });
  fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig })
  }).then(r => r.text().then(t => ({ ok: r.ok, status: r.status, text: t })))
  .then(({ ok, status, text }) => {
    if (!ok) { res.status(status).send(text); return; }
    res.json(JSON.parse(text));
  }).catch(e => {
    res.status(500).json({ error: e.message });
  });
});

// ===== Health check =====
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// ===== Static files =====
app.use(express.static(__dirname));

// ===== Fallback =====
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== Start =====
initKV().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ✅ Server running at: http://localhost:${PORT}\n`);
  });
});

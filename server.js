const express = require('express');
const path = require('path');

// Load .env for local dev
try {
  const fs = require('fs');
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
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
app.use(express.json({ limit: '10mb' }));

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

// ===== Serve index.html =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== AI Bot Proxy =====
app.post('/api/ai', async (req, res) => {
  if (!GEMINI_KEY) return res.status(500).json({ error: 'AI key not configured' });
  const { contents, generationConfig } = req.body;
  if (!contents) return res.status(400).json({ error: 'Missing contents' });
  fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + GEMINI_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig })
  }).then(function(r){return r.text().then(function(t){return {ok:r.ok,status:r.status,text:t}})})
  .then(function(result){
    if (!result.ok) { res.status(result.status).send(result.text); return; }
    res.json(JSON.parse(result.text));
  }).catch(function(e){
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ✅ Server running at: http://localhost:' + PORT + '\n');
});

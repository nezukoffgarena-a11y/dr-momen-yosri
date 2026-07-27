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

// ===== Daily Game Generator =====
app.post('/api/game', async (req, res) => {
  if (!GEMINI_KEY) return res.status(500).json({ error: 'AI key not configured' });
  const { grade, track, gameType } = req.body;
  if (!grade) return res.status(400).json({ error: 'Missing grade' });
  const gameTypes = {
    quiz: 'multiple choice quiz (4 options each, 5 questions)',
    riddle: 'science riddles (5 riddles with answers)',
    truefalse: 'true or false statements (7 statements with explanations)',
    fillblank: 'fill in the blank (5 sentences)',
    order: 'order/arrange (4 ordering challenges)'
  };
  const prompt = `You are a science game generator for Egyptian curriculum students.
Generate a JSON array of 5-7 science questions. Grade: ${grade}, Track: ${track || 'عام'}.
Game type: ${gameTypes[gameType] || gameTypes.quiz}.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation. The JSON must be an array.

For "quiz" type, each item: {"q":"question text","options":["A","B","C","D"],"correct":0,"explain":"explanation"}
For "riddle" type, each item: {"q":"riddle text","answer":"the answer","explain":"explanation"}
For "truefalse" type, each item: {"q":"statement","correct":true,"explain":"explanation"}
For "fillblank" type, each item: {"q":"sentence with ___","answer":"the missing word","explain":"explanation"}
For "order" type, each item: {"q":"Arrange these in order","items":["item1","item2","item3","item4"],"correctOrder":[0,2,1,3],"explain":"explanation"}

Topics: biology, physics, chemistry, environmental science, earth science.
Make questions educational and age-appropriate for ${grade}.`;
  fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + GEMINI_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 4096 }
    })
  }).then(function(r){return r.text().then(function(t){return {ok:r.ok,status:r.status,text:t}})})
  .then(function(result){
    if (!result.ok) { res.status(result.status).send(result.text); return; }
    try {
      var data = JSON.parse(result.text);
      var text = data.candidates[0].content.parts[0].text;
      text = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      var questions = JSON.parse(text);
      res.json({ questions: questions, gameType: gameType });
    } catch(e) {
      res.status(500).json({ error: 'Failed to parse game data' });
    }
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

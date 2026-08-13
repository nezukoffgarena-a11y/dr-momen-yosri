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

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-9b-v2:free';
const GAME_MODEL = process.env.OPENROUTER_GAME_MODEL || 'nvidia/nemotron-nano-9b-v2:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_FALLBACKS = (process.env.OPENROUTER_FALLBACKS || 'google/gemma-4-26b-a4b-it:free,openai/gpt-oss-20b:free,nvidia/nemotron-nano-12b-v2-vl:free').split(',').map(function(s){return s.trim()}).filter(Boolean);

function openRouterRequest(model, messages, opts) {
  const body = {
    model: model,
    messages: messages,
    max_tokens: opts.maxTokens || 2048,
    temperature: opts.temperature != null ? opts.temperature : 0.7
  };
  const controller = new AbortController();
  const timer = setTimeout(function(){ controller.abort(); }, 30000);
  return fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + OPENROUTER_KEY,
      'HTTP-Referer': 'https://dr-momen-yosri.vercel.app',
      'X-Title': 'Dr. Momen Yosri Science Platform'
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).then(function(r){
    return r.text().then(function(t){return {ok:r.ok,status:r.status,text:t}});
  }).then(function(result){
    clearTimeout(timer);
    var err = null;
    try { err = JSON.parse(result.text).error; } catch (e) {}
    return { ok: result.ok, status: result.status, text: result.text, error: err };
  }).catch(function(e){
    clearTimeout(timer);
    return { ok: false, status: 0, text: '', error: { message: 'request failed: ' + e.message } };
  });
}

// Try primary model with retries, then fallback models. Returns {data} or {status, error}.
function callOpenRouter(messages, opts, callback) {
  const models = [opts.primaryModel || OPENROUTER_MODEL].concat(MODEL_FALLBACKS);
  const retryStatus = [408, 500, 502, 503, 504, 520, 529];
  const delays = [800, 2000, 5000];
  var attempt = 0;
  var modelIdx = 0;
  var rateLimited = false;

  function next() {
    if (modelIdx >= models.length) {
      if (rateLimited) {
        callback(null, { status: 503, error: { message: 'انتهت الحصة المجانية اليومية لطلبات المساعد الذكي، أعد المحاولة غداً بعد منتصف الليل', code: 'RATE_LIMIT' } });
      } else {
        callback(null, { status: 503, error: { message: 'All AI models are currently unavailable, please try again in a moment' } });
      }
      return;
    }
    var model = models[modelIdx];
    openRouterRequest(model, messages, opts).then(function(result){
      if (result.ok) {
        var data = null;
        try { data = JSON.parse(result.text); } catch (e) {}
        var content = '';
        if (data) { try { content = data.choices[0].message.content || ''; } catch (e) {} }
        if (data && content && content.trim()) { callback(data, null); return; }
        // Empty or invalid content: retry same model, then move to next model
        if (attempt < delays.length) {
          var wait = delays[attempt];
          attempt++;
          setTimeout(next, wait);
          return;
        }
        modelIdx++;
        attempt = 0;
        setTimeout(next, 200);
        return;
      }
      if (result.status === 429) { rateLimited = true; }
      if (retryStatus.indexOf(result.status) !== -1 && attempt < delays.length) {
        var wait = delays[attempt];
        attempt++;
        setTimeout(next, wait);
        return;
      }
      modelIdx++;
      attempt = 0;
      setTimeout(next, 200);
    }).catch(function(e){
      if (attempt < delays.length) {
        var wait = delays[attempt];
        attempt++;
        setTimeout(next, wait);
        return;
      }
      modelIdx++;
      attempt = 0;
      setTimeout(next, 200);
    });
  }
  next();
}

function extractOpenRouterText(data) {
  try {
    return data.choices[0].message.content || '';
  } catch (e) { return ''; }
}

// Strip markdown symbols so replies are clean plain text
function cleanMarkdown(text) {
  if (!text) return '';
  var out = String(text);
  out = out.replace(/\*\*/g, '');
  out = out.replace(/\*/g, '');
  out = out.replace(/_([^_\n]+)_/g, '$1');
  out = out.replace(/`{1,3}/g, '');
  out = out.replace(/^#{1,6}\s*/gm, '');
  out = out.replace(/^[•▪◦··]\s*/gm, '');
  out = out.replace(/^[-+]\s+/gm, '');
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/^[ \t]+/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.trim();
  return out;
}

// Convert Gemini-style contents [{role, parts:[{text}]}] to OpenAI messages
function convertContentsToMessages(contents) {
  var messages = [];
  (contents || []).forEach(function(c){
    var role = c.role === 'model' ? 'assistant' : 'user';
    var text = '';
    if (c.parts && c.parts[0]) text = c.parts[0].text;
    if (typeof c.parts === 'string') text = c.parts;
    if (text === undefined || text === null) text = '';
    messages.push({ role: role, content: String(text) });
  });
  if (messages.length && messages[0].content.indexOf('[تعليمات النظام]') !== -1) {
    messages[0].role = 'system';
  }
  return messages;
}

// ===== Serve index.html =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== AI Bot Proxy =====
app.post('/api/ai', async (req, res) => {
  if (!OPENROUTER_KEY) return res.status(500).json({ error: 'AI key not configured' });
  const { contents, generationConfig } = req.body;
  if (!contents) return res.status(400).json({ error: 'Missing contents' });
  const messages = convertContentsToMessages(contents);
  callOpenRouter(messages, {
    temperature: (generationConfig && generationConfig.temperature) || 0.7,
    maxTokens: (generationConfig && generationConfig.maxOutputTokens) || 2048
  }, function(data, err) {
    if (err) {
      res.status(err.status || 500).json({ error: err.error || { message: 'OpenRouter error' } });
      return;
    }
    const text = cleanMarkdown(extractOpenRouterText(data));
    res.json({ candidates: [{ content: { parts: [{ text: text }] } }] });
  });
});

// ===== Daily Game Generator =====
app.post('/api/game', async (req, res) => {
  if (!OPENROUTER_KEY) return res.status(500).json({ error: 'AI key not configured' });
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
  callOpenRouter([{ role: 'user', content: prompt }], { primaryModel: GAME_MODEL, temperature: 0.8, maxTokens: 4096 }, function(data, err) {
    if (err) {
      res.status(err.status || 500).json({ error: err.error || { message: 'OpenRouter error' } });
      return;
    }
    try {
      var text = extractOpenRouterText(data);
      text = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      var questions = JSON.parse(text);
      res.json({ questions: questions, gameType: gameType });
    } catch(e) {
      res.status(500).json({ error: 'Failed to parse game data' });
    }
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

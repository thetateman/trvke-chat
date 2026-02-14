const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, crypto.randomBytes(8).toString('hex') + '-' + safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, true);
  },
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const history = [];
const MAX_HISTORY = 50;

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  ws.username = (url.searchParams.get('username') || 'Anonymous').trim();

  const since = Number(url.searchParams.get('since')) || 0;
  const missed = since ? history.filter(m => m.timestamp > since) : history;
  ws.send(JSON.stringify({ type: 'history', messages: missed }));
  broadcast({ type: 'system', text: `${ws.username} joined` });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type !== 'chat') return;

    const hasText = typeof msg.text === 'string' && msg.text.trim();
    const hasFiles = Array.isArray(msg.files) && msg.files.length > 0
      && msg.files.every(f => typeof f === 'string' && f.startsWith('/uploads/'));
    if (!hasText && !hasFiles) return;

    const enriched = {
      type: 'chat',
      username: ws.username,
      text: hasText ? msg.text.trim() : '',
      timestamp: Date.now(),
    };
    if (hasFiles) {
      enriched.files = msg.files;
    }

    history.push(enriched);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    broadcast(enriched);
  });

  ws.on('close', () => {
    broadcast({ type: 'system', text: `${ws.username} left` });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

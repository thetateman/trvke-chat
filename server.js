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

const groups = new Map();
const MAX_HISTORY = 50;

function createGroup(name) {
  const code = crypto.randomBytes(4).toString('hex');
  groups.set(code, { name: name || code, history: [], clients: new Set() });
  return code;
}

function broadcastToGroup(groupCode, data) {
  const group = groups.get(groupCode);
  if (!group) return;
  const json = JSON.stringify(data);
  for (const client of group.clients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  ws.username = (url.searchParams.get('username') || 'Anonymous').trim();
  ws.groupCode = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'create-group') {
      const name = (typeof msg.name === 'string' && msg.name.trim()) || '';
      const code = createGroup(name);
      const group = groups.get(code);
      ws.groupCode = code;
      group.clients.add(ws);
      ws.send(JSON.stringify({ type: 'group-joined', code, name: group.name, messages: group.history }));
      broadcastToGroup(code, { type: 'system', text: `${ws.username} joined` });
      return;
    }

    if (msg.type === 'join-group') {
      const code = (typeof msg.code === 'string' && msg.code.trim()) || '';
      const since = Number(msg.since) || 0;
      const group = groups.get(code);
      if (!group) {
        ws.send(JSON.stringify({ type: 'error', text: 'Group not found' }));
        return;
      }
      ws.groupCode = code;
      group.clients.add(ws);
      const missed = since ? group.history.filter(m => m.timestamp > since) : group.history;
      ws.send(JSON.stringify({ type: 'group-joined', code, name: group.name, messages: missed }));
      broadcastToGroup(code, { type: 'system', text: `${ws.username} joined` });
      return;
    }

    if (msg.type === 'leave-group') {
      if (ws.groupCode) {
        const group = groups.get(ws.groupCode);
        if (group) {
          group.clients.delete(ws);
          broadcastToGroup(ws.groupCode, { type: 'system', text: `${ws.username} left` });
        }
        ws.groupCode = null;
      }
      return;
    }

    if (msg.type === 'chat') {
      if (!ws.groupCode || !groups.has(ws.groupCode)) return;

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

      const group = groups.get(ws.groupCode);
      group.history.push(enriched);
      if (group.history.length > MAX_HISTORY) {
        group.history.shift();
      }

      broadcastToGroup(ws.groupCode, enriched);
    }
  });

  ws.on('close', () => {
    if (ws.groupCode) {
      const group = groups.get(ws.groupCode);
      if (group) {
        group.clients.delete(ws);
        broadcastToGroup(ws.groupCode, { type: 'system', text: `${ws.username} left` });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

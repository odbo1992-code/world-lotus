const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const ADMIN_CODE = 'cnpFK!!!';

const sessions = new Map();
const events = [];
let activeEvent = null;
const stats = {
  pageViews: 0,
  totalVisits: 0,
  startedAt: Date.now()
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function sendOnlineCount() {
  broadcast({ type: 'online', count: sessions.size });
}

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const sessionId = 's_' + Math.random().toString(36).slice(2, 10);

  sessions.set(sessionId, {
    ip, ua: '', ref: '', screen: '', startedAt: Date.now(), lastSeen: Date.now()
  });
  stats.totalVisits++;

  ws.sessionId = sessionId;
  ws.isAdmin = false;

  ws.send(JSON.stringify({ type: 'session', sessionId }));
  if (activeEvent) ws.send(JSON.stringify({ type: 'event', event: activeEvent }));
  sendOnlineCount();

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    const s = sessions.get(sessionId);
    if (s) s.lastSeen = Date.now();

    if (data.type === 'hello') {
      if (s) {
        s.ua = data.ua || s.ua;
        s.ref = data.ref || s.ref;
        s.screen = data.screen || s.screen;
      }
    }

    if (data.type === 'auth') {
      if (data.code === ADMIN_CODE) {
        ws.isAdmin = true;
        ws.send(JSON.stringify({ type: 'auth', ok: true }));
        ws.send(JSON.stringify({ type: 'analytics', data: buildAnalytics() }));
      } else {
        ws.send(JSON.stringify({ type: 'auth', ok: false }));
      }
      return;
    }

    if (ws.isAdmin) {
      if (data.type === 'createEvent') {
        const evt = {
          id: 'e_' + Date.now(),
          title: String(data.title || '').slice(0, 120),
          desc: String(data.desc || '').slice(0, 500),
          createdAt: Date.now()
        };
        if (evt.title) {
          activeEvent = evt;
          events.unshift(evt);
          broadcast({ type: 'event', event: evt });
        }
      }
      if (data.type === 'clearEvent') {
        activeEvent = null;
        broadcast({ type: 'event', event: null });
      }
      if (data.type === 'requestAnalytics') {
        ws.send(JSON.stringify({ type: 'analytics', data: buildAnalytics() }));
      }
    }
  });

  ws.on('close', () => {
    sessions.delete(sessionId);
    sendOnlineCount();
  });
});

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > 60000) {
      sessions.delete(id);
      changed = true;
    }
  }
  if (changed) sendOnlineCount();
}, 15000);

function buildAnalytics() {
  return {
    online: sessions.size,
    pageViews: stats.pageViews,
    totalVisits: stats.totalVisits,
    uptimeSec: Math.floor((Date.now() - stats.startedAt) / 1000),
    activeEvent,
    events: events.slice(0, 30),
    sessions: Array.from(sessions.entries()).map(([id, s]) => ({
      id, ip: s.ip, ua: s.ua, ref: s.ref, screen: s.screen, startedAt: s.startedAt, lastSeen: s.lastSeen
    }))
  };
}

app.get('/', (req, res) => {
  stats.pageViews++;
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`World Lotus server: http://localhost:${PORT}`);
  console.log(`Admin code: ${ADMIN_CODE}`);
});
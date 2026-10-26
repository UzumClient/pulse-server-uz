const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'cosmetics_data.json');

// Memory storage
let state = {
  players: {}, // uuid -> { playerUuid, username, cosmetic, equipped, updatedAt, serverHost, lastSeen }
  clients: {}, // clientId -> { clientId, username, modVersion, gameVersion, serverHost, lastSeen }
  graffiti: []
};

// Try loading persisted data
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.players) state.players = parsed.players;
    if (parsed.clients) state.clients = parsed.clients;
    if (parsed.graffiti) state.graffiti = parsed.graffiti;
  }
} catch (e) {
  console.error("Could not load data file:", e.message);
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    // Vercel read-only filesystem can throw here, ignore gracefully
  }
}

// Active SSE connections
const sseClients = new Set();

function broadcastEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Accept'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Accept'
    });
    return res.end();
  }

  // 1. Heartbeat
  if (pathname === '/api/pulse-cosmetics/heartbeat' && method === 'POST') {
    const body = await parseJsonBody(req);
    const { clientId, username, modVersion, gameVersion, serverHost } = body;
    if (clientId) {
      state.clients[clientId] = {
        clientId,
        username: username || 'Unknown',
        modVersion: modVersion || '1.0.0',
        gameVersion: gameVersion || 'unknown',
        serverHost: serverHost || 'Singleplayer / Local',
        lastSeen: Date.now()
      };
      saveData();
    }
    return sendJson(res, 200, { status: "ok" });
  }

  // 2. Cosmetics State (Player updates their cosmetic)
  if (pathname === '/api/cosmetics/state' && method === 'POST') {
    const body = await parseJsonBody(req);
    const { clientId, playerUuid, source, cosmetic, equipped } = body;
    if (playerUuid) {
      const now = Date.now();
      const clientInfo = state.clients[clientId] || {};
      const playerRecord = {
        playerUuid,
        source: source || 'pulse',
        cosmetic: cosmetic || '',
        equipped: !!equipped,
        updatedAt: now,
        username: clientInfo.username || state.players[playerUuid]?.username || 'Player',
        serverHost: clientInfo.serverHost || 'Local',
        lastSeen: now
      };
      state.players[playerUuid] = playerRecord;
      saveData();

      // Broadcast live event to all connected SSE clients
      broadcastEvent('pulse_cosmetic', {
        playerUuid,
        source: source || 'pulse',
        cosmetic: cosmetic || '',
        equipped: !!equipped,
        updatedAt: now
      });
    }
    return sendJson(res, 200, { status: "ok" });
  }

  // 3. Cosmetics Query (Mod asks for other players' cosmetics)
  if (pathname === '/api/cosmetics/query' && method === 'POST') {
    const body = await parseJsonBody(req);
    const playerUuids = body.playerUuids || [];
    const states = [];

    for (const uuid of playerUuids) {
      if (state.players[uuid]) {
        const p = state.players[uuid];
        states.push({
          playerUuid: p.playerUuid,
          source: p.source || 'pulse',
          cosmetic: p.cosmetic,
          equipped: p.equipped,
          updatedAt: p.updatedAt
        });
      }
    }

    return sendJson(res, 200, { states });
  }

  // 4. Events Stream (SSE)
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('event: hello\ndata: {}\n\n');
    sseClients.add(res);

    // Keepalive ping every 15 seconds
    const pingTimer = setInterval(() => {
      try {
        res.write('event: ping\ndata: {}\n\n');
      } catch (e) {
        clearInterval(pingTimer);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(pingTimer);
      sseClients.delete(res);
    });
    return;
  }

  // 5. Graffiti Endpoints
  if (pathname === '/api/graffiti/state' && method === 'POST') {
    const body = await parseJsonBody(req);
    return sendJson(res, 200, { status: "ok" });
  }

  if (pathname === '/api/graffiti/query' && method === 'POST') {
    return sendJson(res, 200, { changes: [], hasMore: false });
  }

  // 6. Web Dashboard (Home Page)
  if (pathname === '/' && method === 'GET') {
    const playerList = Object.values(state.players);
    const clientList = Object.values(state.clients);

    const html = `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pulse Cosmetics Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    .container { max-width: 900px; margin: 0 auto; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-bottom: 0.5rem; font-size: 1.8rem; }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; background: #064e3b; color: #34d399; padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: bold; }
    .status-dot { width: 8px; height: 8px; background: #34d399; border-radius: 50%; box-shadow: 0 0 8px #34d399; }
    .stats { display: flex; gap: 1rem; margin-top: 1rem; }
    .stat-box { flex: 1; background: #0f172a; padding: 1rem; border-radius: 8px; border: 1px solid #334155; }
    .stat-val { font-size: 1.5rem; font-weight: bold; color: #38bdf8; }
    .stat-label { font-size: 0.8rem; color: #94a3b8; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #334155; font-size: 0.9rem; }
    th { color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
    .empty { color: #64748b; font-style: italic; padding: 1rem; text-align: center; }
    .cosmetic-tag { background: #0284c7; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h1>Pulse Cosmetics Server</h1>
          <p style="color:#94a3b8; font-size:0.9rem;">Shaxsiy Minecraft Kosmetika Sinxronizatsiya Serveri</p>
        </div>
        <div class="status-badge"><span class="status-dot"></span> Server Ishlamoqda</div>
      </div>
      <div class="stats">
        <div class="stat-box">
          <div class="stat-val">${playerList.length}</div>
          <div class="stat-label">Ro'yxatdan o'tgan o'yinchilar</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${sseClients.size}</div>
          <div class="stat-label">Jonli Ulanganlar (SSE)</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>O'yinchilar va Kosmetikalar</h2>
      ${playerList.length === 0 ? '<div class="empty">Hozircha hech qaysi o\'yinchi ulanmagan. Minecraft o\'yinini ochganingizda bu yerda ma\'lumotlar ko\'rinadi.</div>' : `
        <table>
          <thead>
            <tr>
              <th>Nikneym</th>
              <th>UUID</th>
              <th>Server</th>
              <th>Holat</th>
              <th>Oxirgi faollik</th>
            </tr>
          </thead>
          <tbody>
            ${playerList.map(p => `
              <tr>
                <td><strong>${escapeHtml(p.username)}</strong></td>
                <td style="font-family:monospace; font-size:0.75rem; color:#94a3b8;">${p.playerUuid}</td>
                <td>${escapeHtml(p.serverHost || '-')}</td>
                <td><span class="cosmetic-tag">${p.equipped ? 'Kiyilgan' : 'O\'chiq'}</span></td>
                <td>${new Date(p.updatedAt).toLocaleTimeString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  </div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: "Not Found" }));
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

// Support running locally as server or exported for serverless
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Pulse Cosmetics Server running on port ${PORT}`);
    console.log(`URL: http://localhost:${PORT}`);
  });
}

module.exports = server;

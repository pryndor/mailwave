// Local HTTP bridge for external automation tools (n8n, cron scripts, etc).
// Binds to 127.0.0.1 only. Every request must carry:
//   Authorization: Bearer <automation_token from settings>
const http = require('http');
const crypto = require('crypto');
const license = require('./license');

let server = null;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; if (chunks.length > 5_000_000) req.destroy(); });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try { resolve(JSON.parse(chunks)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function start({ settings, db, mailer, mainWindow, getUnsubPort }) {
  if (server) return { port: server.address()?.port };

  const cfg = settings.getAll();
  if (!cfg.automation_enabled) return null;
  if (!license.isPro(cfg.license_key)) return null;

  let token = cfg.automation_token;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    settings.save({ automation_token: token });
  }

  server = http.createServer(async (req, res) => {
    try {
      const auth = req.headers['authorization'] || '';
      if (auth !== `Bearer ${token}`) return json(res, 401, { error: 'unauthorized' });

      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean); // e.g. ['campaigns','5','send']
      const method = req.method;

      // GET /health
      if (method === 'GET' && parts[0] === 'health') {
        return json(res, 200, { ok: true });
      }

      // GET /campaigns/scheduled
      if (method === 'GET' && parts[0] === 'campaigns' && parts[1] === 'scheduled') {
        return json(res, 200, mailer.listScheduledDetails());
      }

      // GET /campaigns
      if (method === 'GET' && parts[0] === 'campaigns' && parts.length === 1) {
        return json(res, 200, db.listCampaigns());
      }

      // GET /campaigns/:id
      if (method === 'GET' && parts[0] === 'campaigns' && parts.length === 2) {
        const camp = db.getCampaign(Number(parts[1]));
        return camp ? json(res, 200, camp) : json(res, 404, { error: 'not found' });
      }

      // POST /campaigns  (create or update — include id to update)
      if (method === 'POST' && parts[0] === 'campaigns' && parts.length === 1) {
        const body = await readBody(req);
        return json(res, 200, db.saveCampaign(body));
      }

      // DELETE /campaigns/:id
      if (method === 'DELETE' && parts[0] === 'campaigns' && parts.length === 2) {
        return json(res, 200, db.deleteCampaign(Number(parts[1])));
      }

      // POST /campaigns/:id/send
      if (method === 'POST' && parts[0] === 'campaigns' && parts[2] === 'send') {
        const body = await readBody(req);
        const result = await mailer.sendCampaign(
          { campaign_id: Number(parts[1]), ...body }, mainWindow, getUnsubPort
        );
        return json(res, 200, result);
      }

      // POST /campaigns/:id/schedule  { send_at }
      if (method === 'POST' && parts[0] === 'campaigns' && parts[2] === 'schedule') {
        const body = await readBody(req);
        const result = mailer.scheduleCampaign(
          { campaign_id: Number(parts[1]), send_at: body.send_at }, mainWindow, getUnsubPort
        );
        return json(res, 200, result);
      }

      // POST /campaigns/:id/cancel-schedule
      if (method === 'POST' && parts[0] === 'campaigns' && parts[2] === 'cancel-schedule') {
        return json(res, 200, mailer.cancelSchedule(Number(parts[1])));
      }

      // GET /templates
      if (method === 'GET' && parts[0] === 'templates') {
        return json(res, 200, db.listTemplates());
      }

      // POST /templates  (create or update — include id to update)
      if (method === 'POST' && parts[0] === 'templates') {
        const body = await readBody(req);
        return json(res, 200, db.saveTemplate(body));
      }

      // GET /groups
      if (method === 'GET' && parts[0] === 'groups') {
        return json(res, 200, db.listGroups());
      }

      // GET /stats/daily
      if (method === 'GET' && parts[0] === 'stats' && parts[1] === 'daily') {
        return json(res, 200, {
          sent_today:          db.getTodaySentCount(),
          daily_limit:         settings.getAll().daily_send_limit || 300,
          paused_campaigns:    db.getPausedCampaigns(),
          scheduled_campaigns: mailer.listScheduledDetails(),
        });
      }

      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  });

  server.listen(cfg.automation_port, '127.0.0.1', () => {
    console.log(`[Automation API] listening on http://127.0.0.1:${cfg.automation_port} (token in Settings)`);
  });

  return { port: cfg.automation_port, token };
}

function stop() {
  if (server) { server.close(); server = null; }
}

module.exports = { start, stop };

// OAuth sign-in for a desktop app: open the platform's consent page in the
// user's browser and catch the redirect on a short-lived local web server.
//
// The server listens on 127.0.0.1 only, accepts exactly one callback whose
// `state` matches the random value we sent, and shuts down afterwards or
// after 5 minutes. The redirect URL must be registered exactly in the
// platform's developer app, so the port is fixed per platform.
const http   = require('http');
const crypto = require('crypto');

const TIMEOUT_MS = 5 * 60 * 1000;

let active = null; // only one sign-in at a time

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#0f1320;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:420px"><h2>${title}</h2><p style="color:#9aa4b2">${body}</p></div></body>`;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// openUrl(url) opens the browser (shell.openExternal in production).
// buildAuthUrl(state) returns the consent page URL.
// Resolves with the `code` query parameter from the redirect.
function waitForCode({ port, path: callbackPath, buildAuthUrl, openUrl }) {
  if (active) active.cancel('Another sign-in was started.');

  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(24).toString('hex');
    let done = false;

    const finish = (err, code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server6.close();
      active = null;
      err ? reject(err) : resolve(code);
    };

    const handle = (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== callbackPath) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

      if (url.searchParams.get('state') !== state) {
        res.end(page('Sign-in not accepted', 'This link did not come from the sign-in MailWave started. Start again from MailWave.'));
        return; // keep waiting for the real callback
      }
      const error = url.searchParams.get('error');
      if (error) {
        const desc = url.searchParams.get('error_description') || error;
        res.end(page('Sign-in cancelled', escapeHtml(desc)));
        finish(new Error(error === 'user_cancelled_login' || error === 'user_cancelled_authorize' ? 'Sign-in was cancelled.' : `Sign-in failed: ${desc}`));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) { res.end(page('Sign-in failed', 'No authorization code was returned.')); finish(new Error('No authorization code was returned.')); return; }
      res.end(page('Connected', 'You can close this tab and go back to MailWave.'));
      finish(null, code);
    };
    // The redirect URL says "localhost", which a browser may resolve to the
    // IPv4 or the IPv6 loopback, so listen on both (never on other interfaces).
    const server  = http.createServer(handle);
    const server6 = http.createServer(handle);
    server6.on('error', () => {}); // no IPv6 on this machine: IPv4 is enough

    const timer = setTimeout(() => finish(new Error('Sign-in timed out after 5 minutes. Try again.')), TIMEOUT_MS);
    active = { cancel: (reason) => finish(new Error(reason || 'Sign-in cancelled.')) };

    server.on('error', (err) => finish(new Error(err.code === 'EADDRINUSE'
      ? `Port ${port} is in use by another program, so MailWave can't receive the sign-in. Close that program and try again.`
      : err.message)));
    server.listen(port, '127.0.0.1', () => {
      server6.listen(port, '::1');
      Promise.resolve(openUrl(buildAuthUrl(state))).catch(err => finish(err));
    });
  });
}

function cancel() {
  if (active) active.cancel('Sign-in cancelled.');
}

module.exports = { waitForCode, cancel };

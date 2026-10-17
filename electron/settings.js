const path      = require('path');
const fs        = require('fs');
const workspace = require('./workspace');

const settingsPath = path.join(workspace.dataDir(), 'settings.json');

const DEFAULTS = {
  smtp_host:       '',
  smtp_port:       587,
  smtp_secure:     false,
  smtp_user:       '',
  smtp_pass:       '',
  from_name:       '',
  from_email:      '',
  reply_to:        '',
  unsubscribe_email: '',
  license_key:       '',
  batch_size:      50,
  batch_delay:     60,
  per_email_delay: 1,
  // Brevo API (optional — for stats only)
  brevo_api_key:   '',
  // Website FTP/SFTP sync
  sync_protocol:   'ftp',
  sync_host:       '',
  sync_port:       '',
  sync_user:       '',
  sync_password:   '',
  sync_path:       '',
  sync_tls:        false,
  // Daily sending limit & auto-resume
  daily_send_limit:   300,
  daily_resume_time:  '09:00',
  daily_limit_team_wide: false,   // Team Sync: count teammates' sends too (shared sending account)
  // Notifications
  notify_daily_summary:     true,
  notify_summary_time:      '08:00',
  notify_campaign_reminder: true,
  notify_reminder_minutes:  15,
  notify_limit_reached:     true,
  notify_campaign_done:     true,
  // Automation API (local HTTP bridge for external schedulers, e.g. n8n)
  automation_enabled: false,
  automation_port:    8787,
  automation_token:   '',
  // AI writing & review (electron/ai.js). ai_api_key is sealed (secrets.js)
  // and never sent to the renderer — see main.js withoutSecretKeys().
  ai_enabled:     false,
  ai_provider:    'anthropic',          // detected from the key; see aiProviders.js PROVIDERS
  ai_api_key:     '',
  ai_base_url:    '',                   // only for ollama / custom (blank = provider default)
  ai_model_fast:  'claude-haiku-5-5',   // subject lines, rewrites
  ai_model_smart: 'claude-sonnet-5-5',  // full drafts, follow-ups, review
  // Brand voice, injected into every writing prompt
  ai_brand_about:   '',
  ai_brand_tone:    'friendly',
  ai_brand_avoid:   '',
  ai_brand_signoff: '',
};

function getAll() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return { ...DEFAULTS, ...data };
    }
  } catch (e) {
    // ignore, return defaults
  }
  return { ...DEFAULTS };
}

function save(data) {
  const current = getAll();
  const updated = { ...current, ...data };
  fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf8');
  return { ok: true };
}

module.exports = { getAll, save };

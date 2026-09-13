const { app } = require('electron');
const path    = require('path');
const fs      = require('fs');

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

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

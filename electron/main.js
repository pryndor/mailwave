const { app, BrowserWindow, ipcMain, dialog, globalShortcut, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Fixed here (not passed from the renderer) so a compromised renderer can't
// redirect this to an arbitrary URL — the click only ever triggers this one.
const UPGRADE_URL = 'https://rzp.io/rzp/hz68qyl';

let mainWindow;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 650,
    title: 'MailWave',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }

  if (isDev) {
    globalShortcut.register('F12', () => mainWindow?.webContents.openDevTools());
    globalShortcut.register('F5',  () => mainWindow?.reload());
    globalShortcut.register('CommandOrControl+R', () => mainWindow?.reload());
  }

  // Close button minimizes to tray instead of quitting — scheduled sends need the app alive.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Dedicated 8-bit tray icon — the 16-bit main app icon renders blank/invisible
  // in some Linux tray hosts (e.g. XFCE's GTK-based systray), leaving an empty slot.
  const iconPath = path.join(__dirname, '../build/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 22, height: 22 }));
  tray.setToolTip(require('./workspace').current() === 'test'
    ? 'MailWave (test workspace) — running in background'
    : 'MailWave — running in background');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open MailWave', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Background scheduler (runs every 60s) ─────────────────────────────────────
// Handles: auto-resume paused campaigns, daily summary notification,
//          campaign reminder notifications.
let schedulerInterval = null;
// Track which daily-summary minute we already fired so we don't double-fire
let lastSummaryMinute = -1;
// Track which reminder events we already fired (key = campaign_id + send_at)
const firedReminders = new Set();

function startScheduler() {
  schedulerInterval = setInterval(async () => {
    try {
      const cfg     = settings.getAll();
      const now     = new Date();
      const notif   = require('./notifications');

      const pushUI = (type, title, body, campaign_id = null) => {
        db.addNotification(type, title, body, campaign_id);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('notification:new', {});
        }
        notif.sendNative(`MailWave — ${title}`, body);
      };

      // 1. ── Auto-resume paused campaigns ────────────────────────────────────
      const toResume = db.getPausedCampaignsToResume();
      for (const campaign of toResume) {
        console.log(`[Scheduler] Auto-resuming campaign ${campaign.id}: "${campaign.name}"`);
        pushUI('campaign_resumed', 'Campaign Resumed',
          `"${campaign.name}" is resuming from where it left off (${campaign.resume_offset} sent so far).`,
          campaign.id);
        mailer.resumeCampaign(campaign.id, mainWindow);
      }

      // 2. ── Daily summary notification ──────────────────────────────────────
      if (cfg.notify_daily_summary) {
        const [sh, sm] = (cfg.notify_summary_time || '08:00').split(':').map(Number);
        const minuteKey = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        if (now.getHours() === sh && now.getMinutes() === sm && lastSummaryMinute !== minuteKey) {
          lastSummaryMinute = minuteKey;
          const todaySent = db.getTodaySentCount(!!cfg.daily_limit_team_wide);
          const limit     = cfg.daily_send_limit || 300;
          const remaining = Math.max(0, limit - todaySent);
          const paused    = db.getPausedCampaigns();
          const scheduled = mailer.listScheduledDetails();
          let body = `Sent today: ${todaySent} / ${limit}. Remaining: ${remaining}.`;
          if (paused.length)    body += ` ${paused.length} campaign(s) paused.`;
          if (scheduled.length) body += ` ${scheduled.length} campaign(s) scheduled.`;
          pushUI('daily_summary', 'Daily Summary', body, null);
        }
      }

      // 3. ── Campaign reminder notifications ─────────────────────────────────
      if (cfg.notify_campaign_reminder) {
        const reminderMs = (cfg.notify_reminder_minutes || 15) * 60 * 1000;
        const scheduled  = mailer.listScheduledDetails();
        for (const { id, send_at, name } of scheduled) {
          const timeUntil = new Date(send_at).getTime() - now.getTime();
          const key       = `${id}-${send_at}`;
          // Fire once when we're within [reminderMs-30s, reminderMs+30s] window
          if (!firedReminders.has(key) && timeUntil > (reminderMs - 30000) && timeUntil <= (reminderMs + 30000)) {
            firedReminders.add(key);
            const mins = Math.round(timeUntil / 60000);
            pushUI('campaign_reminder', 'Campaign Reminder',
              `"${name}" is scheduled to send in ${mins} minute(s). Open MailWave to manage it.`, id);
          }
        }
        // Clean up old reminder keys to prevent memory growth
        if (firedReminders.size > 500) firedReminders.clear();
      }

    } catch (err) {
      console.error('[Scheduler] Error:', err.message);
    }
  }, 60 * 1000);
}

// Re-arm scheduled sends that were pending when the app last closed/crashed.
// scheduleCampaign() only sets an in-memory setTimeout — it doesn't survive a restart on its own.
// Missed ones (time passed while closed) send immediately instead of silently dropping.
function rearmScheduledCampaigns() {
  mailer.reconcileSchedules(mainWindow);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startScheduler();
  rearmScheduledCampaigns();
  automation.start({ settings, db, mailer, mainWindow });
  teamSync.setOnRemoteChange((counts) => {
    mailer.reconcileSchedules(mainWindow);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('team:changed', counts);
  });
  teamSync.start();
  app.on('activate', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    else createWindow();
  });
});

// Close button hides to tray (see createWindow's 'close' handler) — windows no longer
// actually close except via the tray's Quit action, which sets isQuitting first.
app.on('window-all-closed', () => {
  if (!isQuitting) return;
  if (schedulerInterval) clearInterval(schedulerInterval);
  automation.stop();
  teamSync.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

// ── IPC handlers ──────────────────────────────────────────────────────────────
const db         = require('./db');
const mailer     = require('./mailer');
const settings   = require('./settings');
const automation = require('./automation-server');
const license    = require('./license');
const teamSync   = require('./teamSync');
const contactChecks = require('./contactChecks');

// Write handlers push to the team repo a few seconds later instead of waiting
// for the next 60s sync tick. No-op when Team Sync is off.
const withSync = (fn) => async (...args) => {
  const result = await fn(...args);
  teamSync.syncSoon();
  return result;
};

// Automation API settings
// Automation API (Settings → Automation API). The server only runs on Pro.
const automationStatus = () => {
  const cfg = settings.getAll();
  return {
    enabled: !!cfg.automation_enabled, port: Number(cfg.automation_port) || 8787, token: cfg.automation_token || '',
    running: automation.isRunning(), error: automation.getLastError(), pro: license.isPro(cfg.license_key),
  };
};
ipcMain.handle('automation:get', () => automationStatus());
ipcMain.handle('automation:save', async (_, { enabled, port, token } = {}) => {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) return { ok: false, error: 'Port must be a number from 1024 to 65535.' };
  settings.save({
    automation_enabled: !!enabled,
    automation_port: p,
    ...(typeof token === 'string' ? { automation_token: token.trim() } : {}),
  });
  automation.stop();
  automation.start({ settings, db, mailer, mainWindow });
  await automation.whenStarted();
  return { ok: true, ...automationStatus() };
});

// Settings
ipcMain.handle('startup:get', () => {
  const startupControl = require('./startupControl');
  return startupControl.isEnabled();
});
ipcMain.handle('startup:set', (_, enabled) => {
  const startupControl = require('./startupControl');
  return startupControl.setEnabled(enabled);
});

// team_* keys belong to Team Sync (team:* handlers), ai_* keys to the AI section
// (ai:* handlers) and automation_* keys to the Automation API section
// (automation:* handlers): secrets never reach the Settings form, and its stale
// copy can't overwrite them.
const OWN_SECTIONS = ['team_', 'ai_', 'automation_'];
const withoutSecretKeys = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !OWN_SECTIONS.some(p => k.startsWith(p))));
ipcMain.handle('settings:get',    () => withoutSecretKeys(settings.getAll()));
ipcMain.handle('settings:save',   (_, data) => settings.save(withoutSecretKeys(data)));

// License
ipcMain.handle('license:get', () => license.getStatus(settings.getAll().license_key));
ipcMain.handle('license:activate', (_, key) => {
  const status = license.getStatus(key);
  if (status.plan !== 'pro') return { ok: false, error: 'Invalid or expired license key.' };
  settings.save({ license_key: key });
  return { ok: true, status };
});
ipcMain.handle('license:deactivate', () => {
  settings.save({ license_key: '' });
  return { ok: true };
});
ipcMain.handle('license:openUpgrade', () => {
  // Paid plans are off (see PAID_PLANS_ENABLED in license.js): don't send
  // anyone to a payment page that can't deliver a license key.
  if (!license.PAID_PLANS_ENABLED) return { ok: false };
  shell.openExternal(UPGRADE_URL);
  return { ok: true };
});
ipcMain.handle('settings:test',   (_, data) => mailer.testConnection(data));

// Subscribers — unlimited on every tier, no cap.
ipcMain.handle('subscribers:list',   (_, opts) => db.listSubscribers(opts));
ipcMain.handle('subscribers:add',    withSync((_, sub)  => db.addSubscriber(sub)));
ipcMain.handle('subscribers:update', withSync((_, sub)  => db.updateSubscriber(sub)));
ipcMain.handle('subscribers:delete', withSync((_, ids)  => db.deleteSubscribers(ids)));
ipcMain.handle('subscribers:import', withSync(async (_, rows, group_id, opts = {}) => {
  const clean = opts.clean !== false;
  // DNS lookups run first (async); the import itself is one synchronous transaction.
  const deadDomains = clean && opts.checkDomains !== false
    ? await contactChecks.findDeadDomains(db.importDomains(rows))
    : new Set();
  return db.importSubscribers(rows, group_id || null, { clean, skipRole: !!opts.skipRole, deadDomains });
}));
// "Save as group" for a Smart filter: adds every match to a group (new or existing).
ipcMain.handle('subscribers:filterToGroup', withSync((_, { filter, group_name }) => {
  const name = String(group_name || '').trim();
  if (!name) return { ok: false, error: 'Name the group' };
  const existing = db.listGroups().find(g => g.name.toLowerCase() === name.toLowerCase());
  const group_id = existing ? existing.id : db.addGroup(name).id;
  const ids = db.subscriberIdsForFilter(filter || {});
  db.assignGroup({ subscriber_ids: ids, group_id, action: 'add' });
  return { ok: true, group_id, count: ids.length, existing: !!existing };
}));
ipcMain.handle('subscribers:checkEmail', (_, email) => {
  const normalized = contactChecks.normalizeEmail(email);
  if (!normalized) return { ok: false, error: 'Invalid email address' };
  const suggestion = contactChecks.getEmailSuggestion(normalized);
  return { ok: true, email: normalized, suggestion, reason: contactChecks.getDropReason(normalized) };
});
ipcMain.handle('subscribers:export', ()        => db.exportSubscribers());
ipcMain.handle('subscribers:stats',  ()        => db.subscriberStats());
ipcMain.handle('subscribers:customFields', ()  => db.listCustomFieldKeys());

// Groups
ipcMain.handle('groups:list',   ()         => db.listGroups());
ipcMain.handle('groups:add',    withSync((_, name)  => db.addGroup(name)));
ipcMain.handle('groups:delete', withSync((_, id)    => db.deleteGroup(id)));
ipcMain.handle('groups:assign', withSync((_, data)  => db.assignGroup(data)));

// Templates
ipcMain.handle('templates:list',   ()         => db.listTemplates());
ipcMain.handle('templates:save',   withSync((_, tpl)   => db.saveTemplate(tpl)));
ipcMain.handle('templates:delete', withSync((_, id)    => db.deleteTemplate(id)));

// Campaigns
ipcMain.handle('campaigns:list',      ()         => db.listCampaigns());
ipcMain.handle('campaigns:save',      withSync((_, camp)  => db.saveCampaign(camp)));
ipcMain.handle('campaigns:delete',    withSync((_, id)    => db.deleteCampaign(id)));
ipcMain.handle('campaigns:send',      (_, data)  => mailer.sendCampaign(data, mainWindow));
ipcMain.handle('campaigns:stop',      (_, id)    => mailer.stopSending(id));
ipcMain.handle('campaigns:resume',    (_, id)    => mailer.resumeCampaign(id, mainWindow));
ipcMain.handle('campaigns:smartSchedulePreview', (_, data) => require('./smartSchedule').previewSmartSchedule(data));
ipcMain.handle('campaigns:smartSchedule', withSync((_, data) => {
  const smartSchedule = require('./smartSchedule');
  return smartSchedule.smartScheduleByTimezone(data, mainWindow);
}));
ipcMain.handle('campaigns:recipientCount', (_, group_ids) => db.getActiveSubscribersForCampaign(group_ids || []).length);
ipcMain.handle('campaigns:previewMerge', (_, { campaign, subscriber_id }) => {
  const subs = db.getActiveSubscribersForCampaign([]);
  const sub  = subscriber_id ? subs.find(s => s.id === subscriber_id) : subs[0];
  if (!sub) return { error: 'No subscribers to preview against. Add at least one subscriber first.' };
  return mailer.previewMerge(campaign, sub);
});

// Send history
ipcMain.handle('history:list', (_, opts) => db.listHistory(opts));
ipcMain.handle('history:failures', (_, campaign_id) => db.campaignFailureGroups(campaign_id));

// Scheduling
ipcMain.handle('campaigns:schedule',            withSync((_, data) => mailer.scheduleCampaign(data, mainWindow)));
ipcMain.handle('campaigns:cancelSchedule',      withSync((_, id)   => mailer.cancelSchedule(id)));

// File dialogs
ipcMain.handle('dialog:openFile', async (_, opts) => dialog.showOpenDialog(mainWindow, opts));

// Duplicate campaign
ipcMain.handle('campaigns:duplicate', withSync((_, id) => db.duplicateCampaign(id)));

// FTP/SFTP sync
const sync = require('./sync');
ipcMain.handle('sync:fromServer', (_, cfg) => sync.syncFromServer(cfg));

// Brevo stats
const brevo = require('./brevo');

ipcMain.handle('brevo:stats',           ()      => brevo.getAccountStats(settings.getAll().brevo_api_key));
ipcMain.handle('brevo:today',           ()      => brevo.getTodayStats(settings.getAll().brevo_api_key));
ipcMain.handle('brevo:hasKey',          ()      => !!settings.getAll().brevo_api_key);
// Sends are tagged campaign-<uid>[-a|-b]. Campaigns sent before that change
// were tagged with the local id, which only means something on the machine
// that sent them, so that tag is tried only there.
ipcMain.handle('brevo:campaignMetrics', (_, id, variant) => {
  const camp = db.getCampaign(id);
  if (!camp) return { ok: false, error: 'Campaign not found' };
  return brevo.getCampaignMetricsFor(settings.getAll().brevo_api_key, camp, variant, db.campaignSentHere(id));
});

// Notifications
ipcMain.handle('notifications:list',        ()      => db.listNotifications());
ipcMain.handle('notifications:markAllRead', ()      => db.markAllNotificationsRead());
ipcMain.handle('notifications:unreadCount', ()      => db.getUnreadNotificationCount());

// Daily stats (local — independent of Brevo)
ipcMain.handle('daily:stats', () => {
  const cfg = settings.getAll();
  return {
    sent_today:          db.getTodaySentCount(!!cfg.daily_limit_team_wide),
    daily_limit:         cfg.daily_send_limit || 300,
    paused_campaigns:    db.getPausedCampaigns(),
    scheduled_campaigns: mailer.listScheduledDetails(),
  };
});

// Team Sync (shared data through a private GitHub repo)
const github = require('./github');
const teamCall = (fn) => async (...args) => {
  try { return await fn(...args); }
  catch (err) { return { ok: false, error: err.message, proRequired: !!err.proRequired }; }
};
ipcMain.handle('team:status',     () => teamSync.status());
ipcMain.handle('team:connect',    teamCall((_, token) => teamSync.connect(token)));
ipcMain.handle('team:create',     teamCall((_, data)  => teamSync.createTeam(data)));
ipcMain.handle('team:join',       teamCall((_, data)  => teamSync.joinTeam(data)));
ipcMain.handle('team:invite',     teamCall((_, user)  => teamSync.invite(user)));
ipcMain.handle('team:syncNow',    teamCall(()         => teamSync.syncNow()));
ipcMain.handle('team:leave',      teamCall(()         => teamSync.leave()));
ipcMain.handle('team:disconnect', teamCall(()         => teamSync.disconnect()));
// Device login: first call returns the code to show; second waits for approval.
let pendingDeviceLogin = null;
ipcMain.handle('team:deviceLoginStart', teamCall(async () => {
  pendingDeviceLogin = await github.startDeviceFlow();
  shell.openExternal(pendingDeviceLogin.verification_uri);
  return { ok: true, user_code: pendingDeviceLogin.user_code, verification_uri: pendingDeviceLogin.verification_uri };
}));
ipcMain.handle('team:deviceLoginWait', teamCall(async () => {
  if (!pendingDeviceLogin) throw new Error('No GitHub login in progress');
  const { device_code, interval, expires_in } = pendingDeviceLogin;
  const token = await github.pollDeviceFlow(device_code, interval, expires_in);
  pendingDeviceLogin = null;
  return teamSync.connect(token);
}));

// Workspaces (main / test) and the Team Sync trial
const workspace = require('./workspace');
const trial     = require('./trial');
ipcMain.handle('workspace:info',       () => workspace.info());
ipcMain.handle('workspace:createTest', teamCall((_, opts) => workspace.createTest(opts || {}, db.handle)));
ipcMain.handle('workspace:deleteTest', teamCall(() => workspace.deleteTest()));
// db.js/settings.js open their files once at startup, so switching = relaunch.
ipcMain.handle('workspace:switch',     teamCall((_, name) => {
  workspace.setNext(name);
  isQuitting = true;
  app.relaunch();
  app.exit(0);
  return { ok: true };
}));
ipcMain.handle('team:startTrial', () => {
  const status = trial.start();
  teamSync.start();
  return { ok: true, trial: status };
});

// AI writing & review (electron/ai.js). All calls run here; the renderer only
// ever sees results, never the API key.
const ai = require('./ai');
ipcMain.handle('ai:getConfig',  () => ai.getConfig());
ipcMain.handle('ai:saveConfig', ai.handler((data) => ai.saveConfig(data)));
ipcMain.handle('ai:test',       ai.handler(() => ai.testConnection()));
ipcMain.handle('ai:listModels', ai.handler(async (opts) => ({ ok: true, models: await ai.listModels(opts) })));
ipcMain.handle('ai:draft',      ai.handler((brief) => ai.draft(brief)));
ipcMain.handle('ai:followUp',   ai.handler((opts)  => ai.followUp(opts)));
ipcMain.handle('ai:reply',      ai.handler((opts)  => ai.reply(opts)));
ipcMain.handle('ai:subjects',   ai.handler((opts)  => ai.subjects(opts)));
ipcMain.handle('ai:rewrite',    ai.handler((opts)  => ai.rewrite(opts)));
ipcMain.handle('ai:review',     ai.handler((camp)  => ai.review(camp)));
ipcMain.handle('ai:previewText', ai.handler((opts) => ai.previewText(opts)));
ipcMain.handle('ai:plainText',   ai.handler((opts) => ai.plainText(opts)));
ipcMain.handle('ai:translate',   ai.handler((opts) => ai.translate(opts)));
ipcMain.handle('ai:sequence',    ai.handler((brief) => ai.sequence(brief)));
ipcMain.handle('ai:report',      ai.handler((opts) => ai.report(opts)));
ipcMain.handle('ai:subscriberFilter', ai.handler((opts) => ai.subscriberFilter(opts)));
ipcMain.handle('ai:mapColumns',  ai.handler((opts) => ai.mapColumns(opts)));
ipcMain.handle('ai:continue',    ai.handler((opts) => ai.continueWriting(opts)));

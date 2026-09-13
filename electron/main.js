const { app, BrowserWindow, ipcMain, dialog, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
  const iconPath = path.join(__dirname, '../build/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 22, height: 22 }));
  tray.setToolTip('MailWave — running in background');

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
          const todaySent = db.getTodaySentCount();
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
function rearmScheduledCampaigns() {
  const pending = db.listCampaigns().filter(c => c.scheduled_at && c.status !== 'sent' && c.status !== 'sending');
  for (const c of pending) {
    if (new Date(c.scheduled_at).getTime() <= Date.now()) {
      // Missed while the app was closed — send immediately instead of silently dropping it.
      mailer.sendCampaign({ campaign_id: c.id }, mainWindow);
    } else {
      mailer.scheduleCampaign({ campaign_id: c.id, send_at: c.scheduled_at }, mainWindow);
    }
  }
  if (pending.length) console.log(`[Scheduler] Re-armed ${pending.length} pending scheduled campaign(s).`);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startScheduler();
  rearmScheduledCampaigns();
  automation.start({ settings, db, mailer, mainWindow });
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
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

// ── IPC handlers ──────────────────────────────────────────────────────────────
const db         = require('./db');
const mailer     = require('./mailer');
const settings   = require('./settings');
const automation = require('./automation-server');
const license    = require('./license');

// Automation API settings
ipcMain.handle('automation:get', () => {
  const cfg = settings.getAll();
  return { enabled: cfg.automation_enabled, port: cfg.automation_port, token: cfg.automation_token };
});
ipcMain.handle('automation:save', (_, data) => {
  const result = settings.save(data);
  automation.stop();
  automation.start({ settings, db, mailer, mainWindow });
  return result;
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

ipcMain.handle('settings:get',    () => settings.getAll());
ipcMain.handle('settings:save',   (_, data) => settings.save(data));

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
ipcMain.handle('settings:test',   (_, data) => mailer.testConnection(data));

// Subscribers — unlimited on every tier, no cap.
ipcMain.handle('subscribers:list',   (_, opts) => db.listSubscribers(opts));
ipcMain.handle('subscribers:add',    (_, sub)  => db.addSubscriber(sub));
ipcMain.handle('subscribers:update', (_, sub)  => db.updateSubscriber(sub));
ipcMain.handle('subscribers:delete', (_, ids)  => db.deleteSubscribers(ids));
ipcMain.handle('subscribers:import', (_, rows, group_id) => db.importSubscribers(rows, group_id || null));
ipcMain.handle('subscribers:export', ()        => db.exportSubscribers());
ipcMain.handle('subscribers:stats',  ()        => db.subscriberStats());
ipcMain.handle('subscribers:customFields', ()  => db.listCustomFieldKeys());

// Groups
ipcMain.handle('groups:list',   ()         => db.listGroups());
ipcMain.handle('groups:add',    (_, name)  => db.addGroup(name));
ipcMain.handle('groups:delete', (_, id)    => db.deleteGroup(id));
ipcMain.handle('groups:assign', (_, data)  => db.assignGroup(data));

// Templates
ipcMain.handle('templates:list',   ()         => db.listTemplates());
ipcMain.handle('templates:save',   (_, tpl)   => db.saveTemplate(tpl));
ipcMain.handle('templates:delete', (_, id)    => db.deleteTemplate(id));

// Campaigns
ipcMain.handle('campaigns:list',      ()         => db.listCampaigns());
ipcMain.handle('campaigns:get',       (_, id)    => db.getCampaign(id));
ipcMain.handle('campaigns:save',      (_, camp)  => db.saveCampaign(camp));
ipcMain.handle('campaigns:delete',    (_, id)    => db.deleteCampaign(id));
ipcMain.handle('campaigns:send',      (_, data)  => mailer.sendCampaign(data, mainWindow));
ipcMain.handle('campaigns:stop',      (_, id)    => mailer.stopSending(id));
ipcMain.handle('campaigns:resume',    (_, id)    => mailer.resumeCampaign(id, mainWindow));
ipcMain.handle('campaigns:smartSchedule', (_, data) => {
  const smartSchedule = require('./smartSchedule');
  return smartSchedule.smartScheduleByTimezone(data, mainWindow);
});
ipcMain.handle('campaigns:previewMerge', (_, { campaign, subscriber_id }) => {
  const subs = db.getActiveSubscribersForCampaign([]);
  const sub  = subscriber_id ? subs.find(s => s.id === subscriber_id) : subs[0];
  if (!sub) return { error: 'No subscribers to preview against. Add at least one subscriber first.' };
  return mailer.previewMerge(campaign, sub);
});

// Send history
ipcMain.handle('history:list', (_, opts) => db.listHistory(opts));

// Scheduling
ipcMain.handle('campaigns:schedule',            (_, data) => mailer.scheduleCampaign(data, mainWindow));
ipcMain.handle('campaigns:cancelSchedule',      (_, id)   => mailer.cancelSchedule(id));
ipcMain.handle('campaigns:listScheduled',       ()        => mailer.listScheduled());
ipcMain.handle('campaigns:listScheduledDetails',()        => mailer.listScheduledDetails());

// File dialogs
ipcMain.handle('dialog:openFile', async (_, opts) => dialog.showOpenDialog(mainWindow, opts));
ipcMain.handle('dialog:saveFile', async (_, opts) => dialog.showSaveDialog(mainWindow, opts));

// Duplicate campaign
ipcMain.handle('campaigns:duplicate', (_, id) => db.duplicateCampaign(id));

// FTP/SFTP sync
const sync = require('./sync');
ipcMain.handle('sync:fromServer', (_, cfg) => sync.syncFromServer(cfg));

// Brevo stats
const brevo = require('./brevo');

ipcMain.handle('brevo:stats',           ()      => brevo.getAccountStats(settings.getAll().brevo_api_key));
ipcMain.handle('brevo:today',           ()      => brevo.getTodayStats(settings.getAll().brevo_api_key));
ipcMain.handle('brevo:campaignMetrics', (_, id) => brevo.getCampaignMetrics(settings.getAll().brevo_api_key, id));

// Notifications
ipcMain.handle('notifications:list',        ()      => db.listNotifications());
ipcMain.handle('notifications:markAllRead', ()      => db.markAllNotificationsRead());
ipcMain.handle('notifications:unreadCount', ()      => db.getUnreadNotificationCount());

// Daily stats (local — independent of Brevo)
ipcMain.handle('daily:stats', () => {
  const cfg = settings.getAll();
  return {
    sent_today:          db.getTodaySentCount(),
    daily_limit:         cfg.daily_send_limit || 300,
    paused_campaigns:    db.getPausedCampaigns(),
    scheduled_campaigns: mailer.listScheduledDetails(),
  };
});

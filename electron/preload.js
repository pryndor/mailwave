const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // Run-at-startup (native login items on win/mac, XDG autostart entry on linux)
  startup: {
    get: ()        => invoke('startup:get'),
    set: (enabled) => invoke('startup:set', enabled),
  },

  // Settings
  settings: {
    get:  ()     => invoke('settings:get'),
    save: (data) => invoke('settings:save', data),
    test: (data) => invoke('settings:test', data),
  },

  // License
  license: {
    get:          ()    => invoke('license:get'),
    activate:     (key) => invoke('license:activate', key),
    deactivate:   ()    => invoke('license:deactivate'),
    openUpgrade:  ()    => invoke('license:openUpgrade'),
  },

  // Subscribers
  subscribers: {
    list:   (opts) => invoke('subscribers:list', opts),
    add:    (sub)  => invoke('subscribers:add', sub),
    update: (sub)  => invoke('subscribers:update', sub),
    delete: (ids)  => invoke('subscribers:delete', ids),
    import: (rows, group_id, opts) => invoke('subscribers:import', rows, group_id, opts),
    checkEmail: (email) => invoke('subscribers:checkEmail', email),
    export: ()     => invoke('subscribers:export'),
    stats:  ()     => invoke('subscribers:stats'),
    customFields: () => invoke('subscribers:customFields'),
  },

  // Groups
  groups: {
    list:   ()     => invoke('groups:list'),
    add:    (name) => invoke('groups:add', name),
    delete: (id)   => invoke('groups:delete', id),
    assign: (data) => invoke('groups:assign', data),
  },

  // Templates
  templates: {
    list:   ()     => invoke('templates:list'),
    save:   (tpl)  => invoke('templates:save', tpl),
    delete: (id)   => invoke('templates:delete', id),
  },

  // Campaigns
  campaigns: {
    list:                   ()     => invoke('campaigns:list'),
    get:                    (id)   => invoke('campaigns:get', id),
    save:                   (camp) => invoke('campaigns:save', camp),
    delete:                 (id)   => invoke('campaigns:delete', id),
    duplicate:              (id)   => invoke('campaigns:duplicate', id),
    send:                   (data) => invoke('campaigns:send', data),
    stop:                   (id)   => invoke('campaigns:stop', id),
    resume:                 (id)   => invoke('campaigns:resume', id),
    schedule:               (data) => invoke('campaigns:schedule', data),
    cancelSchedule:         (id)   => invoke('campaigns:cancelSchedule', id),
    listScheduled:          ()     => invoke('campaigns:listScheduled'),
    listScheduledDetails:   ()     => invoke('campaigns:listScheduledDetails'),
    previewMerge:           (data) => invoke('campaigns:previewMerge', data),
    recipientCount:         (group_ids) => invoke('campaigns:recipientCount', group_ids),
    smartSchedule:          (data) => invoke('campaigns:smartSchedule', data),
  },

  // History
  history: {
    list: (opts) => invoke('history:list', opts),
  },

  // File dialogs
  dialog: {
    openFile: (opts) => invoke('dialog:openFile', opts),
    saveFile: (opts) => invoke('dialog:saveFile', opts),
  },

  // FTP/SFTP sync
  sync: {
    fromServer: (cfg) => invoke('sync:fromServer', cfg),
  },

  // Brevo stats
  brevo: {
    stats:           ()   => invoke('brevo:stats'),
    today:           ()   => invoke('brevo:today'),
    campaignMetrics: (id, variant) => invoke('brevo:campaignMetrics', id, variant),
  },

  // Notifications (in-app)
  notifications: {
    list:        ()  => invoke('notifications:list'),
    markAllRead: ()  => invoke('notifications:markAllRead'),
    unreadCount: ()  => invoke('notifications:unreadCount'),
  },

  // Daily local stats (independent of Brevo)
  daily: {
    stats: () => invoke('daily:stats'),
  },

  // Automation API (local HTTP bridge for n8n / external schedulers)
  automation: {
    get:  ()     => invoke('automation:get'),
    save: (data) => invoke('automation:save', data),
  },

  // Team Sync (GitHub)
  team: {
    status:           ()     => invoke('team:status'),
    connect:          (tok)  => invoke('team:connect', tok),
    deviceLoginStart: ()     => invoke('team:deviceLoginStart'),
    deviceLoginWait:  ()     => invoke('team:deviceLoginWait'),
    create:           (data) => invoke('team:create', data),
    join:             (data) => invoke('team:join', data),
    invite:           (user) => invoke('team:invite', user),
    syncNow:          ()     => invoke('team:syncNow'),
    leave:            ()     => invoke('team:leave'),
    disconnect:       ()     => invoke('team:disconnect'),
    startTrial:       ()     => invoke('team:startTrial'),
  },

  // Workspaces: main data vs. a separate test workspace
  workspace: {
    info:       ()     => invoke('workspace:info'),
    createTest: (opts) => invoke('workspace:createTest', opts),
    deleteTest: ()     => invoke('workspace:deleteTest'),
    switchTo:   (name) => invoke('workspace:switch', name),
  },

  // AI writing & review (key stays in the main process)
  ai: {
    getConfig:  ()     => invoke('ai:getConfig'),
    saveConfig: (data) => invoke('ai:saveConfig', data),
    test:       ()     => invoke('ai:test'),
    listModels: (opts) => invoke('ai:listModels', opts),
    draft:      (brief) => invoke('ai:draft', brief),
    followUp:   (opts) => invoke('ai:followUp', opts),
    reply:      (opts) => invoke('ai:reply', opts),
    subjects:   (opts) => invoke('ai:subjects', opts),
    rewrite:    (opts) => invoke('ai:rewrite', opts),
    review:     (camp) => invoke('ai:review', camp),
  },

  // ── IPC event listeners ────────────────────────────────────────────────────

  // Real-time send progress
  onSendProgress: (cb) => {
    ipcRenderer.on('send:progress', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('send:progress');
  },

  // Teammates' changes arrived via Team Sync — pages can reload their data
  onTeamChanged: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('team:changed', handler);
    return () => ipcRenderer.removeListener('team:changed', handler);
  },

  // Notification bell — fires whenever a new notification is created
  onNotification: (cb) => {
    ipcRenderer.on('notification:new', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('notification:new');
  },
});

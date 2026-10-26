// 7-day Team Sync trial for free users. Started explicitly from Settings,
// once per install — stored in app-state.json so it is shared by the main and
// test workspaces and can't be restarted by switching between them.
//
// It's a local, unsigned timestamp: someone determined can reset it by
// deleting app-state.json. Acceptable for a trial; the paid check remains the
// signed license in license.js.
const workspace = require('./workspace');
const license   = require('./license');
const settings  = require('./settings');

const TRIAL_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

function status() {
  const started = workspace.readState().team_trial_started_at;
  if (!started) return { available: true, active: false, ended: false, days: TRIAL_DAYS };
  const endsAt = new Date(Date.parse(started) + TRIAL_DAYS * DAY);
  const left = endsAt - Date.now();
  return {
    available: false,
    active: left > 0,
    ended: left <= 0,
    startedAt: started,
    endsAt: endsAt.toISOString(),
    daysLeft: Math.max(0, Math.ceil(left / DAY)),
    days: TRIAL_DAYS,
  };
}

function start() {
  const s = status();
  if (!s.available) return s;
  workspace.writeState({ team_trial_started_at: new Date().toISOString() });
  return status();
}

// Team Sync is usable with a Pro license or during the trial.
function teamAllowed() {
  return license.isPro(settings.getAll().license_key) || status().active;
}

module.exports = { status, start, teamAllowed };

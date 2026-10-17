# Team Sync (GitHub): shared data for several MailWave users

Status: **built, and tested against a simulated GitHub. Not yet tried against real github.com.** Added 2026-09-28.

## What problem this solves

Each MailWave install keeps all its data in its own local SQLite file (`mailwave.db`). Before this feature, two people in the same organisation could not see each other's subscribers, campaigns, schedules or send history.

Team Sync gives a team one shared dataset **without running any server**. It uses a private GitHub repo as the shared storage, and every device encrypts its data before uploading it.

This is the serverless alternative to `team-backend/` (Vercel + Neon Postgres), which already exists in this repo. The two approaches compare like this:

| | Team Sync (GitHub) | `team-backend/` (hosted) |
|---|---|---|
| Server / monthly cost | None | Vercel + Neon bills |
| Privacy | End-to-end encrypted. GitHub only sees ciphertext | Data is readable on our server |
| Sends while every laptop is off | No: at least one team member's app must be running | Yes: the cron sender does it |
| UI | Built into the desktop app | API only, no UI yet |
| Good for | Small teams, roughly 2–15 people | Larger teams, or sends that must happen with no laptop on |

## How it works

### Repo layout

```
mailwave-team.json              plaintext: team name, KDF salt, passphrase check value
devices/<deviceId>/device.mwe   encrypted: device name + GitHub login
devices/<deviceId>/000000001.mwe  encrypted change events (append-only, one file per push)
locks/<campaignUid>.mwe         encrypted: which device is currently sending a campaign
```

- **Only the device that owns a `devices/<id>/` folder writes to it.** Pushes from different teammates therefore never conflict.
- Every device downloads everyone else's new event files and replays them into its own SQLite.
- `.mwe` file format: `"MW1" | iv(12) | GCM tag(16) | AES-256-GCM(gzip(JSON))`.
- The key is derived with `scrypt(passphrase, salt, N=2^15)`. The passphrase itself is never stored anywhere. Each device keeps only the derived key, encrypted with the OS keychain through Electron's `safeStorage`.

### What syncs

| Data | Synced | Notes |
|---|---|---|
| Subscribers (including custom fields and group membership) | Yes | Deterministic uid from the email, so the same email imported on two machines becomes one record |
| Groups | Yes | Deterministic uid from the name |
| Templates | Yes | |
| Campaigns (content) | Yes | Group references are remapped to each machine's local ids |
| Campaign state (status, progress, `scheduled_at`, resume) | Yes | Kept as a separate record so live progress updates don't re-upload the HTML |
| Send history | Yes | Append-only. Rows are tagged with `origin_device` |
| Notifications | No | Per device |
| Settings, SMTP password, license key, Brevo key | **Never** | |
| Attachment files | No | Only the file name and path sync (see "Not done yet") |

### Change detection

The code doesn't hook every write in `db.js`. On each sync, `teamStore.collectLocalChanges()` exports every record, hashes it, and compares the hash with the `sync_state` table. Anything new, changed or deleted becomes an event. This means imports, mailer progress updates, smart schedule and the automation API are all picked up without modifying them.

### Conflicts

When the same record is edited on two machines, **the later edit wins** (last-writer-wins). The comparison uses `(logical clock, device id)`. The logical clock is based on wall-clock time, but it never moves backwards and never falls behind any timestamp already seen from a teammate, so a slightly wrong laptop clock can't make an old edit win.

The rule applies to the whole record, not to individual fields: if two people edit different fields of the same subscriber at the same time, one person's whole version wins.

### Scheduled sends: preventing duplicates

This is the most important safety part.

1. **Every** team device arms a timer for every scheduled campaign (`mailer.reconcileSchedules()`). If the person who scheduled a campaign is offline, a teammate's machine still sends it.
2. Before any real send (manual, scheduled, auto-resume, automation API or smart schedule), `mailer.sendCampaign()` must claim `locks/<campaignUid>.mwe` using GitHub's sha compare-and-swap. **Exactly one device wins.** The others skip with "X is already sending this campaign".
3. Each attempt has a `run_key` (`sched:<time>`, `resume:<time>` or `manual:<ms>`). A lock marked `done` for the same run_key stops a teammate whose timer fires late from sending the campaign again.
4. The lock is a 15-minute lease, renewed every sync while sending. If a machine crashes mid-send, the lock expires on its own.
5. **Fail closed:** if GitHub is unreachable, the send does **not** start. Scheduled and resume sends retry every 2 minutes (up to 15 times). A manual send shows the error.
6. The daily send limit counts only this device's own sends (`origin_device IS NULL`), because each person sends through their own SMTP account. Teams that share **one** sending account (and so one provider quota, e.g. Brevo free = 300/day) turn on Settings → Daily Sending Limit → **Team shares one sending account** on every machine; the count then includes teammates' synced sends (up to ~1 minute behind).

### Brevo stats in a team

- The Brevo key is a per-device setting and never syncs. Each person enters their own (or the shared account's) key.
- Sends are tagged `campaign-<uid>` (plus `-a` / `-b` for A/B), using the campaign's shared uid, so Metrics on any teammate's machine looks up the same tag. Before this, the tag used the local integer id, which differs per machine and could show another campaign's stats.
- Campaigns sent before the change keep their old `campaign-<local id>` tag; Metrics tries that tag only on the machine that sent them.
- Stats live in the Brevo account that sent the email. With separate accounts, each person sees only the campaigns their own account sent.

### Sync timing

- A full sync (push, then pull, then lock renewal) runs every 60 seconds, plus 3 seconds after any edit made in the UI.
- An unchanged repo costs one conditional request, which GitHub returns as 304 and doesn't count against the rate limit.
- When a device is more than 40 files behind (for example on first join), it downloads the whole repo as one tarball instead of making hundreds of API calls.

## Free trial and test workspace

Added 2026-09-28, so people can evaluate Team Sync safely before buying.

### 7-day Team Sync trial (`electron/trial.js`)
- Free users get a **Start free 7-day trial** button in Settings → Team Sync. The trial only starts when they click it.
- The trial covers Team Sync only. Other Pro features (automation, smart schedule, FTP sync) stay locked.
- It runs **once per install**. The start date is stored in `<userData>/app-state.json`, which both workspaces share, so switching workspaces can't restart it.
- After 7 days, syncing and send locks switch off and the app works locally as before. All data stays on the computer. Settings shows "trial ended", Upgrade and Leave team.
- Access rule: `trial.teamAllowed()` is true with a Pro license **or** an active trial. It replaced the Pro-only check inside `teamSync.js`.
- **Limitation:** the trial date is a local, unsigned timestamp. Deleting `app-state.json` resets it. Making it tamper-proof would need a server-issued trial token, the same way licenses are issued (possible later with the webhook on your VPS).

### Test workspace (`electron/workspace.js`)
- Settings → Workspace → **Create test workspace**, with a choice of **start empty** or **start with a copy of my current data**.
- The test workspace is a separate folder beside the real data:
  ```
  <userData>/mailwave.db, settings.json          main workspace (unchanged location)
  <userData>/workspaces/test/mailwave.db, ...    test workspace
  <userData>/app-state.json                      active workspace + trial start
  ```
- Switching restarts the app, because the database is opened once at startup. An orange banner shows on every page while the test workspace is active.
- Safety measures when creating it:
  - SMTP and license settings are copied, so test sends work.
  - **Team settings are never copied**, so a test workspace can't push into the real team.
  - The automation API is turned off in the copy, so it doesn't clash with the main workspace.
  - The copied data loses its team ids, so it can join a *test* team repo as new data.
  - Copied `scheduled_at` / `resume_at` values are cleared, so real campaigns are **not sent twice** from the copy.
- The test workspace can only be deleted from the main workspace, after a confirmation.
- **Important:** only one workspace runs at a time. While you're in the test workspace, scheduled sends in the main workspace don't fire. The app warns before switching.
- Emails sent from the test workspace are still real emails. The banner and the Settings text say so.

### Suggested way to evaluate
1. Settings → Workspace → create a test workspace (empty, or a copy of your data) → open it.
2. Settings → Team Sync → start the 7-day trial → connect GitHub → create a team in a throwaway repo, e.g. `mailwave-test`.
3. A teammate does the same on their machine and joins that repo.
4. Try things out for a week, then switch back to the main workspace and either upgrade and create the real team there, or delete the test workspace.

## How to use it (end-user steps)

1. **Settings → Team Sync.** This is a Pro feature.
2. Connect GitHub with a personal access token:
   - classic token with the `repo` scope, or
   - fine-grained token with *Contents: read/write* and *Metadata: read*. Creating the repo from the app also needs *Administration: write*.
3. **First person:** choose "Create new team" and enter the owner (you or an organisation), a repo name and a passphrase. Your existing local data becomes the team's starting data.
4. Invite teammates: type their GitHub username in "Invite a teammate", and they accept the GitHub invitation.
5. **Each teammate:** connects their own GitHub account, chooses "Join existing team", and enters the same `owner/repo` and passphrase. Their local data is merged into the team's data.
6. Send the passphrase to teammates through a separate channel. **If the passphrase is lost, the data can't be recovered.**

## Files added or changed

| File | What |
|---|---|
| `electron/github.js` | **New.** Minimal GitHub REST client (tree, blob, contents with compare-and-swap, tarball, repo create, invite, device-login flow) and a small tar.gz reader |
| `electron/teamStore.js` | **New.** SQLite ⇄ portable records: uid backfill, export/hash, change collection, last-writer-wins apply |
| `electron/teamSync.js` | **New.** Engine: crypto, setup flows (connect/create/join/invite/leave), sync cycle, send locks, status |
| `electron/db.js` | `uid` columns on 5 tables, `send_history.origin_device`, `sync_state` and `sync_meta` tables, daily count only for local sends, exports the raw `handle` |
| `electron/mailer.js` | `sendCampaign` became a lock-gated wrapper around `runCampaign`. Added `run_key`, `sendWithRetry` and `reconcileSchedules` |
| `electron/main.js` | `team:*` IPC. Write handlers trigger `syncSoon()`. `team_*` settings keys are hidden from and protected against the renderer. Startup rearm now uses `reconcileSchedules` |
| `electron/preload.js` | `window.api.team.*` and `onTeamChanged` |
| `renderer/src/components/TeamSyncSettings.jsx` | **New.** Settings UI: connect, create/join, status, devices, invite, sync now, leave |
| `renderer/src/pages/Settings.jsx` | Mounts the Team Sync section |
| `renderer/src/App.jsx` | Toast when teammates' changes arrive. Dashboard and History reload |
| `electron/workspace.js` | **New.** Main/test workspace directories, create (empty or copy), switch, delete, shared `app-state.json` |
| `electron/trial.js` | **New.** 7-day Team Sync trial: start once, status, `teamAllowed()` |
| `electron/db.js`, `electron/settings.js` | Paths now come from `workspace.dataDir()`. The main workspace keeps the old location, so existing installs are unaffected |
| `renderer/src/components/WorkspaceSettings.jsx` | **New.** Workspace section in Settings |
| `renderer/src/components/TeamSyncSettings.jsx` | Trial button, days-left notice, trial-ended state |
| `renderer/src/App.jsx` | Test-workspace banner |

## Testing done

- A two-device end-to-end test against a **fake in-memory GitHub** that enforces real compare-and-swap rules, run under Electron's Node with the real `better-sqlite3`. It covers:
  - creating a team, and checking the repo holds no plaintext
  - wrong passphrase rejected on join
  - join pulls subscribers, groups, templates, campaigns and history, with group ids remapped
  - local data merges upward
  - edits, deletes and schedules propagate, and an idle sync pushes nothing (no echo)
  - concurrent edits settle to the same version on both devices (last writer wins)
  - locks: exclusive, same run not repeated, a simultaneous race has exactly one winner, offline fails closed
  - member list, and leaving the team keeps local data
  - mailer: the lock gate refuses a send, the lock is released after a failed run, schedule timers follow the synced `scheduled_at`
- Trial: blocked without Pro or trial, sends fall back to local mode, starting enables sync, it expires after 7 days, it can't be restarted, and Pro overrides an ended trial.
- Test workspace: copy is created, team settings aren't copied, the app reopens in the test workspace with copied data, copied schedules are cleared, the main workspace is untouched by test edits, and delete is refused from inside the test workspace.
- Tar.gz reader tested on a pax tarball and on a `git archive` tarball (the same format GitHub uses).
- The app boots with a fresh profile, and the migrations add the new columns.
- The renderer builds (`vite build`).
- **Not yet tested:** real github.com, the Settings UI clicked through by hand, and the real app restart when switching workspace (`app.relaunch()`).

The test script isn't committed. It lives in the session scratchpad and can be added as `electron/__tests__/teamSync.test.js` if you want it in the repo.

## Not done yet (known gaps)

1. **A live test against real GitHub.** Try it with two machines or two profiles (`electron . --user-data-dir=/tmp/mw2`).
2. **Device-login button.** `GITHUB_CLIENT_ID` in `electron/github.js` is empty, so users paste a token for now. To enable the "Sign in with GitHub" button: register an OAuth App, tick "Enable Device Flow", and paste its client id there.
3. **Compaction / snapshots.** Event files build up forever. Each device should periodically write a snapshot and old chunks should be pruned. Until then, the tarball download keeps first join fast.
4. **Attachments** aren't uploaded. A teammate who sends a campaign with attachments sends it *without* them, because the file path doesn't exist on their machine. Fix: upload encrypted attachment blobs to `attachments/<hash>.mwe`.
5. **Remote stop.** "Stop" only stops a send running on this machine. A `stop_requested` state in the lock file would let a teammate stop it.
6. **Editing pages don't live-refresh.** Subscribers and Templates show a toast; the user switches page to see teammates' changes. Dashboard, History and the Campaigns list reload automatically (the Campaigns list only while no editor or send screen is open). Refresh isn't automatic elsewhere to avoid wiping an open form.
7. **Rotating the passphrase or removing a member.** Removing someone from the GitHub repo cuts off their access to new data. They still hold the key and any data they already downloaded. Rotating means re-encrypting everything under a new key; there's no UI for it yet.
8. **Per-field merge.** Conflicts resolve per record, not per field (see "Conflicts").
9. **Roles.** Anyone with push access can edit or delete anything. There's no read-only member role; GitHub's read permission would work for pulling, but pushing edits would then fail.
10. **SMTP identity.** Whichever device wins the lock sends through **its own** SMTP settings. Teams should use the same sender account, or agree who sends. With separate accounts, the campaign's From address must be verified on every account (Brevo rejects unverified senders), or a scheduled send that fires on a teammate's machine fails.

11. **Tamper-proof trial.** See the trial limitation above.
12. **Both workspaces running at once.** Not supported: main-workspace schedules pause while you're in the test workspace.

## Possible next steps

- **Pluggable backends.** `teamSync` only needs "list files, read a file, create a file, compare-and-swap a file". The same engine could run on GitLab, Gitea/Forgejo (self-hosted), S3/R2 (conditional PUT) or WebDAV/Nextcloud with little change. Gitea is interesting for organisations that want everything on their own hardware.
- **Hybrid with `team-backend/`.** A cheap cron (such as the existing GitHub Actions workflow) could act as an "always-on member" that sends scheduled campaigns when every laptop is off. It would need the team key, which moves trust to that runner.
- **Activity feed.** Events already carry device and time, so a "Bob edited campaign X, 5 min ago" view is cheap to build.
- **Shared team defaults.** Sync non-secret settings such as the from name, batch size and daily limit as a `team_settings` record.

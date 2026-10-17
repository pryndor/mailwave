import { useEffect, useState } from 'react'
import { Users, RefreshCw, LogIn, Lock } from 'lucide-react'
import toast from 'react-hot-toast'

const h3Style = { fontSize: 14, color: 'var(--text-h)', marginBottom: 4, paddingBottom: 8, borderBottom: '1px solid var(--border)' }
const dim = { fontSize: 12, color: 'var(--text-dim)' }

// Team Sync — share subscribers, campaigns, templates, schedules and send
// history with teammates through a private GitHub repo. All state lives in
// the main process (team:* IPC); this component only drives the setup flow.
export default function TeamSyncSettings() {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [deviceCode, setDeviceCode] = useState(null)
  const [mode, setMode] = useState('join')
  const [form, setForm] = useState({ owner: '', repo: 'mailwave-team', teamName: '', passphrase: '', confirm: '', deviceName: '' })
  const [inviteUser, setInviteUser] = useState('')

  const load = () => window.api.team.status().then(s => {
    setSt(s)
    setForm(f => ({ ...f, owner: f.owner || s.login || '', deviceName: f.deviceName || s.deviceName || '' }))
  })
  useEffect(() => {
    load()
    const unsub = window.api.onTeamChanged(() => load())
    return unsub
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const run = async (fn, okMsg) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r && r.ok === false) { toast.error(r.error); return r }
    if (okMsg) toast.success(okMsg)
    load()
    return r
  }

  const connectToken = () => run(() => window.api.team.connect(token.trim()), 'Connected to GitHub').then(() => setToken(''))

  const deviceLogin = async () => {
    const r = await window.api.team.deviceLoginStart()
    if (!r.ok) { toast.error(r.error); return }
    setDeviceCode(r)
    await run(() => window.api.team.deviceLoginWait(), 'Connected to GitHub')
    setDeviceCode(null)
  }

  const submitTeam = () => {
    if (mode === 'create' && form.passphrase !== form.confirm) { toast.error('Passphrases do not match'); return }
    const data = { owner: form.owner.trim(), repo: form.repo.trim(), teamName: form.teamName.trim(), passphrase: form.passphrase, deviceName: form.deviceName.trim() }
    const call = mode === 'create' ? window.api.team.create(data) : window.api.team.join(data)
    run(() => call, mode === 'create' ? 'Team created — share the repo name and passphrase with teammates' : 'Joined team')
      .then(r => { if (r?.ok) setForm(f => ({ ...f, passphrase: '', confirm: '' })) })
  }

  if (!st) return null

  return (
    <section>
      <h3 style={h3Style}>
        <Users size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        Team Sync <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>— share data with teammates through a private GitHub repo</span>
      </h3>

      {!st.allowed && (
        <div style={{ marginTop: 12 }}>
          <p style={{ ...dim, marginBottom: 10 }}>
            {st.trial.ended
              ? `Your ${st.trial.days}-day Team Sync trial ended on ${new Date(st.trial.endsAt).toLocaleDateString()}. Your data is kept on this computer, but syncing is paused until you upgrade to Pro.`
              : 'Several people can work on one set of subscribers, campaigns and schedules. Everything is end-to-end encrypted and no MailWave server is involved. Team Sync is part of Pro.'}
          </p>
          <div className="form-row">
            {st.trial.available && (
              <button className="btn btn-primary" disabled={busy} onClick={() => run(() => window.api.team.startTrial(), `Team Sync trial started: ${st.trial.days} days`)}>
                Start free {st.trial.days}-day trial
              </button>
            )}
            <button className={st.trial.available ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => window.api.license.openUpgrade()}>
              Upgrade to Pro
            </button>
            {st.enabled && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => {
                if (window.confirm('Leave this team? Your local data stays on this computer.')) run(() => window.api.team.leave(), 'Left team')
              }}>Leave team</button>
            )}
          </div>
          {st.trial.available && (
            <p style={{ ...dim, marginTop: 8 }}>
              Tip: create a test workspace below first, so you can try it with a test team without touching your real data.
            </p>
          )}
        </div>
      )}

      {st.allowed && !st.pro && st.trial.active && (
        <p style={{ fontSize: 12, color: '#e0a020', marginTop: 12 }}>
          Free trial: {st.trial.daysLeft} day{st.trial.daysLeft === 1 ? '' : 's'} left (ends {new Date(st.trial.endsAt).toLocaleDateString()}).
          {' '}<a href="#" onClick={e => { e.preventDefault(); window.api.license.openUpgrade() }}>Upgrade to Pro</a> to keep syncing after that.
        </p>
      )}

      {st.allowed && !st.connected && (
        <div style={{ marginTop: 12 }}>
          <p style={{ ...dim, marginBottom: 10 }}>
            Step 1: connect GitHub. Each teammate uses their own GitHub account. The team shares one private repo.
          </p>
          {st.hasDeviceFlow && (
            <div className="form-row" style={{ marginBottom: 8 }}>
              <button className="btn btn-primary" onClick={deviceLogin} disabled={busy}>
                <LogIn size={14} /> Sign in with GitHub
              </button>
              {deviceCode && (
                <span style={{ fontSize: 13, alignSelf: 'center' }}>
                  Enter code <strong style={{ fontFamily: 'monospace', fontSize: 15 }}>{deviceCode.user_code}</strong> at {deviceCode.verification_uri}
                </span>
              )}
            </div>
          )}
          <div className="form-row">
            <input className="input" type="password" placeholder="GitHub personal access token (classic with 'repo' scope, or fine-grained with Contents read/write)"
              value={token} onChange={e => setToken(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={connectToken} disabled={busy || !token.trim()}>
              {busy ? 'Checking...' : 'Connect'}
            </button>
          </div>
          <p style={{ ...dim, marginTop: 6 }}>Create one at github.com → Settings → Developer settings → Personal access tokens.</p>
        </div>
      )}

      {st.allowed && st.connected && !st.enabled && (
        <div style={{ marginTop: 12 }}>
          <p style={{ ...dim, marginBottom: 10 }}>
            Connected as <strong>{st.login}</strong>. Step 2: create a new team or join an existing one.
            {' '}<a href="#" onClick={e => { e.preventDefault(); run(() => window.api.team.disconnect()) }}>Disconnect</a>
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[['join', 'Join existing team'], ['create', 'Create new team']].map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                style={{
                  padding: '7px 16px', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  border: `1px solid ${mode === k ? 'var(--accent)' : 'var(--border)'}`,
                  background: mode === k ? 'var(--accent-bg)' : 'var(--bg3)',
                  color: mode === k ? 'var(--accent)' : 'var(--text)',
                }}>{label}</button>
            ))}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Repo owner <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(user or organisation)</span></label>
              <input className="input" value={form.owner} onChange={e => set('owner', e.target.value)} placeholder={st.login} />
            </div>
            <div className="form-group">
              <label>Repo name</label>
              <input className="input" value={form.repo} onChange={e => set('repo', e.target.value)} placeholder="mailwave-team" />
            </div>
          </div>
          {mode === 'create' && (
            <div className="form-group">
              <label>Team name</label>
              <input className="input" value={form.teamName} onChange={e => set('teamName', e.target.value)} placeholder="Acme Marketing" />
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Team passphrase <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(encrypts all data)</span></label>
              <input className="input" type="password" value={form.passphrase} onChange={e => set('passphrase', e.target.value)} />
            </div>
            {mode === 'create' ? (
              <div className="form-group">
                <label>Confirm passphrase</label>
                <input className="input" type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)} />
              </div>
            ) : (
              <div className="form-group">
                <label>This device's name</label>
                <input className="input" value={form.deviceName} onChange={e => set('deviceName', e.target.value)} />
              </div>
            )}
          </div>
          {mode === 'create' && (
            <div className="form-group">
              <label>This device's name</label>
              <input className="input" value={form.deviceName} onChange={e => set('deviceName', e.target.value)} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--accent-bg)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 12, fontSize: 12, color: 'var(--text-dim)' }}>
            <Lock size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
            <span>
              Data is encrypted on this computer before upload, so GitHub only stores unreadable files.
              {mode === 'create'
                ? ' Keep the passphrase safe. If it is lost, nobody (including us) can recover the team data. Your existing local data will be uploaded as the team\'s starting data.'
                : ' Your local data will be merged with the team\'s data. Where the same record was edited in both places, the most recent edit wins.'}
              {' '}SMTP passwords and license keys are never synced.
            </span>
          </div>
          <button className="btn btn-primary" onClick={submitTeam}
            disabled={busy || !form.repo.trim() || !form.passphrase || (mode === 'create' && !form.confirm)}>
            {busy ? 'Working...' : mode === 'create' ? 'Create team' : 'Join team'}
          </button>
        </div>
      )}

      {st.allowed && st.enabled && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, marginBottom: 6 }}>
            <strong style={{ color: st.lastError ? '#e0a020' : '#22c55e' }}>{st.lastError ? 'Sync problem' : 'Syncing'}</strong>
            {' — '}{st.teamName} · <span style={{ fontFamily: 'monospace' }}>{st.owner}/{st.repo}</span> · this device: {st.deviceName}
          </p>
          <p style={{ ...dim, marginBottom: 6 }}>
            Last sync: {st.lastSync ? new Date(st.lastSync).toLocaleString() : 'never'}
            {!st.keychain && ' · OS keychain unavailable, GitHub token is stored unencrypted in settings.json'}
          </p>
          {st.lastError && <p style={{ fontSize: 12, color: '#e0a020', marginBottom: 8 }}>{st.lastError}</p>}

          <div className="form-row" style={{ marginBottom: 12 }}>
            <button className="btn btn-ghost" onClick={() => run(() => window.api.team.syncNow(), 'Synced')} disabled={busy}>
              <RefreshCw size={14} /> Sync now
            </button>
            <button className="btn btn-ghost" onClick={() => {
              if (window.confirm('Leave this team? Your local data stays on this computer, but it stops syncing.')) run(() => window.api.team.leave(), 'Left team')
            }} disabled={busy}>
              Leave team
            </button>
          </div>

          <div className="form-group">
            <label>Devices in this team</label>
            <div style={{ fontSize: 12 }}>
              {st.members.length === 0 && <span style={dim}>Loading after first sync…</span>}
              {st.members.map(m => (
                <div key={m.id} style={{ padding: '4px 0', color: m.me ? 'var(--accent)' : 'var(--text)' }}>
                  {m.name} <span style={dim}>— {m.login}{m.me ? ' (this device)' : ''}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Invite a teammate <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(needs admin rights on the repo)</span></label>
            <div className="form-row">
              <input className="input" placeholder="GitHub username" value={inviteUser} onChange={e => setInviteUser(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-ghost" disabled={busy || !inviteUser.trim()}
                onClick={() => run(() => window.api.team.invite(inviteUser), `Invitation sent to ${inviteUser}`).then(() => setInviteUser(''))}>
                Invite
              </button>
            </div>
            <p style={{ ...dim, marginTop: 6 }}>
              They accept the GitHub invitation, then choose "Join existing team" here with repo <strong>{st.owner}/{st.repo}</strong> and the team passphrase. Send the passphrase separately, not in the GitHub invite.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

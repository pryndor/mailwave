import { useEffect, useState } from 'react'
import { Plug, Copy, RefreshCw, Lock } from 'lucide-react'
import toast from 'react-hot-toast'

const h3Style = { fontSize: 14, color: 'var(--text-h)', marginBottom: 4, paddingBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }
const dim = { fontSize: 12, color: 'var(--text-dim)' }

const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('')

// Settings → Automation API: the local HTTP bridge (electron/automation-server.js)
// that n8n, cron scripts and the like use to create, send and schedule campaigns.
// Listens on 127.0.0.1 only; every request needs the token. Pro.
export default function AutomationSettings() {
  const [cfg, setCfg]   = useState(null)
  const [port, setPort] = useState('8787')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.automation.get().then(c => { setCfg(c); setPort(String(c.port)) })
  }, [])

  const save = async (changes) => {
    setBusy(true)
    const r = await window.api.automation.save({ enabled: cfg.enabled, port, token: cfg.token, ...changes })
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setCfg(r)
    setPort(String(r.port))
    if (r.error) toast.error(r.error)
    else if (r.running) toast.success(`Automation API running on port ${r.port}`)
    else toast.success('Automation API turned off')
  }

  const copy = async (text, what) => {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  }

  if (!cfg) return null
  const base = `http://127.0.0.1:${cfg.port}`
  const example = `curl -H "Authorization: Bearer ${show ? cfg.token : '<token>'}" ${base}/campaigns`

  return (
    <section>
      <h3 style={h3Style}>
        <Plug size={14} /> Automation API
        <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>— let n8n, Zapier-style tools or scripts send and schedule campaigns</span>
      </h3>

      {!cfg.pro ? (
        <p style={{ ...dim, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={12} /> The Automation API is a Pro feature. Activate a license above to use it.
        </p>
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={cfg.enabled} disabled={busy}
              onChange={e => save({ enabled: e.target.checked, token: cfg.token || newToken() })} />
            Turn on the Automation API
            {cfg.enabled && (
              <span className={`badge ${cfg.running ? 'badge-green' : 'badge-red'}`} style={{ marginLeft: 6 }}>
                {cfg.running ? 'running' : 'not running'}
              </span>
            )}
          </label>
          {cfg.error && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{cfg.error}</p>}

          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label>Port</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} style={{ width: 110 }} />
                <button className="btn btn-ghost btn-sm" disabled={busy || port === String(cfg.port)} onClick={() => save({})}>Apply</button>
              </div>
            </div>
            <div className="form-group">
              <label>Access token</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" readOnly value={cfg.token ? (show ? cfg.token : '•'.repeat(24)) : '(created when you turn it on)'}
                  style={{ fontFamily: 'monospace', fontSize: 12 }} />
                <button className="btn btn-ghost btn-sm" disabled={!cfg.token} onClick={() => setShow(v => !v)}>{show ? 'Hide' : 'Show'}</button>
                <button className="btn btn-ghost btn-sm" disabled={!cfg.token} onClick={() => copy(cfg.token, 'Token')}><Copy size={12} /></button>
                <button className="btn btn-ghost btn-sm" disabled={busy || !cfg.token} title="Make a new token; the old one stops working"
                  onClick={() => { if (confirm('Make a new token? Anything using the old one will stop working.')) save({ token: newToken() }) }}>
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>
          </div>

          <p style={dim}>
            Only programs on this computer can reach it ({base}), and every request needs the token as
            {' '}<code>Authorization: Bearer &lt;token&gt;</code>. MailWave must be running. Endpoints: campaigns (list, create, send,
            schedule), templates, groups, daily stats, and AI drafts, reviews and reports. See the README for the full list.
          </p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <code style={{ fontSize: 11, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 'var(--radius)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{example}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(`curl -H "Authorization: Bearer ${cfg.token}" ${base}/campaigns`, 'Example')}><Copy size={12} /></button>
          </div>
        </>
      )}
    </section>
  )
}

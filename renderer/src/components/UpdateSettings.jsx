import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

const h3Style = { fontSize: 14, color: 'var(--text-h)', marginBottom: 4, paddingBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }
const dim = { fontSize: 12, color: 'var(--text-dim)' }
const fmt = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never'

// Settings → Updates: checks GitHub for a newer release (electron/updates.js).
// Notify only: the user downloads and installs the new version.
export default function UpdateSettings() {
  const [st, setSt]     = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { window.api.updates.status().then(setSt) }, [])
  useEffect(() => window.api.onUpdateAvailable(() => window.api.updates.status().then(setSt)), [])

  const checkNow = async () => {
    setBusy(true)
    const r = await window.api.updates.check()
    setBusy(false)
    setSt(r)
    if (!r.result.ok) toast.error(r.result.error)
    else if (!r.result.available) toast.success('You have the latest version')
  }

  if (!st) return null
  const r = st.result

  return (
    <section>
      <h3 style={h3Style}><Download size={14} /> Updates</h3>
      <p style={{ ...dim, marginBottom: 12 }}>MailWave checks GitHub once a day for a new version and tells you when one is out. It only asks GitHub which version is newest; nothing about you or your data is sent.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>Installed version: <strong>{st.current}</strong></span>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={checkNow}><RefreshCw size={12} className={busy ? 'spin' : ''} /> {busy ? 'Checking…' : 'Check now'}</button>
        <span style={dim}>Last checked: {fmt(st.last_check)}</span>
      </div>

      {r?.ok && r.available && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: r.notes ? 8 : 0 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-h)', fontSize: 13 }}>{r.name} is available</div>
              {r.published_at && <div style={dim}>Released {fmt(r.published_at)}</div>}
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => window.api.updates.open(r.url)}><Download size={12} /> Download</button>
          </div>
          {r.notes && <pre style={{ ...dim, whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: 180, overflow: 'auto', margin: 0 }}>{r.notes}</pre>}
          <p style={{ ...dim, marginTop: 8 }}>To update: download the file for your system, quit MailWave from the tray icon, then replace the old app with the new one. Your data is kept.</p>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={st.auto} onChange={async e => setSt(await window.api.updates.setAuto(e.target.checked))} />
        Check for updates automatically
      </label>
    </section>
  )
}

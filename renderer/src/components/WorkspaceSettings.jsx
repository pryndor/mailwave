import { useEffect, useState } from 'react'
import { FlaskConical, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

const h3Style = { fontSize: 14, color: 'var(--text-h)', marginBottom: 4, paddingBottom: 8, borderBottom: '1px solid var(--border)' }
const dim = { fontSize: 12, color: 'var(--text-dim)' }

// Main vs. test workspace. The test workspace has its own database and
// settings next to the real ones, e.g. for trying Team Sync without touching real data.
export default function WorkspaceSettings() {
  const [ws, setWs] = useState(null)
  const [copyData, setCopyData] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => window.api.workspace.info().then(setWs)
  useEffect(() => { load() }, [])

  const call = async (fn, okMsg) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r && r.ok === false) { toast.error(r.error); return }
    if (okMsg) toast.success(okMsg)
    load()
  }

  const switchTo = (name) => {
    const msg = name === 'test'
      ? 'MailWave will restart in the test workspace. Scheduled sends in your main workspace will NOT run until you switch back. Continue?'
      : 'MailWave will restart in your main workspace. Continue?'
    if (window.confirm(msg)) call(() => window.api.workspace.switchTo(name))
  }

  if (!ws) return null
  const inTest = ws.current === 'test'

  return (
    <section>
      <h3 style={h3Style}>
        <FlaskConical size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        Workspace <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>: try things out without touching your real data</span>
      </h3>

      <p style={{ fontSize: 13, margin: '12px 0 8px' }}>
        You are in the <strong style={{ color: inTest ? '#e0a020' : '#22c55e' }}>{inTest ? 'test workspace' : 'main workspace'}</strong>.
        {ws.testExists && ws.testCreatedAt && <span style={dim}> Test workspace created {new Date(ws.testCreatedAt).toLocaleDateString()}{ws.testCopiedData ? ' from a copy of your data' : ' empty'}.</span>}
      </p>

      {inTest && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(224,160,32,0.08)', border: '1px solid rgba(224,160,32,0.3)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 12, fontSize: 12, color: 'var(--text-dim)' }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: '#e0a020' }} />
            <span>
              Everything here is separate from your main data. Emails sent from this workspace are still <strong>real emails</strong> to real addresses.
              Scheduled sends in your main workspace are paused while you're here.
            </span>
          </div>
          <button className="btn btn-primary" onClick={() => switchTo('main')} disabled={busy}>Switch back to main workspace</button>
        </>
      )}

      {!inTest && !ws.testExists && (
        <>
          <p style={{ ...dim, marginBottom: 10 }}>
            Creates a second, separate workspace next to your real one. Use it to try Team Sync (free for 7 days) with a test team repo.
            Your SMTP and license settings are copied. Team settings are not.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" checked={!copyData} onChange={() => setCopyData(false)} /> Start empty
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
            <input type="radio" checked={copyData} onChange={() => setCopyData(true)} /> Start with a copy of my current subscribers, templates and campaigns
          </label>
          <button className="btn btn-ghost" onClick={() => call(() => window.api.workspace.createTest({ copyData }), 'Test workspace created')} disabled={busy}>
            {busy ? 'Creating...' : 'Create test workspace'}
          </button>
        </>
      )}

      {!inTest && ws.testExists && (
        <div className="form-row">
          <button className="btn btn-primary" onClick={() => switchTo('test')} disabled={busy}>Open test workspace</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => {
            if (window.confirm('Delete the test workspace and all its data? Your main workspace is not affected. This cannot be undone.'))
              call(() => window.api.workspace.deleteTest(), 'Test workspace deleted')
          }}>Delete test workspace</button>
        </div>
      )}
    </section>
  )
}

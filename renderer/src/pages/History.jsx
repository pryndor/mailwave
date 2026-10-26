import { useEffect, useState } from 'react'
import { Clock, CheckCircle, XCircle, Sparkles, RefreshCw, AlertTriangle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import useAiConfig from '../hooks/useAiConfig.js'

export default function History() {
  const [rows, setRows]     = useState([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(1)
  const [campId, setCampId] = useState('')
  const [campaigns, setCampaigns] = useState([])

  useEffect(() => { window.api.campaigns.list().then(setCampaigns) }, [])

  useEffect(() => {
    window.api.history.list({ campaign_id: campId || null, page, limit: 100 })
      .then(d => { setRows(d.rows); setTotal(d.total) })
  }, [campId, page])

  const campaign = campaigns.find(c => String(c.id) === String(campId))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: 18, color: 'var(--text-h)', fontWeight: 700 }}>Send History</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>{total} total records</p>
        </div>
        <select className="select" style={{ width: 200 }} value={campId} onChange={e => { setCampId(e.target.value); setPage(1) }}>
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {campaign && <CampaignInsights key={campaign.id} campaign={campaign} />}
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Campaign</th>
              <th>Status</th>
              <th>Error</th>
              <th>Sent At</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6}><div className="empty-state"><Clock size={32} /><span>No send history yet</span></div></td></tr>
            ) : rows.map(r => (
              <tr key={r.id}>
                <td style={{ color: 'var(--text-h)' }}>{r.email}</td>
                <td>{r.name || '—'}</td>
                <td style={{ color: 'var(--text-dim)' }}>{r.campaign_name}</td>
                <td>
                  {r.status === 'sent'
                    ? <span className="badge badge-green"><CheckCircle size={10} /> sent</span>
                    : <span className={`badge ${r.status === 'bounced' ? 'badge-yellow' : 'badge-red'}`}><XCircle size={10} /> {r.status}</span>}
                </td>
                <td style={{ color: 'var(--danger)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error || '—'}</td>
                <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{r.sent_at?.replace('T', ' ').slice(0,19)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {total > 100 && (
          <div style={{ padding: '12px 20px', display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
            <span style={{ padding: '4px 10px', fontSize: 12, color: 'var(--text-dim)' }}>Page {page} · {total} total</span>
            <button className="btn btn-ghost btn-sm" disabled={page * 100 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}

const dim = { fontSize: 12, color: 'var(--text-dim)' }

// For one campaign: why sends failed (rule-based, free) and an AI report on
// how it did and what to do next (Pro).
function CampaignInsights({ campaign }) {
  const { config, ready } = useAiConfig()
  const [failures, setFailures] = useState([])
  const [report, setReport]     = useState(null)
  const [busy, setBusy]         = useState(false)

  useEffect(() => { window.api.history.failures(campaign.id).then(setFailures) }, [campaign.id])

  const runReport = async () => {
    setBusy(true)
    const r = await window.api.ai.report({ campaign_id: campaign.id })
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setReport(r)
  }

  const failedTotal = failures.reduce((n, f) => n + f.count, 0)

  return (
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {failedTotal > 0 && (
        <div>
          <div style={{ ...dim, fontWeight: 600, marginBottom: 6 }}>WHY {failedTotal} SEND{failedTotal > 1 ? 'S' : ''} FAILED</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {failures.map(f => (
              <div key={f.kind} style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-h)', fontWeight: 500 }}>{f.label}</span>
                  <span>{f.count}</span>
                </div>
                <div style={{ ...dim, marginTop: 2 }}>{f.fix}</div>
                {f.example && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.example}>e.g. {f.example}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!report ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" disabled={!ready || !config?.pro || busy} onClick={runReport}
            title={!ready ? 'Turn on AI in Settings first' : !config?.pro ? 'AI reports are a Pro feature' : 'Summarise results and suggest next steps'}>
            {busy ? <><RefreshCw size={12} className="spin" /> Analysing…</> : <><Sparkles size={12} /> AI campaign report</>}
          </button>
          <span style={dim}>
            {!config?.pro ? 'Pro: a plain-language summary of how this campaign did, and what to do next.'
              : 'Uses send counts, failure causes, Brevo opens/clicks if connected, and your past campaigns. No subscriber addresses are sent.'}
          </span>
        </div>
      ) : (
        <div style={{ padding: 14, background: 'var(--accent-bg)', borderRadius: 'var(--radius)', position: 'relative' }}>
          <button onClick={() => setReport(null)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={14} /></button>
          <div style={{ fontSize: 14, color: 'var(--text-h)', fontWeight: 600, marginBottom: 6, paddingRight: 24 }}>
            <Sparkles size={13} style={{ verticalAlign: -1, marginRight: 6 }} color="var(--accent)" />{report.headline}
          </div>
          <div style={{ ...dim, marginBottom: 10 }}>
            {report.stats.sent} sent · {report.stats.bounced} bounced · {report.stats.failed} other failures
            {report.stats.brevo && ` · ${report.stats.brevo.open_rate}% opened · ${report.stats.brevo.click_rate}% clicked`}
          </div>
          <ReportList title="Went well" items={report.went_well} color="var(--success)" />
          <ReportList title="Went badly" items={report.went_badly} color="var(--danger)" />
          <ReportList title="Likely causes" items={report.likely_causes} color="var(--warning)" />
          {report.next_steps?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ ...dim, fontWeight: 600, marginBottom: 4 }}>NEXT STEPS</div>
              {report.next_steps.map((n, i) => (
                <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                  {i + 1}. {n.action} <span style={dim}>— {n.why}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ ...dim, marginTop: 8 }}><AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />AI analysis: advice based on the numbers above, check before acting on it.</div>
        </div>
      )}
    </div>
  )
}

function ReportList({ title, items, color }) {
  if (!items?.length) return null
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ ...dim, fontWeight: 600, marginBottom: 2 }}>{title.toUpperCase()}</div>
      {items.map((t, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text)', paddingLeft: 10, borderLeft: `2px solid ${color}`, marginBottom: 3 }}>{t}</div>)}
    </div>
  )
}

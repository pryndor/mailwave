import { useEffect, useState } from 'react'
import { Clock, CheckCircle, XCircle } from 'lucide-react'

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
                    : <span className="badge badge-red"><XCircle size={10} /> {r.status}</span>}
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

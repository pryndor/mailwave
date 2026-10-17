import { useEffect, useState } from 'react'
import { X, RefreshCw, Mail, MousePointer, TrendingUp, AlertCircle, UserMinus, ShieldAlert } from 'lucide-react'

export default function CampaignMetrics({ campaign, onClose }) {
  const [metrics, setMetrics] = useState(null)
  const [abA, setAbA]         = useState(null)
  const [abB, setAbB]         = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const isAB = !!(campaign.ab_subject_b?.trim())

  const load = async () => {
    setLoading(true); setError('')
    if (isAB) {
      // Fetch both variants separately
      const [rA, rB] = await Promise.all([
        window.api.brevo.campaignMetrics(campaign.id, 'a'),
        window.api.brevo.campaignMetrics(campaign.id, 'b'),
      ])
      if (rA.ok) setAbA(rA)
      if (rB.ok) setAbB(rB)
      if (!rA.ok) setError(rA.error)
    } else {
      const r = await window.api.brevo.campaignMetrics(campaign.id)
      if (r.ok) setMetrics(r)
      else setError(r.error)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const MetricCard = ({ label, value, sub, icon: Icon, color }) => (
    <div style={{ background: 'var(--bg3)', borderRadius: 'var(--radius)', padding: '14px 16px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
        <Icon size={13} color={color || 'var(--text-dim)'} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-h)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  const VariantBlock = ({ label, subject, data, highlight }) => (
    <div style={{
      flex: 1, border: `2px solid ${highlight ? 'var(--success)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)', padding: 16, position: 'relative',
    }}>
      {highlight && (
        <div style={{ position: 'absolute', top: -10, left: 12, background: 'var(--success)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
          WINNER
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14, fontStyle: 'italic' }}>"{subject}"</div>
      {data ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { l: 'Delivered', v: data.delivered },
            { l: 'Opens', v: `${data.opens} (${data.open_rate}%)` },
            { l: 'Clicks', v: `${data.clicks} (${data.click_rate}%)` },
            { l: 'Bounces', v: data.bounces },
          ].map(({ l, v }) => (
            <div key={l} style={{ background: 'var(--bg3)', padding: '8px 10px', borderRadius: 'var(--radius)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-h)' }}>{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No data yet</p>
      )}
    </div>
  )

  const winner = abA && abB
    ? (abA.open_rate >= abB.open_rate ? 'a' : 'b')
    : null

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Campaign Metrics</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
              <RefreshCw size={12} /> Refresh
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}>
              <X size={18} />
            </button>
          </div>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 20 }}>
          {campaign.name} · {campaign.subject}
          {isAB && <span className="badge badge-blue" style={{ marginLeft: 8 }}>A/B Test</span>}
        </p>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>Loading metrics from Brevo...</div>}

        {error && !loading && (
          <div style={{ padding: 16, background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 13 }}>
            {error.includes('No API key')
              ? 'Add your Brevo API key in Settings to view metrics.'
              : `Error: ${error}`}
          </div>
        )}

        {!loading && !error && !isAB && metrics && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              <MetricCard label="Delivered"  value={metrics.delivered}  sub={`of ${metrics.requests} sent`}     icon={Mail}        color="var(--accent)"   />
              <MetricCard label="Open Rate"  value={`${metrics.open_rate}%`}  sub={`${metrics.opens} unique opens`}  icon={TrendingUp}  color="var(--success)"  />
              <MetricCard label="Click Rate" value={`${metrics.click_rate}%`} sub={`${metrics.clicks} unique clicks`}icon={MousePointer}color="var(--warning)"  />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
              <MetricCard label="Bounced"      value={metrics.bounces}      sub="hard + soft bounces" icon={AlertCircle}  color="var(--danger)"   />
              <MetricCard label="Unsubscribed" value={metrics.unsubscribed} sub="via email client"    icon={UserMinus}   color="var(--warning)"  />
              <MetricCard label="Spam Reports" value={metrics.spam}         sub="marked as spam"      icon={ShieldAlert} color="var(--danger)"   />
            </div>

            {/* Open rate bar */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
                <span>Open rate</span><span>{metrics.open_rate}%</span>
              </div>
              <div className="progress-bar-wrap">
                <div className="progress-bar" style={{ width: `${metrics.open_rate}%`, background: metrics.open_rate > 20 ? 'var(--success)' : metrics.open_rate > 10 ? 'var(--warning)' : 'var(--danger)' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Industry average: 20–25% · Good: above 25%</div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
                <span>Click rate</span><span>{metrics.click_rate}%</span>
              </div>
              <div className="progress-bar-wrap">
                <div className="progress-bar" style={{ width: `${metrics.click_rate}%`, background: 'var(--accent)' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Industry average: 2–3% · Good: above 3%</div>
            </div>
          </>
        )}

        {!loading && !error && isAB && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <VariantBlock label="Variant A" subject={campaign.subject}    data={abA} highlight={winner === 'a'} />
              <VariantBlock label="Variant B" subject={campaign.ab_subject_b} data={abB} highlight={winner === 'b'} />
            </div>
            {winner && (
              <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 'var(--radius)', fontSize: 13 }}>
                <strong style={{ color: 'var(--success)' }}>Variant {winner.toUpperCase()} wins</strong> with a higher open rate ({winner === 'a' ? abA?.open_rate : abB?.open_rate}% vs {winner === 'a' ? abB?.open_rate : abA?.open_rate}%).
                Use subject "{winner === 'a' ? campaign.subject : campaign.ab_subject_b}" for future campaigns.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

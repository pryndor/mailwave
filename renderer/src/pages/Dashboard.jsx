import { useEffect, useState } from 'react'
import { Users, Send, FileText, Clock, ArrowRight, RefreshCw, Zap, Calendar, PauseCircle, PlayCircle, Bell, AlertTriangle } from 'lucide-react'

export default function Dashboard({ onNavigate }) {
  const [stats, setStats]         = useState({ total: 0, active: 0, unsubscribed: 0, bounced: 0 })
  const [campaigns, setCampaigns]   = useState([])
  const [brevoStats, setBrevoStats] = useState(null)
  const [brevoToday, setBrevoToday] = useState(null)
  const [loadingBrevo, setLoadingBrevo] = useState(false)
  const [dailyStats, setDailyStats]     = useState(null)
  const [loadingDaily, setLoadingDaily] = useState(false)

  const loadBrevo = async () => {
    setLoadingBrevo(true)
    const [s, t] = await Promise.all([window.api.brevo.stats(), window.api.brevo.today()])
    if (s.ok) setBrevoStats(s)
    if (t.ok) setBrevoToday(t)
    setLoadingBrevo(false)
  }

  const loadDaily = async () => {
    setLoadingDaily(true)
    const d = await window.api.daily.stats()
    setDailyStats(d)
    setLoadingDaily(false)
  }

  useEffect(() => {
    window.api.subscribers.stats().then(setStats)
    window.api.campaigns.list().then(c => setCampaigns(c.slice(0, 6)))
    loadBrevo()
    loadDaily()
  }, [])

  const statCards = [
    { label: 'Total Subscribers', value: stats.total,       icon: Users, color: 'var(--accent)',  nav: 'subscribers' },
    { label: 'Active',            value: stats.active,      icon: Users, color: 'var(--success)', nav: 'subscribers' },
    { label: 'Unsubscribed',      value: stats.unsubscribed, icon: Users,color: 'var(--warning)', nav: 'subscribers' },
    { label: 'Campaigns',         value: campaigns.length,  icon: Send,  color: 'var(--text-dim)',nav: 'campaigns'   },
  ]

  // ── Local daily limit ──────────────────────────────────────────────────────
  const localLimit     = dailyStats?.daily_limit     || 300
  const localSent      = dailyStats?.sent_today       || 0
  const localRemaining = Math.max(0, localLimit - localSent)
  const localPct       = localLimit > 0 ? Math.min(100, Math.round(localSent / localLimit * 100)) : 0
  const pausedCampaigns   = dailyStats?.paused_campaigns    || []
  const scheduledCampaigns = dailyStats?.scheduled_campaigns || []

  // ── Brevo daily limit ──────────────────────────────────────────────────────
  const brevoLimit    = brevoStats?.credits_total || 300
  const brevoSent     = brevoToday?.sent          || 0
  const brevoRemaining = Math.max(0, brevoLimit - brevoSent)
  const brevoPct      = brevoLimit ? Math.min(100, Math.round(brevoSent / brevoLimit * 100)) : 0
  const hasBrevoKey   = brevoStats !== null

  // Today's agenda items
  const agendaItems = [
    ...pausedCampaigns.map(c => ({
      type: 'paused', id: c.id, name: c.name,
      detail: `Paused at ${c.sent_count}/${c.total_count}`,
      resume: c.resume_at ? `Resumes at ${fmtTime(c.resume_at)}` : 'Resume manually',
    })),
    ...scheduledCampaigns.map(c => ({
      type: 'scheduled', id: c.id, name: c.name,
      detail: `Scheduled`,
      resume: `Sends at ${fmtTime(c.send_at)}`,
    })),
  ]

  return (
    <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, color: 'var(--text-h)', fontWeight: 700 }}>Dashboard</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>Overview of your newsletter activity</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { loadBrevo(); loadDaily() }} disabled={loadingBrevo || loadingDaily}>
          <RefreshCw size={12} style={{ animation: (loadingBrevo || loadingDaily) ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {statCards.map(({ label, value, icon: Icon, color, nav }) => (
          <div key={label} className="card" style={{ cursor: 'pointer' }} onClick={() => onNavigate(nav)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{label}</span>
              <Icon size={16} color={color} />
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-h)' }}>{value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* ── Local daily limit tracker ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} color="var(--accent)" />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-h)' }}>Today's Sending</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 999 }}>Local</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadDaily} disabled={loadingDaily}>
            <RefreshCw size={12} style={{ animation: loadingDaily ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 14 }}>
          <StatBlock label="Sent Today"  value={localSent.toLocaleString()} color="var(--text-h)" />
          <StatBlock
            label="Remaining"
            value={localLimit > 0 ? localRemaining.toLocaleString() : '∞'}
            color={localLimit > 0 && localRemaining < 50 ? 'var(--danger)' : 'var(--success)'}
          />
          <StatBlock
            label="Daily Limit"
            value={localLimit > 0 ? localLimit.toLocaleString() : 'Unlimited'}
            color="var(--text-h)"
          />
        </div>

        {localLimit > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
              <span>Daily usage</span>
              <span>{localPct}%</span>
            </div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{
                width: `${localPct}%`,
                background: localPct >= 100 ? 'var(--danger)' : localPct > 75 ? 'var(--warning)' : 'var(--success)',
                transition: 'width 0.4s',
              }} />
            </div>
            {localPct >= 100 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={12} /> Daily limit reached — paused campaigns will resume tomorrow at the configured time.
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* ── Today's Agenda ── */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={14} color="var(--accent)" />
              <h3 style={{ fontSize: 14, color: 'var(--text-h)' }}>Today's Agenda</h3>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('campaigns')}>
              Campaigns <ArrowRight size={12} />
            </button>
          </div>

          {agendaItems.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <Calendar size={24} />
              <span style={{ fontSize: 12 }}>No pending or scheduled campaigns</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {agendaItems.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  padding: '10px 12px', borderRadius: 'var(--radius)',
                  background: item.type === 'paused' ? 'rgba(245,158,11,0.06)' : 'rgba(59,130,246,0.06)',
                  border: `1px solid ${item.type === 'paused' ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'}`,
                }}>
                  {item.type === 'paused'
                    ? <PauseCircle size={14} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                    : <PlayCircle  size={14} color="var(--accent)"  style={{ flexShrink: 0, marginTop: 1 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{item.detail}</div>
                    <div style={{
                      fontSize: 11, marginTop: 3,
                      color: item.type === 'paused' ? 'var(--warning)' : 'var(--accent)',
                    }}>{item.resume}</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                    background: item.type === 'paused' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                    color: item.type === 'paused' ? 'var(--warning)' : 'var(--accent)',
                    textTransform: 'uppercase', flexShrink: 0,
                  }}>
                    {item.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Recent campaigns ── */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, color: 'var(--text-h)' }}>Recent Campaigns</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('campaigns')}>
              View all <ArrowRight size={12} />
            </button>
          </div>
          {campaigns.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <Send size={28} />
              <span style={{ fontSize: 13 }}>No campaigns yet</span>
            </div>
          ) : (
            campaigns.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-h)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{c.subject}</div>
                </div>
                <StatusBadge status={c.status} />
              </div>
            ))
          )}
        </div>

      </div>

      {/* ── Brevo daily limit tracker ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} color="var(--warning)" />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-h)' }}>Brevo Daily Limit</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 999 }}>Brevo API</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadBrevo} disabled={loadingBrevo}>
            <RefreshCw size={12} style={{ animation: loadingBrevo ? 'spin 1s linear infinite' : 'none' }} />
            {loadingBrevo ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {!hasBrevoKey ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            Add your Brevo API key in{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('settings')}>Settings</button>
            {' '}to see Brevo remaining daily sends.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
            <StatBlock label="Sent Today"      value={brevoSent.toLocaleString()} color="var(--text-h)" />
            <StatBlock label="Remaining"       value={brevoRemaining.toLocaleString()} color={brevoRemaining > 50 ? 'var(--success)' : 'var(--danger)'} />
            <StatBlock label="Daily Limit"     value={brevoLimit.toLocaleString()} color="var(--text-h)" />
            <StatBlock label="Delivered Today" value={(brevoToday?.delivered || 0).toLocaleString()} color="var(--success)" />
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                <span>Daily usage</span><span>{brevoPct}%</span>
              </div>
              <div className="progress-bar-wrap">
                <div className="progress-bar" style={{
                  width: `${brevoPct}%`,
                  background: brevoPct > 80 ? 'var(--danger)' : brevoPct > 60 ? 'var(--warning)' : 'var(--success)',
                }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="card">
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 14 }}>Quick Actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            { label: 'New Campaign',      icon: Send,     nav: 'campaigns',   color: 'var(--accent)'  },
            { label: 'Add Subscribers',   icon: Users,    nav: 'subscribers', color: 'var(--success)' },
            { label: 'Create Template',   icon: FileText, nav: 'templates',   color: 'var(--warning)' },
            { label: 'View Send History', icon: Clock,    nav: 'history',     color: 'var(--text-dim)'},
          ].map(({ label, icon: Icon, nav, color }) => (
            <button key={nav} onClick={() => onNavigate(nav)} className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: 10 }}>
              <Icon size={14} color={color} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function StatBlock({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    draft:   'badge-gray',
    sending: 'badge-yellow',
    sent:    'badge-green',
    stopped: 'badge-red',
    paused:  'badge-yellow',
  }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

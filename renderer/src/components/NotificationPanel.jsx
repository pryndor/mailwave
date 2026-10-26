import { useEffect, useState, useRef } from 'react'
import { X, Bell, CheckCheck, AlertTriangle, CheckCircle, Clock, Zap, Info } from 'lucide-react'

const TYPE_META = {
  limit_reached:     { icon: AlertTriangle, color: 'var(--warning)',  label: 'Limit Reached'  },
  campaign_paused:   { icon: AlertTriangle, color: 'var(--warning)',  label: 'Paused'         },
  campaign_resumed:  { icon: Zap,           color: 'var(--accent)',   label: 'Resumed'        },
  campaign_done:     { icon: CheckCircle,   color: 'var(--success)',  label: 'Complete'       },
  daily_summary:     { icon: Info,          color: 'var(--accent)',   label: 'Daily Summary'  },
  campaign_reminder: { icon: Clock,         color: 'var(--warning)',  label: 'Reminder'       },
  ab_winner:         { icon: CheckCircle,   color: 'var(--accent)',   label: 'A/B Winner'     },
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationPanel({ onClose, onMarkRead }) {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const panelRef = useRef(null)

  useEffect(() => {
    window.api.notifications.list().then(n => { setItems(n); setLoading(false) })
  }, [])

  // Close on click outside
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const markAll = async () => {
    await window.api.notifications.markAllRead()
    setItems(prev => prev.map(n => ({ ...n, read: 1 })))
    onMarkRead()
  }

  const unread = items.filter(n => !n.read).length

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.3)',
      }} onClick={onClose} />

      {/* Panel */}
      <div ref={panelRef} style={{
        position: 'fixed', top: 0, left: 220, bottom: 0,
        width: 360, background: 'var(--bg2)',
        borderRight: '1px solid var(--border)',
        zIndex: 1000, display: 'flex', flexDirection: 'column',
        boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 16px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={16} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-h)' }}>
              Notifications
            </span>
            {unread > 0 && (
              <span style={{
                background: 'var(--danger)', color: '#fff',
                borderRadius: 999, fontSize: 10, fontWeight: 700,
                padding: '1px 6px',
              }}>{unread}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAll} title="Mark all as read">
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              <X size={13} />
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              Loading…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <Bell size={32} color="var(--text-dim)" style={{ margin: '0 auto 12px', display: 'block' }} />
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No notifications yet</div>
            </div>
          )}
          {items.map(n => {
            const meta = TYPE_META[n.type] || { icon: Bell, color: 'var(--text-dim)', label: n.type }
            const Icon = meta.icon
            return (
              <div key={n.id} style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                background: n.read ? 'transparent' : 'rgba(59,130,246,0.04)',
                display: 'flex', gap: 12, alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: `${meta.color}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon size={14} color={meta.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--text-h)' }}>
                      {n.title}
                    </span>
                    {!n.read && (
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: 'var(--accent)', flexShrink: 0, marginTop: 3,
                      }} />
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{n.body}</div>
                  {n.campaign_name && (
                    <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>
                      {n.campaign_name}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, opacity: 0.7 }}>
                    {timeAgo(n.created_at)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-dim)', textAlign: 'center',
        }}>
          Last 60 notifications · Auto-cleared after 200
        </div>
      </div>
    </>
  )
}

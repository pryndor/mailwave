import { LayoutDashboard, Users, Mail, FileText, Clock, Settings, Send, Bell, Megaphone } from 'lucide-react'

const nav = [
  { id: 'dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'subscribers', label: 'Subscribers',  icon: Users },
  { id: 'campaigns',   label: 'Campaigns',    icon: Send },
  { id: 'templates',   label: 'Templates',    icon: FileText },
  { id: 'social',      label: 'Social',       icon: Megaphone },
  { id: 'history',     label: 'Send History', icon: Clock },
  { id: 'settings',    label: 'Settings',     icon: Settings },
]

export default function Sidebar({ current, onNavigate, unreadCount = 0, onToggleNotifications }) {
  return (
    <aside style={{
      width: 220, background: 'var(--bg2)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 32, height: 32, background: 'var(--accent)', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Mail size={16} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--text-h)', fontWeight: 700, fontSize: 15 }}>MailWave</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>Email & Social</div>
          </div>
          {/* Notification bell */}
          <button
            onClick={onToggleNotifications}
            title="Notifications"
            style={{
              position: 'relative', background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, borderRadius: 6, color: unreadCount > 0 ? 'var(--accent)' : 'var(--text-dim)',
              display: 'flex', alignItems: 'center',
            }}
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: -2, right: -2,
                background: 'var(--danger)', color: '#fff',
                borderRadius: 999, fontSize: 9, fontWeight: 700,
                padding: '1px 4px', minWidth: 14, textAlign: 'center',
                lineHeight: '14px',
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 8px' }}>
        {nav.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onNavigate(id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 10px', borderRadius: 'var(--radius)',
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: current === id ? 'var(--accent-bg)' : 'transparent',
              color: current === id ? 'var(--accent)' : 'var(--text)',
              marginBottom: 2, transition: 'all 0.15s',
            }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: 11 }}>
        v1.0.0 · Local App
      </div>
    </aside>
  )
}

import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import NotificationPanel from './components/NotificationPanel.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Subscribers from './pages/Subscribers.jsx'
import Campaigns from './pages/Campaigns.jsx'
import Templates from './pages/Templates.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'
import toast, { Toaster } from 'react-hot-toast'

export default function App() {
  const [page, setPage]             = useState('dashboard')
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifs, setShowNotifs]   = useState(false)

  // Load unread count on mount and listen for new notifications
  useEffect(() => {
    const load = () => window.api.notifications.unreadCount().then(setUnreadCount)
    load()
    const unsub = window.api.onNotification(() => load())
    return unsub
  }, [])

  // Teammates' changes arrived via Team Sync. Read-only pages remount to show them.
  // Editing pages keep their state so an open form isn't wiped, and a toast tells the user.
  const [teamVersion, setTeamVersion] = useState(0)
  useEffect(() => window.api.onTeamChanged(() => {
    setTeamVersion(v => v + 1)
    toast('Teammates\' changes synced', { id: 'team-changed' })
  }), [])

  const [workspace, setWorkspace] = useState('main')
  useEffect(() => { window.api.workspace.info().then(w => setWorkspace(w.current)) }, [])

  const handleMarkRead = () => setUnreadCount(0)

  const pages = {
    dashboard:   <Dashboard key={teamVersion} onNavigate={setPage} />,
    subscribers: <Subscribers />,
    campaigns:   <Campaigns />,
    templates:   <Templates />,
    history:     <History key={teamVersion} />,
    settings:    <Settings />,
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Toaster position="top-right" toastOptions={{
        style: { background: '#1e2433', color: '#e6edf3', border: '1px solid #2a3040' }
      }} />

      <Sidebar
        current={page}
        onNavigate={setPage}
        unreadCount={unreadCount}
        onToggleNotifications={() => setShowNotifs(v => !v)}
      />

      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {workspace === 'test' && (
          <div style={{ background: 'rgba(224,160,32,0.12)', borderBottom: '1px solid rgba(224,160,32,0.35)', color: '#e0a020', fontSize: 12, padding: '6px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Test workspace</strong>: separate data, emails sent here are still real</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage('settings')}>Switch back in Settings</button>
          </div>
        )}
        {pages[page] || pages.dashboard}
      </main>

      {showNotifs && (
        <NotificationPanel
          onClose={() => setShowNotifs(false)}
          onMarkRead={handleMarkRead}
        />
      )}
    </div>
  )
}

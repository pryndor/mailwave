import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import NotificationPanel from './components/NotificationPanel.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Subscribers from './pages/Subscribers.jsx'
import Campaigns from './pages/Campaigns.jsx'
import Templates from './pages/Templates.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'
import { Toaster } from 'react-hot-toast'

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

  const handleMarkRead = () => setUnreadCount(0)

  const pages = {
    dashboard:   <Dashboard onNavigate={setPage} />,
    subscribers: <Subscribers />,
    campaigns:   <Campaigns />,
    templates:   <Templates />,
    history:     <History />,
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

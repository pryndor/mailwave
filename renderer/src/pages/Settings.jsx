import { useEffect, useState } from 'react'
import { Check, Wifi, Info, ChevronDown, ChevronUp, Bell, Zap } from 'lucide-react'
import toast from 'react-hot-toast'

// Known providers — just fills in the fields, user can always edit manually
const PROVIDERS = [
  {
    label: 'Zoho Mail India',
    host: 'smtp.zoho.in', port: 465, secure: true,
    note: 'Use an App Password from Zoho → Security → App Passwords',
  },
  {
    label: 'Zoho Mail Global',
    host: 'smtp.zoho.com', port: 465, secure: true,
    note: 'Use an App Password from Zoho → Security → App Passwords',
  },
  {
    label: 'Zoho Mail Europe',
    host: 'smtp.zoho.eu', port: 465, secure: true,
    note: 'Use an App Password from Zoho → Security → App Passwords',
  },
  {
    label: 'Gmail',
    host: 'smtp.gmail.com', port: 465, secure: true,
    note: 'Enable 2-Step Verification, then create an App Password at myaccount.google.com → Security',
  },
  {
    label: 'Outlook / Hotmail',
    host: 'smtp-mail.outlook.com', port: 587, secure: false,
    note: 'Use your Microsoft account password. If it fails, generate an App Password.',
  },
  {
    label: 'Mailcow (self-hosted)',
    host: '', port: 587, secure: false,
    note: 'Enter your Mailcow server hostname. Use your mailbox credentials.',
    placeholder: 'mail.yourdomain.com',
  },
  {
    label: 'SendGrid',
    host: 'smtp.sendgrid.net', port: 587, secure: false,
    note: 'Username is always "apikey". Password is your SendGrid API key.',
  },
  {
    label: 'Brevo (Sendinblue)',
    host: 'smtp-relay.brevo.com', port: 587, secure: false,
    note: 'Use your Brevo login email as username and your SMTP key as password.',
  },
  {
    label: 'Amazon SES',
    host: 'email-smtp.us-east-1.amazonaws.com', port: 465, secure: true,
    note: 'Use SMTP credentials from SES Console → SMTP Settings. Region varies.',
    placeholder: 'email-smtp.<region>.amazonaws.com',
  },
  {
    label: 'Custom / Other',
    host: '', port: 587, secure: false,
    note: 'Enter your SMTP server details manually.',
    placeholder: 'smtp.yourprovider.com',
  },
]

export default function Settings() {
  const [form, setForm] = useState({
    smtp_host: '', smtp_port: 587, smtp_secure: false,
    smtp_user: '', smtp_pass: '',
    from_name: '', from_email: '', reply_to: '', unsubscribe_email: '',
    batch_size: 50, batch_delay: 60, per_email_delay: 1,
    daily_send_limit: 300, daily_resume_time: '09:00',
    notify_daily_summary: true, notify_summary_time: '08:00',
    notify_campaign_reminder: true, notify_reminder_minutes: 15,
    notify_limit_reached: true, notify_campaign_done: true,
  })
  const [selectedProvider, setSelectedProvider] = useState('')
  const [providerNote, setProviderNote]         = useState('')
  const [hostPlaceholder, setHostPlaceholder]   = useState('smtp.yourprovider.com')
  const [testing, setTesting]     = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [startupEnabled, setStartupEnabled] = useState(null) // null = unknown/unsupported platform
  const [startupBusy, setStartupBusy] = useState(false)
  const [license, setLicense] = useState(null)
  const [licenseInput, setLicenseInput] = useState('')
  const [licenseBusy, setLicenseBusy] = useState(false)

  useEffect(() => {
    window.api.startup.get().then(setStartupEnabled)
  }, [])

  const loadLicense = () => window.api.license.get().then(setLicense)
  useEffect(() => { loadLicense() }, [])

  const activateLicense = async () => {
    setLicenseBusy(true)
    const r = await window.api.license.activate(licenseInput.trim())
    setLicenseBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setLicenseInput('')
    toast.success('Pro activated — thank you!')
    loadLicense()
  }

  const deactivateLicense = async () => {
    setLicenseBusy(true)
    await window.api.license.deactivate()
    setLicenseBusy(false)
    loadLicense()
  }

  const toggleStartup = async (checked) => {
    setStartupBusy(true)
    const r = await window.api.startup.set(checked)
    setStartupBusy(false)
    if (!r.ok) { toast.error(`Couldn't update startup setting: ${r.error}`); return }
    setStartupEnabled(checked)
    toast.success(checked ? 'MailWave will start automatically on login' : 'Automatic startup disabled')
  }

  useEffect(() => {
    window.api.settings.get().then(s => {
      setForm(f => ({ ...f, ...s }))
      // Try to detect which provider is set
      const match = PROVIDERS.find(p => p.host && p.host === s.smtp_host)
      if (match) {
        setSelectedProvider(match.label)
        setProviderNote(match.note || '')
      } else if (s.smtp_host) {
        setSelectedProvider('Custom / Other')
        setProviderNote('Custom SMTP server configured.')
      }
    })
  }, [])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setTestResult(null) }

  const applyProvider = (label) => {
    const p = PROVIDERS.find(x => x.label === label)
    if (!p) return
    setSelectedProvider(label)
    setProviderNote(p.note || '')
    setHostPlaceholder(p.placeholder || 'smtp.yourprovider.com')
    setForm(f => ({
      ...f,
      smtp_host:   p.host || f.smtp_host,
      smtp_port:   p.port,
      smtp_secure: p.secure,
    }))
    setTestResult(null)
  }

  const save = async () => {
    if (!form.smtp_host) { toast.error('SMTP host is required'); return }
    if (!form.smtp_user) { toast.error('Username / email is required'); return }
    await window.api.settings.save(form)
    toast.success('Settings saved')
  }

  const test = async () => {
    if (!form.smtp_host || !form.smtp_user || !form.smtp_pass) {
      toast.error('Fill in host, username and password first'); return
    }
    setTesting(true); setTestResult(null)
    const r = await window.api.settings.test(form)
    setTesting(false); setTestResult(r)
    r.ok ? toast.success('Connection successful!') : toast.error('Failed: ' + r.error)
  }

  return (
    <div style={{ padding: 24, overflow: 'auto', flex: 1, maxWidth: 740 }}>
      <h2 style={{ fontSize: 18, color: 'var(--text-h)', fontWeight: 700, marginBottom: 4 }}>Settings</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
        Configure any SMTP email provider. You can change this at any time.
      </p>

      {/* ── License ── */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          License
        </h3>

        {license?.plan === 'pro' ? (
          <div>
            <p style={{ fontSize: 13, marginBottom: 8 }}>
              <strong style={{ color: license.status === 'grace' ? '#e0a020' : '#22c55e' }}>
                {license.status === 'grace' ? 'Pro (renewal needed)' : 'Pro'}
              </strong>
              {' — '}{license.email}
              {license.status === 'active' && ` — renews ${new Date(license.expires).toLocaleDateString()} (${license.daysLeft} days)`}
              {license.status === 'grace' && ` — expired ${new Date(license.expires).toLocaleDateString()}, Pro features stop in ${license.daysLeft} day(s) unless renewed`}
            </p>
            <button className="btn btn-ghost" onClick={deactivateLicense} disabled={licenseBusy}>
              Remove License
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              {license?.reason === 'expired'
                ? `Your license expired on ${new Date(license.expiredOn).toLocaleDateString()} and the grace period has ended. Renew to restore Pro features.`
                : 'Unlock automation, smart schedule, and FTP/SFTP sync with Pro.'}
            </p>
            <div className="form-row" style={{ marginBottom: 8 }}>
              <button className="btn btn-primary" onClick={() => window.api.license.openUpgrade()}>
                Upgrade to Pro
              </button>
            </div>
            <div className="form-row">
              <input className="input" placeholder="Already have a license key? Paste it here" value={licenseInput}
                onChange={e => setLicenseInput(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={activateLicense} disabled={licenseBusy || !licenseInput.trim()}>
                {licenseBusy ? 'Checking...' : 'Activate'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Provider picker ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          Email Provider
        </h3>

        <div className="form-group">
          <label>Choose Provider <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— fills in the SMTP details below automatically</span></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {PROVIDERS.map(p => (
              <button key={p.label} onClick={() => applyProvider(p.label)}
                style={{
                  padding: '8px 12px', borderRadius: 'var(--radius)',
                  border: `1px solid ${selectedProvider === p.label ? 'var(--accent)' : 'var(--border)'}`,
                  background: selectedProvider === p.label ? 'var(--accent-bg)' : 'var(--bg3)',
                  color: selectedProvider === p.label ? 'var(--accent)' : 'var(--text)',
                  cursor: 'pointer', fontSize: 12, fontWeight: selectedProvider === p.label ? 600 : 400,
                  textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {providerNote && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--accent-bg)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 14, fontSize: 12, color: 'var(--text-dim)' }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
            <span>{providerNote}</span>
          </div>
        )}
      </section>

      <div className="divider" />

      {/* ── SMTP Details ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          SMTP Connection
        </h3>

        <div className="form-row">
          <div className="form-group">
            <label>SMTP Host</label>
            <input className="input" value={form.smtp_host}
              onChange={e => set('smtp_host', e.target.value)}
              placeholder={hostPlaceholder} />
          </div>
          <div className="form-group">
            <label>Port</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ v: 465, l: '465 (SSL)' }, { v: 587, l: '587 (TLS)' }, { v: 25, l: '25' }].map(({ v, l }) => (
                <button key={v} onClick={() => set('smtp_port', v)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 'var(--radius)',
                    border: `1px solid ${form.smtp_port === v ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.smtp_port === v ? 'var(--accent-bg)' : 'var(--bg3)',
                    color: form.smtp_port === v ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer', fontSize: 11, fontWeight: form.smtp_port === v ? 600 : 400,
                  }}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.smtp_secure} onChange={e => set('smtp_secure', e.target.checked)} />
            Use SSL/TLS encryption
            <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 11 }}>
              (required for port 465 · for port 587 leave unchecked — STARTTLS is used automatically)
            </span>
          </label>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Username / Email</label>
            <input className="input" value={form.smtp_user}
              onChange={e => set('smtp_user', e.target.value)}
              placeholder="you@yourdomain.com" />
          </div>
          <div className="form-group">
            <label>Password / App Password</label>
            <input className="input" type="password" value={form.smtp_pass}
              onChange={e => set('smtp_pass', e.target.value)}
              placeholder="Your password or app-specific password" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={test} disabled={testing}>
            {testing ? 'Testing...' : <><Wifi size={14} /> Test Connection</>}
          </button>
          {testResult && (
            testResult.ok
              ? <span style={{ color: 'var(--success)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={13} /> Connected successfully</span>
              : <span style={{ color: 'var(--danger)', fontSize: 13 }}>✗ {testResult.error}</span>
          )}
        </div>
      </section>

      <div className="divider" />

      {/* ── Sender Identity ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          Sender Identity
        </h3>
        <div className="form-row">
          <div className="form-group">
            <label>From Name</label>
            <input className="input" value={form.from_name} onChange={e => set('from_name', e.target.value)} placeholder="Your Company Name" />
          </div>
          <div className="form-group">
            <label>From Email</label>
            <input className="input" value={form.from_email} onChange={e => set('from_email', e.target.value)} placeholder="info@yourdomain.com" />
          </div>
        </div>
        <div className="form-group">
          <label>Reply-To Email <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— optional, defaults to From Email</span></label>
          <input className="input" value={form.reply_to} onChange={e => set('reply_to', e.target.value)} placeholder="support@yourdomain.com" />
        </div>
        <div className="form-group">
          <label>Unsubscribe Email <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— optional, defaults to Reply-To / From Email</span></label>
          <input className="input" value={form.unsubscribe_email} onChange={e => set('unsubscribe_email', e.target.value)} placeholder="unsubscribe@yourdomain.com" />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Every campaign includes this as a one-click List-Unsubscribe mailto link (Gmail/Outlook show it as a button). When a request comes in,
          open the subscriber in Subscribers and set their status to Unsubscribed.
        </p>
      </section>

      <div className="divider" />

      {/* ── Sending Limits ── */}
      <section>
        <button onClick={() => setShowAdvanced(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-h)', fontSize: 14, fontWeight: 600, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)', width: '100%', textAlign: 'left' }}>
          Sending Limits
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12, flex: 1 }}>— rate limiting to avoid spam filters</span>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showAdvanced && (
          <>
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 14, fontSize: 12, color: 'var(--text-dim)' }}>
              <strong style={{ color: 'var(--warning)' }}>Tip:</strong> Sending too fast triggers spam filters on any provider. 50 emails/batch with 60s pause is safe for most. For self-hosted Mailcow you can go faster.
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Emails per batch</label>
                <input className="input" type="number" min={1} max={500} value={form.batch_size} onChange={e => set('batch_size', Number(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Pause between batches (seconds)</label>
                <input className="input" type="number" min={0} value={form.batch_delay} onChange={e => set('batch_delay', Number(e.target.value))} />
              </div>
            </div>
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label>Delay between emails (seconds)</label>
              <input className="input" type="number" min={0} max={30} step={0.5} value={form.per_email_delay} onChange={e => set('per_email_delay', Number(e.target.value))} />
            </div>
          </>
        )}
      </section>

      <div className="divider" />

      {/* ── Daily Sending Limit & Auto-Resume ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} color="var(--warning)" /> Daily Sending Limit
        </h3>

        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 14, fontSize: 12, color: 'var(--text-dim)' }}>
          <strong style={{ color: 'var(--warning)' }}>How it works:</strong> When your daily limit is reached, the campaign automatically pauses and resumes the next day at the configured time. Use 0 to disable the daily limit.
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Daily send limit <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(emails per day, 0 = unlimited)</span></label>
            <input className="input" type="number" min={0} max={10000}
              value={form.daily_send_limit}
              onChange={e => set('daily_send_limit', Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label>Auto-resume time <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(next day)</span></label>
            <input className="input" type="time"
              value={form.daily_resume_time || '09:00'}
              onChange={e => set('daily_resume_time', e.target.value)} />
          </div>
        </div>
      </section>

      <div className="divider" />

      {/* ── Startup ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          Startup
        </h3>
        {startupEnabled === null ? (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Automatic startup isn't available on this system (needs systemd).
          </p>
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: startupBusy ? 'default' : 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={startupEnabled} disabled={startupBusy}
                onChange={e => toggleStartup(e.target.checked)} />
              Run MailWave automatically on login
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              Required for scheduled sends and daily batch resume to fire on time — the app needs to be running.
              When disabled, MailWave won't auto-launch at login (you'll need to start it manually), and it won't
              restart itself if it crashes. Closing the window always minimizes to tray regardless of this setting.
            </p>
          </>
        )}
      </section>

      <div className="divider" />

      {/* ── Notifications ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} color="var(--accent)" /> Notifications
        </h3>

        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
          Receive desktop (OS) notifications and in-app alerts so you always know what's happening.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Daily summary */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)' }}>Daily Summary</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                Morning briefing — sends left today, scheduled campaigns, paused items
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <input className="input" type="time" style={{ width: 110 }}
                value={form.notify_summary_time || '08:00'}
                onChange={e => set('notify_summary_time', e.target.value)}
                disabled={!form.notify_daily_summary} />
              <ToggleSwitch
                checked={!!form.notify_daily_summary}
                onChange={v => set('notify_daily_summary', v)} />
            </div>
          </div>

          {/* Daily limit reached */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)' }}>Daily Limit Reached</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                Alert when a campaign pauses because the daily limit was hit
              </div>
            </div>
            <ToggleSwitch
              checked={!!form.notify_limit_reached}
              onChange={v => set('notify_limit_reached', v)} />
          </div>

          {/* Campaign done */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)' }}>Campaign Completed</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                Notify when a campaign finishes sending to all subscribers
              </div>
            </div>
            <ToggleSwitch
              checked={!!form.notify_campaign_done}
              onChange={v => set('notify_campaign_done', v)} />
          </div>

          {/* Campaign reminder */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)' }}>Scheduled Campaign Reminder</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                Remind before a scheduled campaign sends so you can review or cancel
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className="input" type="number" min={1} max={120} style={{ width: 70, textAlign: 'right' }}
                  value={form.notify_reminder_minutes || 15}
                  onChange={e => set('notify_reminder_minutes', Number(e.target.value))}
                  disabled={!form.notify_campaign_reminder} />
                <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>min before</span>
              </div>
              <ToggleSwitch
                checked={!!form.notify_campaign_reminder}
                onChange={v => set('notify_campaign_reminder', v)} />
            </div>
          </div>
        </div>
      </section>

      <div className="divider" />

      {/* ── Brevo API Key (stats only) ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 4, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          Brevo API Key <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>— optional, only for daily limit tracker</span>
        </h3>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>API Key <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(xkeysib-...)</span></label>
          <input className="input" value={form.brevo_api_key || ''} onChange={e => set('brevo_api_key', e.target.value)} placeholder="xkeysib-xxxxxxxxxxxxxxxx" />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Used only to show remaining daily sends on the Dashboard. Not used for sending.</p>
      </section>

      <div className="divider" />

      {/* ── FTP/SFTP Sync ── */}
      <section>
        <h3 style={{ fontSize: 14, color: 'var(--text-h)', marginBottom: 4, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          Website Subscriber Sync <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>— pull CSV from your cPanel server</span>
        </h3>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Protocol</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['ftp', 'ftps', 'sftp'].map(p => (
              <button key={p} onClick={() => set('sync_protocol', p)}
                style={{
                  padding: '7px 16px', borderRadius: 'var(--radius)',
                  border: `1px solid ${form.sync_protocol === p ? 'var(--accent)' : 'var(--border)'}`,
                  background: form.sync_protocol === p ? 'var(--accent-bg)' : 'var(--bg3)',
                  color: form.sync_protocol === p ? 'var(--accent)' : 'var(--text)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 500, textTransform: 'uppercase',
                }}>{p}</button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>FTP/SFTP Host</label>
            <input className="input" value={form.sync_host || ''} onChange={e => set('sync_host', e.target.value)} placeholder="ftp.yourdomain.com" />
          </div>
          <div className="form-group">
            <label>Port <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(FTP: 21, SFTP: 22)</span></label>
            <input className="input" value={form.sync_port || ''} onChange={e => set('sync_port', e.target.value)} placeholder="21" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Username</label>
            <input className="input" value={form.sync_user || ''} onChange={e => set('sync_user', e.target.value)} placeholder="cPanel username" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input className="input" type="password" value={form.sync_password || ''} onChange={e => set('sync_password', e.target.value)} placeholder="cPanel password" />
          </div>
        </div>
        <div className="form-group">
          <label>Remote CSV File Path</label>
          <input className="input" value={form.sync_path || ''} onChange={e => set('sync_path', e.target.value)} placeholder="/home/user/subscribers.csv  or  /public_html/uploads/subscribers.csv" />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Use the "Sync from Website" button in the Subscribers page to pull and auto-import.
          Duplicates are skipped automatically.
        </p>
      </section>

      <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={save}>
          <Check size={14} /> Save Settings
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center' }}>
          Always test connection after changing provider
        </span>
      </div>
    </div>
  )
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────
function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--accent)' : 'var(--bg3)',
        boxShadow: checked ? '0 0 0 1px var(--accent)' : '0 0 0 1px var(--border)',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

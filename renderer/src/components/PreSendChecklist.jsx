import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Send, X } from 'lucide-react'
import { checkSpam } from '../utils/spamCheck.js'

export default function PreSendChecklist({ campaign, subscriberCount, onConfirm, onCancel }) {
  const [checks, setChecks]   = useState([])
  const [spam, setSpam]       = useState(null)
  const [settings, setSettings] = useState(null)
  const [ready, setReady]     = useState(false)

  useEffect(() => {
    window.api.settings.get().then(s => {
      setSettings(s)
      const fromEmail = campaign.from_email || s.from_email
      const fromName  = campaign.from_name  || s.from_name

      const spamResult = checkSpam(campaign.subject, campaign.html, campaign.text)
      setSpam(spamResult)

      const c = [
        {
          label:  'Subject line set',
          pass:   !!campaign.subject?.trim(),
          detail: campaign.subject || 'Missing',
          critical: true,
        },
        {
          label:  'From email configured',
          pass:   !!fromEmail,
          detail: fromEmail || 'Not set — check Settings',
          critical: true,
        },
        {
          label:  'From name configured',
          pass:   !!fromName,
          detail: fromName || 'Not set — check Settings',
          critical: false,
        },
        {
          label:  'Email body not empty',
          pass:   !!(campaign.html?.trim()),
          detail: campaign.html ? `${spamResult.wordCount} words` : 'Empty',
          critical: true,
        },
        {
          label:  'Unsubscribe link',
          pass:   true,
          detail: 'Auto-added by MailWave to every email (CAN-SPAM / GDPR compliant)',
          critical: false,
        },
        {
          label:  'Subscribers to send to',
          pass:   subscriberCount > 0,
          detail: `${subscriberCount.toLocaleString()} active subscribers`,
          critical: true,
        },
        {
          label:  'SMTP configured',
          pass:   !!s.smtp_host && !!s.smtp_user,
          detail: s.smtp_host ? `${s.smtp_host}:${s.smtp_port}` : 'Not configured',
          critical: true,
        },
        {
          label:  'Plain text fallback',
          pass:   true,
          detail: campaign.text?.trim() ? 'Custom plain text provided' : 'Auto-generated from HTML by MailWave',
          critical: false,
        },
        {
          label:  'Spam score acceptable',
          pass:   spamResult.score < 30,
          detail: `Score: ${spamResult.score}/100 ${spamResult.score < 30 ? '(Good)' : spamResult.score < 60 ? '(Moderate)' : '(High risk)'}`,
          critical: false,
        },
        {
          label:  'Subject line length',
          pass:   (campaign.subject?.length || 0) <= 70,
          detail: `${campaign.subject?.length || 0} chars ${(campaign.subject?.length || 0) <= 70 ? '(Good)' : '(Too long — keep under 70)'}`,
          critical: false,
        },
      ]

      setChecks(c)
      const criticalFail = c.filter(x => x.critical && !x.pass)
      setReady(criticalFail.length === 0)
    })
  }, [])

  const passed   = checks.filter(c => c.pass).length
  const critical = checks.filter(c => c.critical && !c.pass).length

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0 }}>Pre-Send Checklist</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
              {passed}/{checks.length} checks passed
              {critical > 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>· {critical} critical issue{critical > 1 ? 's' : ''} must be fixed</span>}
            </p>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Checks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 'var(--radius)',
              background: c.pass ? 'rgba(34,197,94,0.06)' : c.critical ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.06)',
              border: `1px solid ${c.pass ? 'rgba(34,197,94,0.15)' : c.critical ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.15)'}`,
            }}>
              {c.pass
                ? <CheckCircle size={15} color="var(--success)" style={{ flexShrink: 0 }} />
                : c.critical
                  ? <XCircle size={15} color="var(--danger)" style={{ flexShrink: 0 }} />
                  : <AlertTriangle size={15} color="var(--warning)" style={{ flexShrink: 0 }} />
              }
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, color: c.pass ? 'var(--text-h)' : c.critical ? 'var(--danger)' : 'var(--warning)', fontWeight: 500 }}>
                  {c.label}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>{c.detail}</span>
              </div>
              {c.critical && !c.pass && <span className="badge badge-red" style={{ fontSize: 10 }}>Required</span>}
            </div>
          ))}
        </div>

        {/* Spam issues */}
        {spam && (spam.issues.length > 0 || spam.warnings.length > 0) && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, fontWeight: 600 }}>SPAM ANALYSIS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[...spam.issues, ...spam.warnings].map((issue, i) => (
                <div key={i} style={{ fontSize: 12, color: issue.severity === 'error' ? 'var(--danger)' : 'var(--warning)', padding: '4px 8px', background: issue.severity === 'error' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)', borderRadius: 4 }}>
                  {issue.severity === 'error' ? '✗' : '⚠'} {issue.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Spam score bar */}
        {spam && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
              <span>Spam Score</span>
              <span style={{ color: spam.score < 30 ? 'var(--success)' : spam.score < 60 ? 'var(--warning)' : 'var(--danger)' }}>
                {spam.score}/100 — {spam.score < 30 ? 'Good' : spam.score < 60 ? 'Moderate' : 'High Risk'}
              </span>
            </div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{
                width: `${spam.score}%`,
                background: spam.score < 30 ? 'var(--success)' : spam.score < 60 ? 'var(--warning)' : 'var(--danger)',
              }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className={`btn ${ready ? 'btn-primary' : 'btn-ghost'}`}
            disabled={!ready}
            onClick={onConfirm}
            style={{ opacity: ready ? 1 : 0.5 }}
          >
            <Send size={14} />
            {ready ? `Send to ${subscriberCount.toLocaleString()} subscribers` : 'Fix issues above first'}
          </button>
        </div>
      </div>
    </div>
  )
}

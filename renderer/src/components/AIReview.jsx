import { useState } from 'react'
import { Sparkles, RefreshCw, Lock, AlertTriangle, XCircle, Info } from 'lucide-react'
import useAiConfig from '../hooks/useAiConfig.js'

const SEVERITY = {
  critical: { color: 'var(--danger)',  bg: 'rgba(239,68,68,0.06)',  Icon: XCircle },
  warning:  { color: 'var(--warning)', bg: 'rgba(245,158,11,0.06)', Icon: AlertTriangle },
  info:     { color: 'var(--text-dim)', bg: 'var(--bg3)',           Icon: Info },
}
const scoreColor = (n) => n >= 75 ? 'var(--success)' : n >= 50 ? 'var(--warning)' : 'var(--danger)'
const dim = { fontSize: 12, color: 'var(--text-dim)' }

// AI content review: spam risk, mistakes, clarity, compliance, subject score.
// Advisory only. It runs on demand (each run is a paid API call) and never
// blocks sending; the rule-based checks in PreSendChecklist do that.
export default function AIReview({ campaign, onUseSubject }) {
  const { config, ready } = useAiConfig()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  if (!config) return null

  const run = async () => {
    setBusy(true); setError(null)
    const r = await window.api.ai.review({
      subject: campaign.subject || '', ab_subject_b: campaign.ab_subject_b || '',
      html: campaign.html || '', text: campaign.text || '',
    })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setResult(r)
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Sparkles size={12} color="var(--accent)" /> AI REVIEW <span style={{ fontWeight: 400 }}>— advisory</span>
      </div>
      {ready && config.pro && (
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={run}>
          <RefreshCw size={12} className={busy ? 'spin' : ''} /> {busy ? 'Reviewing…' : result ? 'Review again' : 'Run AI review'}
        </button>
      )}
    </div>
  )

  if (!ready) {
    return <div style={{ marginBottom: 16 }}>{header}<div style={dim}>Turn on AI in Settings → AI Writing &amp; Review to get a content review here.</div></div>
  }
  if (!config.pro) {
    return (
      <div style={{ marginBottom: 16 }}>
        {header}
        <div style={{ ...dim, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock size={12} /> AI review (spam risk, mistakes, compliance, subject score) is a Pro feature.
          <button className="btn btn-ghost btn-sm" onClick={() => window.api.license.openUpgrade()}>Upgrade to Pro</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {header}
      {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>{error}</div>}
      {!result && !error && !busy && <div style={dim}>Checks wording, spam risk, broken or placeholder links, compliance and the subject line. Takes about 10–20 seconds.</div>}
      {result && (
        <>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            <span>Overall <strong style={{ color: scoreColor(result.score) }}>{result.score}/100</strong></span>
            <span>Subject <strong style={{ color: scoreColor(result.subject_score) }}>{result.subject_score}/100</strong></span>
            <span>Spam risk <strong style={{ color: result.spam_risk === 'low' ? 'var(--success)' : result.spam_risk === 'medium' ? 'var(--warning)' : 'var(--danger)' }}>{result.spam_risk}</strong></span>
            <span>Readability <strong style={{ color: 'var(--text-h)' }}>{result.readability}</strong></span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-h)', marginBottom: 8 }}>{result.summary}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {result.issues.map((issue, i) => {
              const s = SEVERITY[issue.severity] || SEVERITY.info
              return (
                <div key={i} style={{ fontSize: 12, padding: '6px 8px', background: s.bg, borderRadius: 4 }}>
                  <div style={{ color: s.color }}>
                    <s.Icon size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{issue.category}:</span> {issue.message}
                  </div>
                  {issue.suggestion && <div style={{ ...dim, marginTop: 2, marginLeft: 15 }}>→ {issue.suggestion}</div>}
                </div>
              )
            })}
          </div>
          {result.better_subjects?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ ...dim, marginBottom: 4 }}>Suggested subject lines{onUseSubject ? ' (click to use)' : ''}:</div>
              {result.better_subjects.map((s, i) => (
                <div key={i} onClick={onUseSubject ? () => onUseSubject(s) : undefined}
                  style={{ fontSize: 12, padding: '4px 8px', color: 'var(--text-h)', cursor: onUseSubject ? 'pointer' : 'default', borderRadius: 4 }}
                  onMouseEnter={e => onUseSubject && (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Sparkles, X, RefreshCw, Check, Copy, AlertTriangle, PenLine, CornerUpRight, Reply } from 'lucide-react'
import toast from 'react-hot-toast'
import ToneSelect from './ToneSelect.jsx'

const MODES = [
  { id: 'draft',    label: 'Write new',  icon: PenLine },
  { id: 'followUp', label: 'Follow-up',  icon: CornerUpRight },
  { id: 'reply',    label: 'Reply',      icon: Reply },
]

const ANGLES = [
  { id: 'reminder', label: "Reminder: for people who haven't acted yet" },
  { id: 'thanks',   label: 'Thank you + next step' },
  { id: 'lastcall', label: 'Last chance before a deadline' },
  { id: 'update',   label: 'Update with new information' },
]

const dim = { fontSize: 12, color: 'var(--text-dim)' }

// "Write with AI" panel. Produces subject + HTML + plain text; the caller
// decides what to do with it (onApply), so AI output never silently
// overwrites the campaign.
export default function AIWriter({ initialMode = 'draft', followUpOf = null, onApply, onClose }) {
  const [mode, setMode] = useState(initialMode)
  const [brief, setBrief] = useState({ goal: '', audience: '', keyPoints: '', cta: '', length: 'medium', tone: '' })
  const [fu, setFu] = useState({ campaign_id: followUpOf?.id || '', angle: 'reminder', notes: '' })
  const [rep, setRep] = useState({ received: '', intent: '' })
  const [sentCampaigns, setSentCampaigns] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    window.api.campaigns.list().then(list => setSentCampaigns(list.filter(c => c.status === 'sent' || c.sent_count > 0)))
  }, [])

  const generate = async () => {
    setBusy(true)
    let r
    if (mode === 'draft')    r = await window.api.ai.draft(brief)
    if (mode === 'followUp') {
      if (!fu.campaign_id) { setBusy(false); toast.error('Pick the campaign to follow up on'); return }
      r = await window.api.ai.followUp({ ...fu, campaign_id: Number(fu.campaign_id) })
    }
    if (mode === 'reply')    r = await window.api.ai.reply(rep)
    setBusy(false)
    if (!r?.ok) { toast.error(r?.error || 'AI request failed'); return }
    setResult(r)
  }

  const copyText = async () => {
    await navigator.clipboard.writeText(`Subject: ${result.subject}\n\n${result.text}`)
    toast.success('Copied to clipboard')
  }

  const setB = (k, v) => setBrief(b => ({ ...b, [k]: v }))

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg" style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={16} color="var(--accent)" /> Write with AI</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {MODES.map((m) => (
            <button key={m.id} onClick={() => { setMode(m.id); setResult(null) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                border: `1px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`,
                background: mode === m.id ? 'var(--accent-bg)' : 'var(--bg3)',
                color: mode === m.id ? 'var(--accent)' : 'var(--text)',
              }}><m.icon size={13} /> {m.label}</button>
          ))}
        </div>

        {!result && mode === 'draft' && (
          <>
            <div className="form-group">
              <label>What is this email for?</label>
              <textarea className="textarea" rows={2} value={brief.goal} onChange={e => setB('goal', e.target.value)}
                placeholder="e.g. Announce our new online consultation service and get people to book a first slot" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Audience <span style={dim}>(optional)</span></label>
                <input className="input" value={brief.audience} onChange={e => setB('audience', e.target.value)} placeholder="e.g. existing customers in Chennai" />
              </div>
              <div className="form-group">
                <label>Call to action <span style={dim}>(optional)</span></label>
                <input className="input" value={brief.cta} onChange={e => setB('cta', e.target.value)} placeholder="e.g. Book a free first slot on our website" />
              </div>
            </div>
            <div className="form-group">
              <label>Key points <span style={dim}>(optional, one per line)</span></label>
              <textarea className="textarea" rows={3} value={brief.keyPoints} onChange={e => setB('keyPoints', e.target.value)}
                placeholder={'e.g. 20 minute video calls\nFirst consultation free until 30 Nov\nAvailable in Tamil and English'} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Length</label>
                <select className="select" value={brief.length} onChange={e => setB('length', e.target.value)}>
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>
              </div>
              <div className="form-group">
                <label>Tone</label>
                <ToneSelect value={brief.tone} onChange={v => setB('tone', v)} />
              </div>
            </div>
          </>
        )}

        {!result && mode === 'followUp' && (
          <>
            <div className="form-group">
              <label>Follow up on</label>
              <select className="select" value={fu.campaign_id} onChange={e => setFu(f => ({ ...f, campaign_id: e.target.value }))}>
                <option value="">Select a sent campaign</option>
                {sentCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}: {c.subject}</option>)}
              </select>
              {sentCampaigns.length === 0 && <p style={{ ...dim, marginTop: 6 }}>No sent campaigns yet.</p>}
            </div>
            <div className="form-group">
              <label>Kind of follow-up</label>
              <select className="select" value={fu.angle} onChange={e => setFu(f => ({ ...f, angle: e.target.value }))}>
                {ANGLES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <p style={{ ...dim, marginTop: 6 }}>This shapes the wording only. Recipients are still the groups chosen in "Send To".</p>
            </div>
            <div className="form-group">
              <label>Anything to add? <span style={dim}>(optional)</span></label>
              <textarea className="textarea" rows={2} value={fu.notes} onChange={e => setFu(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Mention that 40 slots are already booked; deadline moved to Friday" />
            </div>
          </>
        )}

        {!result && mode === 'reply' && (
          <>
            <div className="form-group">
              <label>Message you received</label>
              <textarea className="textarea" rows={7} value={rep.received} onChange={e => setRep(r => ({ ...r, received: e.target.value }))}
                placeholder="Paste the email someone sent you, e.g. a subscriber replying to your newsletter" />
            </div>
            <div className="form-group">
              <label>What should the reply say? <span style={dim}>(optional)</span></label>
              <textarea className="textarea" rows={2} value={rep.intent} onChange={e => setRep(r => ({ ...r, intent: e.target.value }))}
                placeholder="e.g. Thank them, say yes to the bulk order, ask for their GST number" />
            </div>
            <p style={{ ...dim, marginBottom: 12 }}>The pasted message is sent to the AI. Remove anything private you don't want to share.</p>
          </>
        )}

        {result && (
          <div>
            <div className="form-group">
              <label>Subject</label>
              <div style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text-h)' }}>
                {result.subject}
                {result.preview_text && <span style={{ color: 'var(--text-dim)' }}> — {result.preview_text}</span>}
              </div>
            </div>
            <div className="form-group">
              <label>Body</label>
              <div className="tiptap" style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', maxHeight: 340, overflow: 'auto', fontSize: 13 }}
                dangerouslySetInnerHTML={{ __html: result.html }} />
            </div>
            {(result.warnings?.length > 0 || result.notes) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {result.warnings?.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--warning)', padding: '5px 8px', background: 'rgba(245,158,11,0.06)', borderRadius: 4 }}>
                    <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{w}
                  </div>
                ))}
                {result.notes && <div style={{ ...dim, padding: '5px 8px' }}>Note from AI: {result.notes}</div>}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          {!result ? (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={generate}>
                {busy ? <><RefreshCw size={14} className="spin" /> Writing…</> : <><Sparkles size={14} /> Generate</>}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setResult(null)}>← Edit brief</button>
              <button className="btn btn-ghost" disabled={busy} onClick={generate}>
                <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'Writing…' : 'Try again'}
              </button>
              <button className="btn btn-ghost" onClick={copyText}><Copy size={14} /> Copy text</button>
              <button className="btn btn-primary" onClick={() => onApply(result, mode)}><Check size={14} /> Use in campaign</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

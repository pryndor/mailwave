import { useEffect, useState } from 'react'
import { ListOrdered, X, RefreshCw, Check, AlertTriangle, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'

const dim = { fontSize: 12, color: 'var(--text-dim)' }

// "AI Sequence": writes a welcome / nurture series and saves each email as its
// own draft campaign, named with its place in the series and its send day.
// Nothing is scheduled or sent; the user reviews and schedules each draft.
export default function AISequence({ onClose, onCreated }) {
  const [brief, setBrief] = useState({ name: '', goal: '', audience: '', keyPoints: '', cta: '', count: 4, spacing: 'normal', tone: '' })
  const [groups, setGroups]     = useState([])
  const [groupIds, setGroupIds] = useState([])
  const [busy, setBusy]         = useState(false)
  const [saving, setSaving]     = useState(false)
  const [result, setResult]     = useState(null)
  const [open, setOpen]         = useState(0)

  useEffect(() => { window.api.groups.list().then(setGroups) }, [])

  const setB = (k, v) => setBrief(b => ({ ...b, [k]: v }))

  const generate = async () => {
    setBusy(true)
    const r = await window.api.ai.sequence(brief)
    setBusy(false)
    if (!r?.ok) { toast.error(r?.error || 'AI request failed'); return }
    setResult(r)
    setOpen(0)
  }

  const save = async () => {
    setSaving(true)
    const series = brief.name.trim() || 'AI series'
    const n = result.emails.length
    try {
      for (const [i, e] of result.emails.entries()) {
        await window.api.campaigns.save({
          name: `${series} ${i + 1}/${n} (day ${e.day}): ${e.purpose}`.slice(0, 120),
          subject: e.subject, preview_text: e.preview_text, html: e.html, text: e.text,
          from_name: '', from_email: '', reply_to: '', group_ids: groupIds, attachments: [],
          ab_subject_b: '', ab_split_pct: 50,
        })
      }
      toast.success(`${n} draft campaigns created. Review and schedule each one`)
      onCreated()
    } catch (err) {
      toast.error(`Save failed: ${err?.message || err}`)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg" style={{ maxWidth: 780, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><ListOrdered size={16} color="var(--accent)" /> Write a sequence with AI</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={18} /></button>
        </div>

        {!result ? (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>Series name</label>
                <input className="input" value={brief.name} onChange={e => setB('name', e.target.value)} placeholder="e.g. Welcome series" />
              </div>
              <div className="form-group">
                <label>Number of emails</label>
                <select className="select" value={brief.count} onChange={e => setB('count', Number(e.target.value))}>
                  {[3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>What should the series achieve?</label>
              <textarea className="textarea" rows={2} value={brief.goal} onChange={e => setB('goal', e.target.value)}
                placeholder="e.g. Welcome new newsletter subscribers, show them our most useful guides, then invite them to a free consultation" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Audience <span style={dim}>(optional)</span></label>
                <input className="input" value={brief.audience} onChange={e => setB('audience', e.target.value)} placeholder="e.g. pharmacists who just signed up" />
              </div>
              <div className="form-group">
                <label>Final call to action <span style={dim}>(optional)</span></label>
                <input className="input" value={brief.cta} onChange={e => setB('cta', e.target.value)} placeholder="e.g. Book a free 20-minute call" />
              </div>
            </div>
            <div className="form-group">
              <label>Key points to cover <span style={dim}>(optional, one per line)</span></label>
              <textarea className="textarea" rows={3} value={brief.keyPoints} onChange={e => setB('keyPoints', e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Spacing</label>
                <select className="select" value={brief.spacing} onChange={e => setB('spacing', e.target.value)}>
                  <option value="tight">Every 1–2 days</option>
                  <option value="normal">Every 2–4 days</option>
                  <option value="relaxed">About weekly</option>
                </select>
              </div>
              <div className="form-group">
                <label>Tone</label>
                <select className="select" value={brief.tone} onChange={e => setB('tone', e.target.value)}>
                  <option value="">Brand default (Settings)</option>
                  <option value="friendly">Friendly</option>
                  <option value="formal">Formal</option>
                  <option value="clinical">Clinical / scientific</option>
                  <option value="playful">Playful</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            {result.plan && <p style={{ fontSize: 13, marginBottom: 12 }}>{result.plan}</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {result.emails.map((e, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <div onClick={() => setOpen(open === i ? -1 : i)}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', background: 'var(--bg3)', cursor: 'pointer' }}>
                    <span className="badge badge-blue">Day {e.day}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-h)', fontWeight: 500 }}>{e.subject}</div>
                      <div style={dim}>{e.purpose}</div>
                    </div>
                  </div>
                  {open === i && (
                    <div style={{ padding: '10px 12px' }}>
                      {e.preview_text && <div style={{ ...dim, marginBottom: 8 }}>Preview text: {e.preview_text}</div>}
                      <div className="tiptap" style={{ fontSize: 13, maxHeight: 280, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: e.html }} />
                      {e.warnings?.map((w, j) => (
                        <div key={j} style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}><AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{w}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {result.notes && <div style={{ ...dim, marginBottom: 12 }}>Note from AI: {result.notes}</div>}
            {groups.length > 0 && (
              <div className="form-group">
                <label>Send to <span style={dim}>(leave empty = all active subscribers)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {groups.map(g => (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={groupIds.includes(g.id)}
                        onChange={() => setGroupIds(ids => ids.includes(g.id) ? ids.filter(x => x !== g.id) : [...ids, g.id])} />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <p style={dim}>Each email is saved as a draft campaign. Nothing is sent or scheduled: open each one, check it, then schedule it for its day.</p>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          {!result ? (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={generate}>
                {busy ? <><RefreshCw size={14} className="spin" /> Writing {brief.count} emails…</> : <><Sparkles size={14} /> Generate</>}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setResult(null)}>← Edit brief</button>
              <button className="btn btn-ghost" disabled={busy} onClick={generate}>
                <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'Writing…' : 'Try again'}
              </button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>
                <Check size={14} /> {saving ? 'Saving…' : `Create ${result.emails.length} drafts`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

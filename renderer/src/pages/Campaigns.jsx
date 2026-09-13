import { useState, useEffect, useRef } from 'react'
import { Plus, Send, Eye, Trash2, Edit2, StopCircle, Calendar, Clock, Copy, Paperclip, X, BarChart2, FlaskConical, PlayCircle, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import RichEditor from '../components/RichEditor.jsx'
import PreSendChecklist from '../components/PreSendChecklist.jsx'
import CampaignMetrics from '../components/CampaignMetrics.jsx'

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([])
  const [editing, setEditing]     = useState(null)
  const [sending, setSending]     = useState(null)
  const [metrics, setMetrics]     = useState(null)

  const load = () => window.api.campaigns.list().then(setCampaigns)
  useEffect(() => { load() }, [])

  const del = async (id) => {
    if (!confirm('Delete campaign?')) return
    await window.api.campaigns.delete(id)
    toast.success('Deleted')
    load()
  }

  const duplicate = async (id) => {
    await window.api.campaigns.duplicate(id)
    toast.success('Campaign duplicated')
    load()
  }

  const resume = async (id, name) => {
    if (!confirm(`Resume campaign "${name}" now?`)) return
    toast.loading('Resuming campaign…', { id: 'resume' })
    const r = await window.api.campaigns.resume(id)
    toast.dismiss('resume')
    if (r?.ok) toast.success('Campaign resumed!')
    else toast.error(r?.error || 'Failed to resume')
    load()
  }

  if (editing !== null) {
    return <CampaignEditor camp={editing === 'new' ? null : editing}
      onSave={() => { setEditing(null); load() }}
      onCancel={() => setEditing(null)} />
  }

  if (sending) {
    return <SendPanel campaign={sending} onDone={() => { setSending(null); load() }} />
  }

  return (
    <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, color: 'var(--text-h)', fontWeight: 700 }}>Campaigns</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>Create and send bulk email campaigns</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> New Campaign</button>
      </div>

      {campaigns.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 60 }}>
          <Send size={40} />
          <p>No campaigns yet. Create your first campaign.</p>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Create Campaign</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {campaigns.map(c => (
            <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-h)' }}>{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {c.subject} · {c.from_email || 'No sender set'}
                  {c.sent_at && ` · Sent ${c.sent_at.slice(0,10)}`}
                </div>
                {(c.status === 'sent' || c.status === 'sending') && c.total_count > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {c.sent_count}/{c.total_count} sent
                  </div>
                )}
                {c.status === 'paused' && (
                  <div style={{ fontSize: 12, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--warning)' }}>
                      Paused at {c.sent_count}/{c.total_count}
                    </span>
                    {c.resume_at && (
                      <span style={{ color: 'var(--text-dim)' }}>
                        · Auto-resumes {fmtDateTime(c.resume_at)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}><Edit2 size={12} /> Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={() => duplicate(c.id)} title="Duplicate"><Copy size={12} /></button>
                {c.status === 'sent' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setMetrics(c)}><BarChart2 size={12} /> Metrics</button>
                )}
                {(c.status === 'draft' || c.status === 'stopped') && (
                  <button className="btn btn-primary btn-sm" onClick={() => setSending(c)}><Send size={12} /> Send</button>
                )}
                {c.status === 'paused' && (
                  <button className="btn btn-primary btn-sm" onClick={() => resume(c.id, c.name)}
                    style={{ background: 'var(--warning)', borderColor: 'var(--warning)' }}>
                    <PlayCircle size={12} /> Resume Now
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => del(c.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {metrics && <CampaignMetrics campaign={metrics} onClose={() => setMetrics(null)} />}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = { draft: 'badge-gray', sending: 'badge-yellow', sent: 'badge-green', stopped: 'badge-red', paused: 'badge-yellow' }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>
}

function fmtDateTime(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

// ── Campaign Editor ───────────────────────────────────────────────────────────
function CampaignEditor({ camp, onSave, onCancel }) {
  const [form, setForm]       = useState(camp || { name: '', subject: '', from_name: '', from_email: '', reply_to: '', html: '', text: '', group_ids: [], attachments: [], ab_subject_b: '', ab_split_pct: 50 })
  const [groups, setGroups]   = useState([])
  const [templates, setTemplates] = useState([])
  const [customTags, setCustomTags] = useState([])
  const [mergePreview, setMergePreview] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const previewMerge = async () => {
    const r = await window.api.campaigns.previewMerge({ campaign: form })
    if (r.error) { toast.error(r.error); return }
    setMergePreview(r)
  }

  const addAttachment = async () => {
    const result = await window.api.dialog.openFile({
      title: 'Select Attachment',
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || !result.filePaths.length) return
    const newAttachments = result.filePaths.map(p => ({
      name: p.split('/').pop(),
      path: p,
    }))
    set('attachments', [...(form.attachments || []), ...newAttachments])
  }

  const removeAttachment = (index) => {
    set('attachments', form.attachments.filter((_, i) => i !== index))
  }

  useEffect(() => {
    window.api.groups.list().then(setGroups)
    window.api.templates.list().then(setTemplates)
    window.api.subscribers.customFields().then(setCustomTags)
  }, [])

  const toggleGroup = (id) => {
    set('group_ids', form.group_ids.includes(id)
      ? form.group_ids.filter(g => g !== id)
      : [...form.group_ids, id])
  }

  const loadTemplate = (id) => {
    const t = templates.find(t => t.id === Number(id))
    if (!t) return
    setForm(f => ({ ...f, subject: t.subject || f.subject, html: t.html, text: t.text }))
    toast.success(`Template "${t.name}" loaded`)
  }

  const save = async () => {
    if (!form.name.trim())    { toast.error('Campaign name required'); return }
    if (!form.subject.trim()) { toast.error('Subject required'); return }
    if (!form.html || form.html.replace(/<[^>]*>/g, '').trim() === '') { toast.error('Email body required'); return }
    try {
      await window.api.campaigns.save(form)
      toast.success('Campaign saved')
      onSave()
    } catch (err) {
      toast.error(`Save failed: ${err?.message || err}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, color: 'var(--text-h)', fontWeight: 700 }}>{camp ? 'Edit Campaign' : 'New Campaign'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={previewMerge}><Wand2 size={14} /> Preview Merge</button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save Campaign</button>
        </div>
      </div>
      {mergePreview && (
        <div className="modal-overlay" onClick={() => setMergePreview(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 4 }}>Merge Preview</h3>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
              Rendered with your first active subscriber's data — merge tags replaced exactly as they'll go out.
            </p>
            <div className="form-group">
              <label>Subject</label>
              <div style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 'var(--radius)', fontSize: 13 }}>{mergePreview.subject}</div>
            </div>
            <div className="form-group">
              <label>Body</label>
              <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius)', maxHeight: 320, overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: mergePreview.html }} />
            </div>
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={() => setMergePreview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>
        {/* Main form */}
        <div>
          <div className="form-group"><label>Campaign Name</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. June Promotion" /></div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Subject Line</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
                Merge tags: <code style={{ color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 5px', borderRadius: 3 }}>{'{{name}}'}</code> <code style={{ color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 5px', borderRadius: 3 }}>{'{{first_name}}'}</code> <code style={{ color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 5px', borderRadius: 3 }}>{'{{company}}'}</code>
              </span>
            </label>
            <input className="input" value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="e.g.  Hello {{name}}, here's your update" />
          </div>
          <div className="form-row">
            <div className="form-group"><label>From Name</label><input className="input" value={form.from_name} onChange={e => set('from_name', e.target.value)} placeholder="Your Company" /></div>
            <div className="form-group"><label>From Email</label><input className="input" value={form.from_email} onChange={e => set('from_email', e.target.value)} placeholder="you@company.com" /></div>
          </div>
          <div className="form-group"><label>Reply-To Email</label><input className="input" value={form.reply_to} onChange={e => set('reply_to', e.target.value)} placeholder="Optional reply-to address" /></div>

          {templates.length > 0 && (
            <div className="form-group">
              <label>Load from Template</label>
              <select className="select" onChange={e => loadTemplate(e.target.value)} defaultValue="">
                <option value="">— Select template —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* A/B Subject Test */}
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <FlaskConical size={14} color="var(--accent)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)' }}>A/B Subject Test</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>— optional, test two subject lines</span>
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Subject A (main)</label>
              <input className="input" value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="Subject line A" />
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Subject B <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— leave empty to skip A/B testing</span></label>
              <input className="input" value={form.ab_subject_b || ''} onChange={e => set('ab_subject_b', e.target.value)} placeholder="Alternative subject line (optional)" />
            </div>
            {form.ab_subject_b?.trim() && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Send Subject A to first <strong>{form.ab_split_pct || 50}%</strong>, Subject B to remaining {100 - (form.ab_split_pct || 50)}%</label>
                <input type="range" min={10} max={90} step={5} value={form.ab_split_pct || 50}
                  onChange={e => set('ab_split_pct', Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Email Body <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— {'{{name}}'}, {'{{email}}'}, {'{{first_name}}'}, {'{{unsubscribe}}'}{customTags.length > 0 && `, +${customTags.length} from CSV`}</span></label>
            <RichEditor value={form.html} onChange={v => set('html', v)} customTags={customTags} />
          </div>
          <div className="form-group">
            <label>Plain Text (fallback)</label>
            <textarea className="textarea" rows={4} value={form.text} onChange={e => set('text', e.target.value)} placeholder="Plain text version..." />
          </div>

          {/* Attachments */}
          <div className="form-group">
            <label>Attachments <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— sent with every email in this campaign</span></label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(form.attachments || []).map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <Paperclip size={12} color="var(--text-dim)" />
                  <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <button onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}><X size={12} /></button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={addAttachment} style={{ alignSelf: 'flex-start' }}>
                <Paperclip size={12} /> Add File
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar: groups */}
        <div>
          <div className="card">
            <h4 style={{ fontSize: 13, color: 'var(--text-h)', marginBottom: 12 }}>Send To</h4>
            {groups.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No groups. Will send to all active subscribers.</p>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Select groups (leave empty = all active subscribers)
                </p>
                {groups.map(g => (
                  <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={form.group_ids.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                    <span>{g.name}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>({g.count})</span>
                  </label>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Send Panel ────────────────────────────────────────────────────────────────
function SendPanel({ campaign, onDone }) {
  const [progress, setProgress]       = useState(null)
  const [isSending, setIsSending]     = useState(false)
  const [previewEmail, setPreviewEmail] = useState('')
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduleTime, setScheduleTime] = useState('')
  const [smartMode, setSmartMode]       = useState(false)
  const [smartLocalTime, setSmartLocalTime] = useState('09:00')
  const [smartResult, setSmartResult]   = useState(null)
  const [smartLoading, setSmartLoading] = useState(false)
  const [showChecklist, setShowChecklist] = useState(false)
  const [subCount, setSubCount]       = useState(0)
  const cleanupRef = useRef()

  useEffect(() => {
    const cleanup = window.api.onSendProgress(data => {
      setProgress(data)
      if (data.done || data.stopped) setIsSending(false)
    })
    cleanupRef.current = cleanup
    // Load subscriber count for this campaign
    window.api.subscribers.list({ status: 'active', limit: 1 }).then(d => setSubCount(d.total))
    return () => cleanup?.()
  }, [])

  const sendPreview = async () => {
    if (!previewEmail.includes('@')) { toast.error('Enter a valid email'); return }
    toast.loading('Sending preview...', { id: 'preview' })
    const r = await window.api.campaigns.send({ campaign_id: campaign.id, preview_to: previewEmail })
    toast.dismiss('preview')
    if (r.ok) {
      toast.success('Preview sent! Check your inbox.')
    } else {
      toast.error(r.error || 'Send failed', { duration: 8000 })
      console.error('Preview send error:', r.error)
    }
  }

  const confirmAndSend = () => {
    setShowChecklist(false)
    setIsSending(true)
    setProgress(null)
    window.api.campaigns.send({ campaign_id: campaign.id })
  }

  const startSend = () => setShowChecklist(true)

  const scheduleSend = async () => {
    if (!scheduleTime) { toast.error('Pick a date and time'); return }
    const r = await window.api.campaigns.schedule({ campaign_id: campaign.id, send_at: scheduleTime })
    r.ok ? toast.success(`Scheduled for ${new Date(scheduleTime).toLocaleString()}`) : toast.error(r.error)
    setScheduleMode(false)
  }

  const stop = async () => {
    await window.api.campaigns.stop(campaign.id)
    toast.success('Stopping after current batch...')
  }

  const runSmartSchedule = async () => {
    setSmartLoading(true)
    const r = await window.api.campaigns.smartSchedule({ campaign_id: campaign.id, local_time: smartLocalTime })
    setSmartLoading(false)
    if (!r.ok) { toast.error(r.error || 'Smart schedule failed'); return }
    setSmartResult(r)
    toast.success(`Scheduled across ${r.buckets.length} timezone group(s)`)
  }

  const pct = progress ? Math.round((progress.sent + progress.failed) / progress.total * 100) : 0

  return (
    <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
      {showChecklist && (
        <PreSendChecklist
          campaign={campaign}
          subscriberCount={subCount}
          onConfirm={confirmAndSend}
          onCancel={() => setShowChecklist(false)}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <button className="btn btn-ghost" onClick={onDone}>← Back</button>
        <div>
          <h2 style={{ fontSize: 18, color: 'var(--text-h)', fontWeight: 700 }}>Send: {campaign.name}</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {campaign.subject}
            {campaign.ab_subject_b?.trim() && <span className="badge badge-blue" style={{ marginLeft: 8 }}>A/B Test</span>}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 900 }}>
        {/* Preview */}
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Send Preview</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="your@email.com" value={previewEmail} onChange={e => setPreviewEmail(e.target.value)} />
            <button className="btn btn-ghost" onClick={sendPreview}><Eye size={14} /> Preview</button>
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>Send a test email to verify before bulk send.</p>
        </div>

        {/* Schedule */}
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Schedule Send</h3>
          {!scheduleMode ? (
            <button className="btn btn-ghost" onClick={() => setScheduleMode(true)}><Calendar size={14} /> Schedule for later</button>
          ) : (
            <div>
              <input type="datetime-local" className="input" style={{ marginBottom: 8 }} value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} min={new Date().toISOString().slice(0,16)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={scheduleSend}><Clock size={14} /> Schedule</button>
                <button className="btn btn-ghost" onClick={() => setScheduleMode(false)}>Cancel</button>
              </div>
            </div>
          )}
          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>App must stay open for scheduled sends.</p>
        </div>
      </div>

      {/* Smart Schedule — per-timezone send time */}
      <div className="card" style={{ marginTop: 20, maxWidth: 900 }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>Smart Schedule <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>— send at the right local time per recipient</span></h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
          Groups recipients by a <code>timezone</code> CSV column (IANA names, e.g. <code>Asia/Kolkata</code>) or, if that's missing, by a <code>country</code> column (looked up against ~60 common countries). Splits into one scheduled send per timezone, each firing at the local hour below. Recipients with neither field, or an unrecognized country, fall back to this computer's local time.
        </p>
        {!smartMode ? (
          <button className="btn btn-ghost" onClick={() => setSmartMode(true)}><Clock size={14} /> Set up smart schedule</button>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <label style={{ fontSize: 13 }}>Send at</label>
              <input type="time" className="input" style={{ width: 120 }} value={smartLocalTime} onChange={e => setSmartLocalTime(e.target.value)} />
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>local time, per recipient's timezone</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" disabled={smartLoading} onClick={runSmartSchedule}>
                {smartLoading ? 'Scheduling…' : <><Clock size={14} /> Schedule Per-Timezone</>}
              </button>
              <button className="btn btn-ghost" onClick={() => { setSmartMode(false); setSmartResult(null) }}>Cancel</button>
            </div>
            {smartResult && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {smartResult.unmapped > 0 && (
                  <div style={{ fontSize: 12, padding: '6px 10px', background: 'var(--warning-bg, #3a2f0f)', color: 'var(--warning)', borderRadius: 'var(--radius)' }}>
                    {smartResult.unmapped} recipient(s) had no usable timezone/country — sent at this computer's local time instead.
                  </div>
                )}
                {smartResult.buckets.map((b, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: b.error ? 'var(--danger-bg, #3a1a1a)' : 'var(--bg3)', borderRadius: 'var(--radius)' }}>
                    {b.error
                      ? <span style={{ color: 'var(--danger)' }}>{b.timezone}: {b.error}</span>
                      : <><strong>{b.timezone}</strong> — {b.count} recipient(s) — fires {fmtDateTime(b.send_at)}</>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Send now */}
      <div className="card" style={{ marginTop: 20, maxWidth: 900 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Send Now</h3>
        {!isSending && !progress && (
          <button className="btn btn-primary" onClick={startSend} style={{ fontSize: 14, padding: '10px 24px' }}>
            <Send size={15} /> Start Sending
          </button>
        )}
        {isSending && (
          <button className="btn btn-danger" onClick={stop}><StopCircle size={14} /> Stop Sending</button>
        )}
        {progress && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span>{progress.done ? 'Completed' : progress.stopped ? 'Stopped' : progress.batching ? `Batching... (waiting ${progress.batchDelay}s)` : 'Sending...'}</span>
              <span style={{ color: 'var(--text-dim)' }}>{progress.sent + progress.failed} / {progress.total} ({pct}%)</span>
            </div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12 }}>
              <span style={{ color: 'var(--success)' }}>{progress.sent} sent</span>
              <span style={{ color: 'var(--danger)' }}>{progress.failed} failed</span>
            </div>
            {(progress.done || progress.stopped) && (
              <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onDone}>← Back to Campaigns</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

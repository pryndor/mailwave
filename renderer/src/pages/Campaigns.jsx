import { useState, useEffect, useRef } from 'react'
import { Plus, Send, Eye, Trash2, Edit2, StopCircle, Calendar, Clock, Copy, Paperclip, X, BarChart2, FlaskConical, PlayCircle, Wand2, Sparkles, CornerUpRight, ShieldCheck, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import RichEditor from '../components/RichEditor.jsx'
import PreSendChecklist from '../components/PreSendChecklist.jsx'
import CampaignMetrics from '../components/CampaignMetrics.jsx'
import AIWriter from '../components/AIWriter.jsx'
import AIReview from '../components/AIReview.jsx'
import useAiConfig from '../hooks/useAiConfig.js'

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([])
  const [editing, setEditing]     = useState(null)
  const [sending, setSending]     = useState(null)
  const [metrics, setMetrics]     = useState(null)
  const [aiStart, setAiStart]     = useState(null)   // open the AI writer when the editor mounts
  const { ready: aiReady } = useAiConfig()

  const load = () => window.api.campaigns.list().then(setCampaigns)
  useEffect(() => { load() }, [])

  // Teammates' changes (Team Sync): refresh the list, e.g. a campaign a
  // teammate just sent shows as sent. Only while the list itself is showing —
  // never under an open editor or send screen.
  useEffect(() => {
    if (editing !== null || sending) return
    load()
    return window.api.onTeamChanged(() => load())
  }, [editing, sending])

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

  // New draft that follows up on a sent campaign: same sender and groups,
  // body written by the AI writer (opened in follow-up mode).
  const followUp = (c) => {
    setAiStart({ mode: 'followUp', followUpOf: c })
    setEditing({
      name: `Follow-up: ${c.name}`, subject: '', from_name: c.from_name, from_email: c.from_email,
      reply_to: c.reply_to, html: '', text: '', group_ids: c.group_ids || [], attachments: [],
      ab_subject_b: '', ab_split_pct: 50,
    })
  }

  const closeEditor = () => { setEditing(null); setAiStart(null) }

  if (editing !== null) {
    return <CampaignEditor camp={editing === 'new' ? null : editing} aiStart={aiStart}
      onSave={() => { closeEditor(); load() }}
      onCancel={closeEditor} />
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
                  {c.sent_at && ` · Sent ${fmtDateTime(c.sent_at)}`}
                </div>
                {(c.status === 'sent' || c.status === 'sending') && c.total_count > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {c.sent_count}/{c.total_count} sent
                  </div>
                )}
                {c.scheduled_at && c.status !== 'sent' && c.status !== 'sending' && (
                  <div style={{ fontSize: 12, marginTop: 3, color: 'var(--accent)' }}>
                    <Clock size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                    Scheduled for {fmtDateTime(c.scheduled_at)}
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
                {c.status === 'sent' && aiReady && (
                  <button className="btn btn-ghost btn-sm" onClick={() => followUp(c)} title="Write a follow-up campaign with AI"><CornerUpRight size={12} /> Follow-up</button>
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
function CampaignEditor({ camp, aiStart, onSave, onCancel }) {
  const [form, setForm]       = useState(camp || { name: '', subject: '', from_name: '', from_email: '', reply_to: '', html: '', text: '', group_ids: [], attachments: [], ab_subject_b: '', ab_split_pct: 50 })
  const [groups, setGroups]   = useState([])
  const [templates, setTemplates] = useState([])
  const [customTags, setCustomTags] = useState([])
  const [mergePreview, setMergePreview] = useState(null)
  const { ready: aiReady } = useAiConfig()
  const [aiWriter, setAiWriter] = useState(aiStart)     // { mode, followUpOf } or null
  const [aiUndo, setAiUndo]     = useState(null)        // fields before the last AI apply
  const [showReview, setShowReview] = useState(false)
  const [subjectIdeas, setSubjectIdeas] = useState(null) // null | 'loading' | [{subject, reason}]
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // AI output replaces subject/body/plain text, but keeps a snapshot so one
  // click restores what was there before.
  const applyAi = (r) => {
    setAiUndo({ subject: form.subject, html: form.html, text: form.text })
    setForm(f => ({ ...f, subject: r.subject || f.subject, html: r.html, text: r.text }))
    setAiWriter(null)
    toast.success('AI draft added. Review it before sending')
  }
  const undoAi = () => {
    setForm(f => ({ ...f, ...aiUndo }))
    setAiUndo(null)
  }

  const suggestSubjects = async () => {
    setSubjectIdeas('loading')
    const r = await window.api.ai.subjects({ subject: form.subject, html: form.html })
    if (!r.ok) { setSubjectIdeas(null); toast.error(r.error); return }
    setSubjectIdeas(r.options)
  }

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
        <h2 style={{ fontSize: 16, color: 'var(--text-h)', fontWeight: 700 }}>{camp?.id ? 'Edit Campaign' : 'New Campaign'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" disabled={!aiReady} onClick={() => setAiWriter({ mode: 'draft' })}
            title={aiReady ? 'Draft, follow up or reply with AI' : 'Turn on AI in Settings first'}>
            <Sparkles size={14} /> Write with AI
          </button>
          <button className="btn btn-ghost" disabled={!aiReady} onClick={() => setShowReview(true)}
            title={aiReady ? 'Check this email with AI before sending' : 'Turn on AI in Settings first'}>
            <ShieldCheck size={14} /> AI Review
          </button>
          <button className="btn btn-ghost" onClick={previewMerge}><Wand2 size={14} /> Preview Merge</button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save Campaign</button>
        </div>
      </div>
      {aiWriter && (
        <AIWriter initialMode={aiWriter.mode} followUpOf={aiWriter.followUpOf}
          onApply={applyAi} onClose={() => setAiWriter(null)} />
      )}
      {showReview && (
        <div className="modal-overlay">
          <div className="modal modal-lg" style={{ maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>AI Review</h3>
              <button onClick={() => setShowReview(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={18} /></button>
            </div>
            <AIReview campaign={form} onUseSubject={(s) => { set('subject', s); toast.success('Subject updated') }} />
            <div style={{ textAlign: 'right' }}><button className="btn btn-ghost" onClick={() => setShowReview(false)}>Close</button></div>
          </div>
        </div>
      )}
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
          {aiUndo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 14, background: 'var(--accent-bg)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--accent)' }}>
              <Sparkles size={13} /> <span style={{ flex: 1 }}>Subject and body were written by AI. Check facts, links and [placeholders] before sending.</span>
              <button className="btn btn-ghost btn-sm" onClick={undoAi}><Undo2 size={12} /> Undo AI</button>
              <button onClick={() => setAiUndo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}><X size={13} /></button>
            </div>
          )}
          <div className="form-group"><label>Campaign Name</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. June Promotion" /></div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Subject Line</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
                Merge tags: <code style={{ color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 5px', borderRadius: 3 }}>{'{{name}}'}</code> <code style={{ color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 5px', borderRadius: 3 }}>{'{{first_name}}'}</code> <code style={{ color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 5px', borderRadius: 3 }}>{'{{company}}'}</code>
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="e.g.  Hello {{name}}, here's your update" />
              {aiReady && (
                <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }} disabled={subjectIdeas === 'loading'} onClick={suggestSubjects}
                  title="Suggest subject lines based on the email body">
                  <Sparkles size={14} className={subjectIdeas === 'loading' ? 'spin' : ''} /> {subjectIdeas === 'loading' ? 'Thinking…' : 'Suggest'}
                </button>
              )}
            </div>
            {Array.isArray(subjectIdeas) && (
              <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg3)', padding: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', padding: '2px 6px 6px' }}>
                  <span>Click to use as the subject, or "B" to A/B test it</span>
                  <button onClick={() => setSubjectIdeas(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={12} /></button>
                </div>
                {subjectIdeas.map((o, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 4 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => { set('subject', o.subject); setSubjectIdeas(null) }}>
                      <div style={{ fontSize: 13, color: 'var(--text-h)' }}>{o.subject}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{o.reason}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" title="Use as subject B (A/B test)" onClick={() => { set('ab_subject_b', o.subject); toast.success('Set as subject B') }}>B</button>
                  </div>
                ))}
              </div>
            )}
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
            <RichEditor value={form.html} onChange={v => set('html', v)} customTags={customTags} aiReady={aiReady} />
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
  const [scheduledAt, setScheduledAt]   = useState(campaign.scheduled_at || null)
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
    if (r.ok) {
      toast.success(`Scheduled for ${new Date(scheduleTime).toLocaleString()}`)
      setScheduledAt(scheduleTime)
      setScheduleMode(false)
    } else {
      toast.error(r.error)
    }
  }

  const editSchedule = () => {
    // datetime-local input needs "YYYY-MM-DDTHH:mm" — trim any seconds/offset
    setScheduleTime(scheduledAt ? scheduledAt.slice(0, 16) : '')
    setScheduleMode(true)
  }

  const cancelScheduleSend = async () => {
    const r = await window.api.campaigns.cancelSchedule(campaign.id)
    if (r.ok) {
      toast.success('Schedule cancelled')
      setScheduledAt(null)
      setScheduleMode(false)
    } else {
      toast.error(r.error || 'Could not cancel')
    }
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
          {!scheduleMode && scheduledAt && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: 'var(--radius)', padding: '8px 10px', marginBottom: 8 }}>
                Scheduled for {new Date(scheduledAt).toLocaleString()}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={editSchedule}><Clock size={14} /> Reschedule</button>
                <button className="btn btn-ghost" onClick={cancelScheduleSend}><X size={14} /> Cancel schedule</button>
              </div>
            </div>
          )}
          {!scheduleMode && !scheduledAt && (
            <button className="btn btn-ghost" onClick={() => setScheduleMode(true)}><Calendar size={14} /> Schedule for later</button>
          )}
          {scheduleMode && (
            <div>
              <input type="datetime-local" className="input" style={{ marginBottom: 8 }} value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} min={new Date().toISOString().slice(0,16)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={scheduleSend}><Clock size={14} /> {scheduledAt ? 'Save new time' : 'Schedule'}</button>
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

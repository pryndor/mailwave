import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit2, FileText, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import RichEditor from '../components/RichEditor.jsx'

export default function Templates() {
  const [templates, setTemplates] = useState([])
  const [editing, setEditing]     = useState(null) // null | 'new' | template obj

  const load = () => window.api.templates.list().then(setTemplates)
  useEffect(() => { load() }, [])

  const del = async (id) => {
    if (!confirm('Delete template?')) return
    await window.api.templates.delete(id)
    toast.success('Deleted')
    load()
  }

  if (editing !== null) {
    return <TemplateEditor tpl={editing === 'new' ? null : editing} onSave={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
  }

  return (
    <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, color: 'var(--text-h)', fontWeight: 700 }}>Templates</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>Reusable email templates</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> New Template</button>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 60 }}>
          <FileText size={40} />
          <p>No templates yet. Create one to reuse in campaigns.</p>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Create Template</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {templates.map(t => (
            <div key={t.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setEditing(t)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-h)', marginBottom: 4 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{t.subject}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Updated {t.updated_at?.slice(0,10)}</div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                  onClick={e => { e.stopPropagation(); del(t.id) }}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateEditor({ tpl, onSave, onCancel }) {
  const [form, setForm] = useState(tpl || { name: '', subject: '', html: '', text: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Template name required'); return }
    await window.api.templates.save(form)
    toast.success('Template saved')
    onSave()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, color: 'var(--text-h)', fontWeight: 700 }}>{tpl ? 'Edit Template' : 'New Template'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Check size={14} /> Save</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div className="form-row" style={{ marginBottom: 14 }}>
          <div className="form-group"><label>Template Name</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Monthly Promo" /></div>
          <div className="form-group"><label>Default Subject</label><input className="input" value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="Email subject line" /></div>
        </div>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>HTML Body <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— supports {'{{name}}'}, {'{{email}}'}, {'{{first_name}}'}, {'{{unsubscribe}}'}</span></label>
          <RichEditor value={form.html} onChange={v => set('html', v)} />
        </div>
        <div className="form-group">
          <label>Plain Text (fallback)</label>
          <textarea className="textarea" rows={5} value={form.text} onChange={e => set('text', e.target.value)} placeholder="Plain text version..." />
        </div>
      </div>
    </div>
  )
}

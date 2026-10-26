import { useEffect, useState, useRef } from 'react'
import { Plus, Upload, Download, Trash2, Search, Tag, Edit2, X, Check, Users, RefreshCw, FolderOpen, Folder, ChevronRight, Sparkles, FolderPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import Papa from 'papaparse'
import useAiConfig from '../hooks/useAiConfig.js'
import { autoMapColumns, describeShape, applyMapping, findEmailByValues, IMPORT_TARGETS } from '../utils/importMapping.js'

export default function Subscribers() {
  const [rows, setRows]         = useState([])
  const [total, setTotal]       = useState(0)
  const [stats, setStats]       = useState({})
  const [groups, setGroups]     = useState([])
  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState('all')
  const [groupFilter, setGroupFilter] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [page, setPage]         = useState(1)
  const [showAdd, setShowAdd]   = useState(false)
  const [editSub, setEditSub]   = useState(null)
  const [showGroup, setShowGroup]       = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const { ready: aiReady } = useAiConfig()
  const [smartQuery, setSmartQuery] = useState('')
  const [smart, setSmart]           = useState(null)   // { filter, explanation, unsupported }
  const [smartBusy, setSmartBusy]   = useState(false)

  const load = () => {
    window.api.subscribers.list({ search, status, group_id: groupFilter || null, page, limit: 100, filter: smart?.filter || null })
      .then(d => { setRows(d.rows); setTotal(d.total) })
    window.api.subscribers.stats().then(setStats)
    window.api.groups.list().then(setGroups)
  }

  useEffect(() => { load() }, [search, status, groupFilter, page, smart])

  const runSmartFilter = async () => {
    if (!smartQuery.trim()) return
    setSmartBusy(true)
    const r = await window.api.ai.subscriberFilter({ query: smartQuery })
    setSmartBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setSmart(r)
    setPage(1)
  }

  const saveSmartAsGroup = async () => {
    const name = prompt('Save these subscribers as a group. Group name:', smartQuery.slice(0, 40))
    if (!name?.trim()) return
    const r = await window.api.subscribers.filterToGroup({ filter: smart.filter, group_name: name })
    if (!r.ok) { toast.error(r.error); return }
    toast.success(`${r.count} subscriber(s) added to ${r.existing ? 'existing' : 'new'} group "${name.trim()}"`)
    load()
  }

  const toggleSelect = (id) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleAll = () => {
    setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))
  }

  const handleDelete = async () => {
    if (!selected.size) return
    if (!confirm(`Delete ${selected.size} subscriber(s)?`)) return
    await window.api.subscribers.delete([...selected])
    toast.success(`Deleted ${selected.size} subscriber(s)`)
    setSelected(new Set())
    load()
  }

  const openImportFlow = () => setShowImportModal(true)

  const handleWebsiteSync = async () => {
    const cfg = await window.api.settings.get()
    if (!cfg.sync_host || !cfg.sync_path) {
      toast.error('Configure FTP/SFTP sync settings first (Settings → Website Subscriber Sync)')
      return
    }
    const id = toast.loading('Connecting to server...')
    const result = await window.api.sync.fromServer({
      protocol: cfg.sync_protocol,
      host:     cfg.sync_host,
      port:     cfg.sync_port,
      user:     cfg.sync_user,
      password: cfg.sync_password,
      remote_path: cfg.sync_path,
      tls:      cfg.sync_tls,
    })
    if (!result.ok) { toast.error(`Sync failed: ${result.error}`, { id }); return }
    toast.loading(`Importing ${result.rows.length} rows...`, { id })
    const imported = await window.api.subscribers.import(result.rows)
    toast.success(
      `Sync done — ${imported.inserted} new, ${imported.updated} updated, ${imported.skipped} skipped (invalid, duplicate or undeliverable)`,
      { id, duration: 6000 }
    )
    load()
  }

  const handleExport = async () => {
    const data = await window.api.subscribers.export()
    const csv  = Papa.unparse(data)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'subscribers.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported successfully')
  }

  const handleAssignGroup = async (groupId, action) => {
    if (!selected.size) { toast.error('Select subscribers first'); return }
    await window.api.groups.assign({ subscriber_ids: [...selected], group_id: groupId, action })
    toast.success(action === 'add' ? 'Added to group' : 'Removed from group')
    load()
  }

  const addGroup = async () => {
    if (!newGroupName.trim()) return
    await window.api.groups.add(newGroupName.trim())
    setNewGroupName('')
    setShowNewGroup(false)
    load()
  }

  const deleteGroup = async (id) => {
    if (!confirm('Delete this group? Subscribers will not be deleted.')) return
    await window.api.groups.delete(id)
    if (groupFilter === String(id)) setGroupFilter('')
    load()
  }

  const activeGroup = groups.find(g => String(g.id) === String(groupFilter))

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: Group Sidebar ── */}
      <div style={{
        width: 210, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--bg2)', overflow: 'hidden'
      }}>
        {/* Sidebar header */}
        <div style={{ padding: '14px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Groups</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ padding: '2px 6px', fontSize: 11 }}
            title="New group"
            onClick={() => setShowNewGroup(v => !v)}
          >
            <Plus size={11} />
          </button>
        </div>

        {/* New group input */}
        {showNewGroup && (
          <div style={{ padding: '0 10px 8px', display: 'flex', gap: 4 }}>
            <input
              className="input"
              placeholder="Group name…"
              value={newGroupName}
              autoFocus
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addGroup(); if (e.key === 'Escape') { setShowNewGroup(false); setNewGroupName('') } }}
              style={{ padding: '4px 8px', fontSize: 12 }}
            />
            <button className="btn btn-primary btn-sm" onClick={addGroup} style={{ padding: '4px 8px' }}><Check size={11} /></button>
          </div>
        )}

        {/* "All Subscribers" row */}
        <button
          onClick={() => setGroupFilter('')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', background: groupFilter === '' ? 'var(--accent-bg)' : 'transparent',
            border: 'none', cursor: 'pointer', color: groupFilter === '' ? 'var(--accent)' : 'var(--text)',
            fontSize: 13, fontWeight: groupFilter === '' ? 600 : 400, textAlign: 'left', width: '100%',
            borderLeft: groupFilter === '' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          <Users size={13} />
          <span style={{ flex: 1 }}>All Subscribers</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{stats.active ?? ''}</span>
        </button>

        {/* Group list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {groups.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
              No groups yet. Click + to create one.
            </div>
          )}
          {groups.map(g => {
            const isActive = String(groupFilter) === String(g.id)
            return (
              <div
                key={g.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 0,
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  background: isActive ? 'var(--accent-bg)' : 'transparent',
                }}
                className="group-row"
              >
                <button
                  onClick={() => { setGroupFilter(String(g.id)); setPage(1) }}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    color: isActive ? 'var(--accent)' : 'var(--text)',
                    fontSize: 13, fontWeight: isActive ? 600 : 400, textAlign: 'left',
                  }}
                >
                  {isActive ? <FolderOpen size={13} /> : <Folder size={13} />}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{g.count}</span>
                </button>
                <button
                  onClick={() => deleteGroup(g.id)}
                  title="Delete group"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-dim)', padding: '7px 10px 7px 2px', opacity: 0,
                    transition: 'opacity 0.15s',
                  }}
                  className="group-delete-btn"
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>

        {/* Stats at bottom */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          <div>{stats.active ?? 0} active</div>
          <div>{stats.unsubscribed ?? 0} unsubscribed</div>
          <div>{stats.bounced ?? 0} bounced</div>
        </div>
      </div>

      {/* ── Right: Subscriber Table ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {activeGroup ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Subscribers</span>
                <ChevronRight size={13} style={{ color: 'var(--text-dim)' }} />
                <h2 style={{ fontSize: 17, color: 'var(--text-h)', fontWeight: 700 }}>{activeGroup.name}</h2>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 2 }}>({activeGroup.count} members)</span>
              </>
            ) : (
              <h2 style={{ fontSize: 17, color: 'var(--text-h)', fontWeight: 700 }}>All Subscribers</h2>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={handleWebsiteSync} title="Pull subscribers from your website via FTP/SFTP"><RefreshCw size={14} /> Sync</button>
            <button className="btn btn-ghost" onClick={openImportFlow}><Upload size={14} /> Import CSV</button>
            <button className="btn btn-ghost" onClick={handleExport}><Download size={14} /> Export</button>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={14} /> Add Subscriber</button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input className="input" placeholder="Search by email, name, company…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              style={{ paddingLeft: 30 }} />
          </div>
          <select className="select" style={{ width: 130 }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
          </select>

          {aiReady && (
            <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 260 }}>
              <input className="input" placeholder='Smart filter, e.g. "active doctors in Chennai never emailed"' value={smartQuery}
                onChange={e => setSmartQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSmartFilter() }} />
              <button className="btn btn-ghost btn-sm" disabled={smartBusy || !smartQuery.trim()} onClick={runSmartFilter}
                title="Describe the subscribers you want; AI turns it into a filter (only field and group names are sent)">
                <Sparkles size={12} className={smartBusy ? 'spin' : ''} /> {smartBusy ? 'Filtering…' : 'Filter'}
              </button>
            </div>
          )}

          {selected.size > 0 && (
            <>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 4 }}>{selected.size} selected</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowGroup(true)}><Tag size={12} /> Move to Group</button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete}><Trash2 size={12} /> Delete</button>
            </>
          )}
        </div>

        {smart && (
          <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexShrink: 0 }}>
            <Sparkles size={13} color="var(--accent)" />
            <div style={{ flex: 1 }}>
              <span style={{ color: 'var(--text-h)' }}>{smart.explanation}</span>
              <span style={{ color: 'var(--text-dim)' }}> · {total} match{total === 1 ? '' : 'es'}</span>
              {smart.unsupported && <div style={{ color: 'var(--warning)', marginTop: 2 }}>Not applied: {smart.unsupported}</div>}
            </div>
            <button className="btn btn-ghost btn-sm" disabled={!total} onClick={saveSmartAsGroup}><FolderPlus size={12} /> Save as group</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSmart(null); setSmartQuery('') }}><X size={12} /> Clear</button>
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} /></th>
                <th>Email</th>
                <th>Name</th>
                <th>Company</th>
                <th>Groups</th>
                <th>Status</th>
                <th>Added</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8}>
                  <div className="empty-state">
                    <Users size={32} />
                    <span>{activeGroup ? `No subscribers in "${activeGroup.name}" yet` : 'No subscribers found'}</span>
                    {activeGroup && (
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                        Add subscribers manually or import a CSV, then use "Move to Group" to assign them here.
                      </span>
                    )}
                  </div>
                </td></tr>
              ) : rows.map(sub => (
                <tr key={sub.id}>
                  <td><input type="checkbox" checked={selected.has(sub.id)} onChange={() => toggleSelect(sub.id)} /></td>
                  <td style={{ color: 'var(--text-h)', fontWeight: 500 }}>{sub.email}</td>
                  <td>{sub.name || `${sub.first_name} ${sub.last_name}`.trim() || '—'}</td>
                  <td>{sub.company || '—'}</td>
                  <td>
                    {sub.groups ? sub.groups.split(',').map(g => (
                      <span key={g} className="tag" style={{ marginRight: 4 }}>{g}</span>
                    )) : '—'}
                  </td>
                  <td><StatusBadge status={sub.status} /></td>
                  <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{sub.created_at?.slice(0,10)}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditSub(sub)}><Edit2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 100 && (
            <div style={{ padding: '12px 20px', display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ padding: '4px 10px', fontSize: 12, color: 'var(--text-dim)' }}>Page {page} · {total} total</span>
              <button className="btn btn-ghost btn-sm" disabled={page * 100 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {(showAdd || editSub) && (
        <SubModal sub={editSub} onClose={() => { setShowAdd(false); setEditSub(null) }} onSave={() => { setShowAdd(false); setEditSub(null); load() }} />
      )}
      {showGroup && (
        <GroupAssignModal groups={groups} onAssign={handleAssignGroup} onClose={() => setShowGroup(false)} />
      )}
      {showImportModal && (
        <ImportModal
          groups={groups}
          defaultGroupId={groupFilter}
          onDone={() => { setShowImportModal(false); load() }}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Hover styles for group rows */}
      <style>{`
        .group-row:hover { background: var(--bg3) !important; }
        .group-row:hover .group-delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = { active: 'badge-green', unsubscribed: 'badge-yellow', bounced: 'badge-red' }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>
}

function SubModal({ sub, onClose, onSave }) {
  const [form, setForm] = useState(sub || { email: '', name: '', first_name: '', last_name: '', phone: '', company: '', status: 'active' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    const check = await window.api.subscribers.checkEmail(form.email || '')
    if (!check.ok) { toast.error(check.error); return }
    let email = check.email
    if (check.suggestion && confirm(`Did you mean ${check.suggestion}?\n\nOK uses ${check.suggestion}, Cancel keeps ${email}.`)) {
      email = check.suggestion
    }
    if (sub?.id) await window.api.subscribers.update({ ...form, email })
    else await window.api.subscribers.add({ ...form, email })
    toast.success(sub ? 'Updated' : 'Subscriber added')
    onSave()
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>{sub ? 'Edit Subscriber' : 'Add Subscriber'}</h3>
        <div className="form-group"><label>Email *</label><input className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
        <div className="form-row">
          <div className="form-group"><label>First Name</label><input className="input" value={form.first_name} onChange={e => set('first_name', e.target.value)} /></div>
          <div className="form-group"><label>Last Name</label><input className="input" value={form.last_name} onChange={e => set('last_name', e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Display Name</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="form-group"><label>Company</label><input className="input" value={form.company} onChange={e => set('company', e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Phone</label><input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div className="form-group"><label>Status</label>
            <select className="select" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="bounced">Bounced</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}><Check size={14} /> Save</button>
        </div>
      </div>
    </div>
  )
}

const DROP_LABELS = {
  invalid:    'Invalid address',
  typo:       'Misspelled domain (gmial.com…)',
  trap:       'Spam trap address',
  role:       'Role address (info@, support@…)',
  disposable: 'Throwaway inbox',
  duplicate:  'Duplicate in the file',
  noMail:     "Domain can't receive email",
}

function ImportModal({ groups, defaultGroupId, onDone, onClose }) {
  const [groupId, setGroupId] = useState(defaultGroupId || '')
  const [loading, setLoading] = useState(false)
  const [clean, setClean]     = useState(true)
  const [skipRole, setSkipRole] = useState(false)
  const [result, setResult]   = useState(null)
  const [parsed, setParsed]   = useState(null)   // { rows, headers, fileName }
  const [mapping, setMapping] = useState({})     // header → target
  const [mapBusy, setMapBusy] = useState(false)
  const { ready: aiReady }    = useAiConfig()
  const fileRef = useRef()

  const handleDownloadTemplate = () => {
    const csv = Papa.unparse({
      fields: ['email', 'name', 'first_name', 'last_name', 'phone', 'company'],
      data: [['jane@example.com', 'Jane Doe', 'Jane', 'Doe', '+1 555 123 4567', 'Acme Inc']]
    })
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'contacts_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // Step 1: read the file and propose a column mapping (rules, then the
  // values' shape for a missing email column). Nothing is imported yet.
  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const headers = (res.meta.fields || []).filter(h => h && h.trim())
        if (!headers.length || !res.data.length) { toast.error('The file has no rows'); return }
        setMapping(findEmailByValues(res.data, headers, autoMapColumns(headers)))
        setParsed({ rows: res.data, headers, fileName: file.name })
      },
      error: (err) => toast.error(`CSV read error: ${err.message}`),
    })
    e.target.value = ''
  }

  // Columns the rules couldn't place go to the AI as header + value shape only.
  const guessWithAi = async () => {
    const sample = parsed.rows.slice(0, 50)
    setMapBusy(true)
    const r = await window.api.ai.mapColumns({
      columns: parsed.headers.map(h => ({ header: h, shape: describeShape(sample.map(row => row[h])) })),
    })
    setMapBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setMapping(m => {
      const next = { ...m }
      for (const c of r.columns) next[c.header] = c.target
      return next
    })
    toast.success('Columns mapped. Check them before importing')
  }

  // Step 2: import with the confirmed mapping.
  const doImport = async () => {
    const emailCols = Object.values(mapping).filter(t => t === 'email').length
    if (emailCols !== 1) { toast.error(emailCols ? 'Pick only one Email column' : 'Pick which column holds the email address'); return }
    setLoading(true)
    try {
      const gid = groupId ? Number(groupId) : null
      const res = await window.api.subscribers.import(applyMapping(parsed.rows, mapping), gid, { clean, skipRole })
      const groupName = gid ? groups.find(g => String(g.id) === String(gid))?.name : null
      const groupMsg  = groupName ? ` → added to "${groupName}"` : ''
      toast.success(`Imported: ${res.inserted} new, ${res.updated} updated, ${res.skipped} skipped${groupMsg}`)
      setResult(res)
    } catch (err) {
      toast.error(`Import failed: ${err?.message || err}`)
    }
    setLoading(false)
  }

  if (result) {
    const reasons = Object.entries(result.dropped || {}).filter(([, n]) => n > 0)
    return (
      <div className="modal-overlay">
        <div className="modal" style={{ maxWidth: 420 }}>
          <h3 style={{ marginBottom: 12 }}>Import complete</h3>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <div><strong>{result.inserted}</strong> new, <strong>{result.updated}</strong> updated</div>
            {result.suppressed > 0 && (
              <div style={{ color: 'var(--text-dim)' }}>
                {result.suppressed} came in as unsubscribed or bounced (from the file's status column) and won't be emailed
              </div>
            )}
          </div>
          {reasons.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>LEFT OUT ({result.skipped})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {reasons.map(([reason, n]) => (
                  <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: 'var(--bg3)', borderRadius: 4 }}>
                    <span>{DROP_LABELS[reason] || reason}</span><span>{n}</span>
                  </div>
                ))}
              </div>
              {result.examples?.length > 0 && (
                <details style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                  <summary style={{ cursor: 'pointer' }}>Examples</summary>
                  {result.examples.map((ex, i) => <div key={i}>{ex.email} — {DROP_LABELS[ex.reason] || ex.reason}</div>)}
                </details>
              )}
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={onDone}><Check size={14} /> Done</button>
          </div>
        </div>
      </div>
    )
  }

  if (parsed) {
    const sample = parsed.rows.slice(0, 50)
    return (
      <div className="modal-overlay">
        <div className="modal" style={{ maxWidth: 620, maxHeight: '90vh', overflow: 'auto' }}>
          <h3 style={{ marginBottom: 4 }}>Match columns</h3>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
            {parsed.fileName}: {parsed.rows.length} rows. Check what each column holds. Custom fields become merge tags like {'{{city}}'}.
          </p>
          <table style={{ marginBottom: 12 }}>
            <thead><tr><th>Column</th><th>Example</th><th>Import as</th></tr></thead>
            <tbody>
              {parsed.headers.map(h => {
                const example = sample.map(r => r[h]).find(v => String(v ?? '').trim()) || ''
                return (
                  <tr key={h}>
                    <td style={{ color: 'var(--text-h)', fontSize: 13 }}>{h}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(example)}</td>
                    <td>
                      <select className="select" style={{ fontSize: 12, padding: '4px 8px' }} value={mapping[h] || 'custom'}
                        onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}>
                        {IMPORT_TARGETS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {aiReady && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <button className="btn btn-ghost btn-sm" disabled={mapBusy} onClick={guessWithAi}>
                <Sparkles size={12} className={mapBusy ? 'spin' : ''} /> {mapBusy ? 'Guessing…' : 'Guess with AI'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sends only the column names and what the values look like (e.g. "dates"), not the values.</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-ghost" disabled={loading} onClick={() => setParsed(null)}>← Back</button>
            <button className="btn btn-primary" disabled={loading} onClick={doImport}>
              {loading ? (clean ? 'Checking & importing…' : 'Importing…') : <><Upload size={14} /> Import {parsed.rows.length} rows</>}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 380 }}>
        <h3 style={{ marginBottom: 4 }}>Import CSV</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
          Optionally assign all imported contacts to a group.
        </p>

        <button
          className="btn btn-ghost btn-sm"
          onClick={handleDownloadTemplate}
          style={{ marginBottom: 16 }}
        >
          <Download size={12} /> Download sample template (.csv)
        </button>

        <div className="form-group">
          <label>Assign to group</label>
          <select className="select" value={groupId} onChange={e => setGroupId(e.target.value)}>
            <option value="">— No group (All Subscribers only) —</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        {groupId && (
          <div style={{ fontSize: 12, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: 'var(--radius)', padding: '8px 10px', marginTop: 4, marginBottom: 4 }}>
            All imported contacts will be added to "{groups.find(g => String(g.id) === String(groupId))?.name}".
          </div>
        )}

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={clean} onChange={e => setClean(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Clean the list
            <span style={{ display: 'block', color: 'var(--text-dim)' }}>
              Leave out misspelled (gmial.com), throwaway and spam-trap addresses, and domains that can't receive email. Protects your sender reputation.
            </span>
          </span>
        </label>
        {clean && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 8, marginLeft: 22, cursor: 'pointer' }}>
            <input type="checkbox" checked={skipRole} onChange={e => setSkipRole(e.target.checked)} />
            Also leave out role addresses (info@, support@, sales@…)
          </label>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
          Exports from Mailchimp, beehiiv, Substack and others keep each contact's status: unsubscribed and bounced contacts stay that way.
        </p>

        {/* Hidden file input lives inside this modal — no timing issues */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleFile}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={loading}
            onClick={() => fileRef.current.click()}
          >
            <Upload size={14} /> Choose File…
          </button>
        </div>
      </div>
    </div>
  )
}

function GroupAssignModal({ groups, onAssign, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Move to Group</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
          Add or remove the selected subscribers from a group.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg3)', borderRadius: 'var(--radius)' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>{g.count} members</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => { onAssign(g.id, 'add'); onClose() }}>+ Add</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { onAssign(g.id, 'remove'); onClose() }}>− Remove</button>
              </div>
            </div>
          ))}
          {groups.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No groups yet. Create one from the left panel.</p>}
        </div>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

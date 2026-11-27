import { useState, useEffect, useMemo } from 'react'
import { Megaphone, Plus, Trash2, Edit2, Send, CalendarClock, Sparkles, Image, Link2, X, Plug, Unplug, ExternalLink, Copy, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

// Short colored badge per platform (no brand logos).
const PLATFORM_STYLE = {
  linkedin:  { label: 'in', color: '#0a66c2' },
  facebook:  { label: 'f',  color: '#1877f2' },
  instagram: { label: 'IG', color: '#d62976' },
  x:         { label: 'X',  color: '#444' },
  bluesky:   { label: 'bs', color: '#1185fe' },
  threads:   { label: '@',  color: '#555' },
  mastodon:  { label: 'M',  color: '#6364ff' },
  google:    { label: 'G',  color: '#34a853' },
  pinterest: { label: 'P',  color: '#e60023' },
}

const STATUS_BADGE = {
  draft: 'badge-gray', scheduled: 'badge-blue', publishing: 'badge-yellow',
  published: 'badge-green', partial: 'badge-yellow', failed: 'badge-red', missed: 'badge-red', pending: 'badge-gray',
}

function PlatformBadge({ platform, size = 20 }) {
  const s = PLATFORM_STYLE[platform] || { label: '?', color: '#666' }
  return (
    <span style={{ width: size, height: size, borderRadius: 5, background: s.color, color: '#fff', fontSize: size * 0.45, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {s.label}
    </span>
  )
}

// ISO → value for <input type="datetime-local"> in local time.
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fmt = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''

export default function Social() {
  const [tab, setTab]           = useState('posts')
  const [posts, setPosts]       = useState([])
  const [accounts, setAccounts] = useState([])
  const [config, setConfig]     = useState(null)
  const [editing, setEditing]   = useState(null) // null | 'new' | post

  const load = async () => {
    const [p, a, c] = await Promise.all([window.api.social.posts(), window.api.social.accounts(), window.api.social.config()])
    if (Array.isArray(p)) setPosts(p)
    if (Array.isArray(a)) setAccounts(a)
    if (c?.providers) setConfig(c)
  }
  useEffect(() => { load() }, [])
  useEffect(() => window.api.onSocialChanged(() => load()), [])

  if (editing !== null) {
    return <Composer post={editing === 'new' ? null : editing} accounts={accounts} config={config}
      onDone={() => { setEditing(null); load() }} onGoAccounts={() => { setEditing(null); setTab('accounts') }} />
  }

  const needsAttention = accounts.filter(a => a.expired || a.expiring)

  return (
    <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, color: 'var(--text-h)', fontWeight: 700 }}>Social</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>Write a post once, publish it to your social accounts now or later</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> New Post</button>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        {[['posts', `Posts (${posts.length})`], ['accounts', `Accounts (${accounts.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '8px 14px', fontSize: 13, fontWeight: 500,
            color: tab === id ? 'var(--accent)' : 'var(--text-dim)',
            borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`, marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {needsAttention.length > 0 && (
        <div className="card" style={{ borderColor: 'rgba(224,160,32,0.4)', marginBottom: 16, fontSize: 13 }}>
          {needsAttention.map(a => (
            <div key={a.id}>
              <strong>{a.name}</strong> ({a.platform}): {a.expired ? 'sign-in expired' : `sign-in expires ${fmt(a.expires_at)}`}. Scheduled posts to it will fail until you reconnect.{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => setTab('accounts')}>Reconnect</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'posts'
        ? <PostList posts={posts} accounts={accounts} onEdit={setEditing} onNew={() => setEditing('new')} onChanged={load} onGoAccounts={() => setTab('accounts')} />
        : <Accounts accounts={accounts} config={config} onChanged={load} />}
    </div>
  )
}

// ── Post list ────────────────────────────────────────────────────────────────

function PostList({ posts, accounts, onEdit, onNew, onChanged, onGoAccounts }) {
  if (!posts.length) {
    return (
      <div className="empty-state" style={{ marginTop: 50 }}>
        <Megaphone size={40} />
        <p>No posts yet.{accounts.length ? ' Write your first one.' : ' Connect an account first, then write your first post.'}</p>
        {accounts.length
          ? <button className="btn btn-primary" onClick={onNew}><Plus size={14} /> New Post</button>
          : <button className="btn btn-primary" onClick={onGoAccounts}><Plug size={14} /> Connect an account</button>}
      </div>
    )
  }

  const act = async (fn, okMsg) => {
    const r = await fn()
    if (r?.ok === false) toast.error(r.error || 'Something went wrong', { duration: 8000 })
    else if (okMsg) toast.success(okMsg)
    onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {posts.map(p => (
        <div key={p.id} className="card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span className={`badge ${STATUS_BADGE[p.status] || 'badge-gray'}`}>{p.status}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {p.status === 'scheduled' ? `Publishes ${fmt(p.scheduled_at)}` : p.published_at ? `Published ${fmt(p.published_at)}` : `Edited ${fmt(p.updated_at + 'Z')}`}
                </span>
                {p.image_path && <Image size={12} style={{ color: 'var(--text-dim)' }} />}
                {p.link && <Link2 size={12} style={{ color: 'var(--text-dim)' }} />}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{p.text || <em style={{ color: 'var(--text-dim)' }}>(no text)</em>}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                {p.targets.map(t => (
                  <span key={t.id} title={t.error || ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                    <PlatformBadge platform={t.platform} size={16} />
                    <span>{t.account_name}</span>
                    <span className={`badge ${STATUS_BADGE[t.status] || 'badge-gray'}`}>{t.status}</span>
                    {t.remote_url && <a href={t.remote_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}><ExternalLink size={11} /></a>}
                  </span>
                ))}
              </div>
              {p.targets.filter(t => t.status === 'failed' && t.error).map(t => (
                <div key={t.id} style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{t.account_name}: {t.error}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {p.status !== 'published' && p.status !== 'publishing' && (
                <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => onEdit(p)}><Edit2 size={12} /></button>
              )}
              {p.status === 'scheduled' && (
                <button className="btn btn-ghost btn-sm" onClick={() => act(() => window.api.social.unschedule(p.id), 'Moved back to drafts')}>Unschedule</button>
              )}
              {['failed', 'partial', 'missed'].includes(p.status) && (
                <button className="btn btn-ghost btn-sm" title="Publish the accounts that haven't got it yet"
                  onClick={() => confirm('Publish now to the accounts that haven\'t received this post? If one failed with "closed while publishing", check that platform first so it isn\'t posted twice.') && act(() => window.api.social.publishNow(p.id), 'Published')}>
                  <RefreshCw size={12} /> Retry
                </button>
              )}
              {p.status !== 'publishing' && (
                <button className="btn btn-ghost btn-sm" title={p.status === 'published' ? 'Remove from MailWave (the post stays on the platform)' : 'Delete'}
                  onClick={() => confirm(p.status === 'published' ? 'Remove this post from MailWave? It stays on the social platforms.' : 'Delete this post?') && act(() => window.api.social.delete(p.id))}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({ post, accounts, config, onDone, onGoAccounts }) {
  const [text, setText]         = useState(post?.text || '')
  const [link, setLink]         = useState(post?.link || '')
  const [imagePath, setImage]   = useState(post?.image_path || '')
  const [variants, setVariants] = useState(post?.variants || {})
  const [selected, setSelected] = useState(() => new Set(post ? post.targets.map(t => t.account_id) : accounts.filter(a => !a.expired).map(a => a.id)))
  const [view, setView]         = useState('all') // 'all' | platform id (its own version)
  const [busy, setBusy]         = useState('')
  const [scheduleAt, setScheduleAt] = useState(toLocalInput(post?.scheduled_at))
  const [showSchedule, setShowSchedule] = useState(post?.status === 'scheduled')
  const [ai, setAi]             = useState(null)

  useEffect(() => { window.api.ai.getConfig().then(setAi) }, [])

  const publishers = useMemo(() => Object.fromEntries((config?.publishers || []).map(p => [p.id, p])), [config])
  const limits = useMemo(() => Object.fromEntries((config?.publishers || []).map(p => [p.id, p.maxChars])), [config])
  const chosen = accounts.filter(a => selected.has(a.id))
  const platforms = [...new Set(chosen.map(a => a.platform))]
  const published = new Set((post?.targets || []).filter(t => t.status === 'published').map(t => t.account_id))

  const current = view === 'all' ? text : (variants[view] ?? '')
  const setCurrent = (v) => view === 'all' ? setText(v) : setVariants(prev => ({ ...prev, [view]: v }))
  const textFor = (pl) => (variants[pl]?.trim() ? variants[pl] : text)

  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const save = async () => {
    const r = await window.api.social.save({ id: post?.id, text, link: link.trim(), image_path: imagePath, variants, account_ids: [...selected] })
    if (r?.ok === false) { toast.error(r.error); return null }
    return r.post
  }

  const run = async (kind) => {
    setBusy(kind)
    try {
      const saved = await save()
      if (!saved) return
      if (kind === 'draft') { toast.success('Draft saved'); onDone(); return }
      if (kind === 'publish') {
        if (!confirm(`Publish now to ${chosen.length} account(s)?`)) return
        const r = await window.api.social.publishNow(saved.id)
        if (r?.ok) { toast.success('Published'); onDone() }
        else { toast.error(r?.error || 'Publishing failed', { duration: 10000 }); if (r?.post) onDone() }
        return
      }
      if (kind === 'schedule') {
        const r = await window.api.social.schedule({ id: saved.id, scheduled_at: new Date(scheduleAt).toISOString() })
        if (r?.ok) { toast.success(`Scheduled for ${fmt(r.post.scheduled_at)}`); onDone() }
        else toast.error(r?.error || 'Could not schedule', { duration: 8000 })
      }
    } finally { setBusy('') }
  }

  const pickImage = async () => {
    const r = await window.api.social.pickImage()
    if (r?.ok && r.path) setImage(r.path)
  }

  const aiReady = ai?.enabled && (ai.hasKey || !ai.needsKey)
  const runAi = async (mode, extra = {}) => {
    if (!platforms.length) { toast.error('Choose at least one account first'); return }
    setBusy('ai')
    try {
      const r = await window.api.ai.socialPost({ platforms, link, ...extra, ...(mode === 'adapt' ? { text } : {}) })
      if (r?.ok === false) { toast.error(r.error, { duration: 8000 }); return }
      if (!text.trim()) setText(r.variants[platforms[0]] || '')
      setVariants(prev => ({ ...prev, ...r.variants }))
      setView(platforms[0])
      toast.success('Versions written. Check each tab before publishing.')
    } finally { setBusy('') }
  }

  if (!accounts.length) {
    return (
      <div style={{ padding: 24, flex: 1 }}>
        <div className="empty-state" style={{ marginTop: 60 }}>
          <Plug size={40} />
          <p>Connect a social account before writing a post.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={onGoAccounts}><Plug size={14} /> Connect an account</button>
            <button className="btn btn-ghost" onClick={onDone}>Back</button>
          </div>
        </div>
      </div>
    )
  }

  const limit = view === 'all' ? Math.min(...platforms.map(p => limits[p] || Infinity)) : limits[view]
  const over = platforms.filter(p => textFor(p).length > (limits[p] || Infinity))
  const needImage = imagePath ? [] : platforms.filter(p => publishers[p]?.requiresImage).map(p => publishers[p].name)

  return (
    <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, color: 'var(--text-h)', fontWeight: 700 }}>{post ? 'Edit post' : 'New post'}</h2>
        <button className="btn btn-ghost" onClick={onDone}><X size={14} /> Close</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', marginBottom: 8 }}>Post to</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {accounts.map(a => (
                <button key={a.id} disabled={published.has(a.id)} onClick={() => toggle(a.id)}
                  title={published.has(a.id) ? 'Already published here' : a.expired ? 'Sign-in expired: reconnect on the Accounts tab' : ''}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 'var(--radius)', fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${selected.has(a.id) ? 'var(--accent)' : 'var(--border)'}`,
                    background: selected.has(a.id) ? 'var(--accent-bg)' : 'var(--bg3)', color: 'var(--text)',
                    opacity: a.expired || published.has(a.id) ? 0.55 : 1,
                  }}>
                  <PlatformBadge platform={a.platform} size={16} /> {a.name}{a.expired ? ' (expired)' : ''}{published.has(a.id) ? ' ✓' : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {[['all', 'Main text'], ...platforms.map(p => [p, (publishers[p]?.name || p) + (variants[p]?.trim() ? ' •' : '')])].map(([id, label]) => (
                <button key={id} className={`btn btn-sm ${view === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView(id)}>{label}</button>
              ))}
            </div>
            {view !== 'all' && (
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                Own version for this platform. Leave empty to use the main text.
                {variants[view]?.trim() && <> <button className="btn btn-ghost btn-sm" onClick={() => setVariants(prev => ({ ...prev, [view]: '' }))}>Use main text</button></>}
              </p>
            )}
            <textarea className="textarea" rows={10} value={current} onChange={e => setCurrent(e.target.value)}
              placeholder={view === 'all' ? 'What do you want to share? Announce an event, an offer, a new article…' : textFor(view)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, marginTop: 4, color: (view === 'all' ? text : textFor(view)).length > limit ? 'var(--danger)' : 'var(--text-dim)' }}>
              {(view === 'all' ? text : textFor(view)).length}{Number.isFinite(limit) ? ` / ${limit}` : ''}
            </div>

            <div className="form-row" style={{ marginTop: 10 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Link (optional)</label>
                <input className="input" value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={pickImage}><Image size={12} /> {imagePath ? 'Change image' : 'Add image'}</button>
              {imagePath && <>
                <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }} title={imagePath}>{imagePath.split(/[\\/]/).pop()}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setImage('')}><X size={12} /></button>
              </>}
            </div>
            {imagePath && link && <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>With an image attached, the image is shown instead of a link preview. Facebook gets the link added to the text; on LinkedIn, put it in the text yourself if people should click it.</p>}
          </div>

          {over.length > 0 && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>Too long for {over.join(', ')}. Shorten it, or write a shorter version on that platform's tab.</p>}
          {needImage.length > 0 && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{needImage.join(', ')} needs an image. Add one, or untick that account.</p>}
          {platforms.includes('instagram') && link && <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>Links in Instagram captions can't be clicked. Mention "link in bio" in the Instagram version if the link matters.</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" disabled={!!busy || !selected.size} onClick={() => run('publish')}><Send size={14} /> {busy === 'publish' ? 'Publishing…' : 'Publish now'}</button>
            <button className="btn btn-ghost" disabled={!!busy || !selected.size} onClick={() => setShowSchedule(v => !v)}><CalendarClock size={14} /> Schedule</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('draft')}>Save draft</button>
          </div>
          {showSchedule && (
            <div className="card" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="datetime-local" className="input" style={{ width: 'auto' }} value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
              <button className="btn btn-primary" disabled={!!busy} onClick={() => run('schedule')}>{post?.status === 'scheduled' ? 'Save new time' : 'Schedule'}</button>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>MailWave must be running (it can sit in the tray). Posts more than 6 hours late are held for you to decide.</span>
            </div>
          )}
        </div>

        <AiPanel ready={aiReady} busy={busy === 'ai'} hasText={!!text.trim()} onRun={runAi} />
      </div>
    </div>
  )
}

function AiPanel({ ready, busy, hasText, onRun }) {
  const [brief, setBrief] = useState('')
  const [campaigns, setCampaigns] = useState([])
  const [campaignId, setCampaignId] = useState('')
  useEffect(() => { window.api.campaigns.list().then(c => setCampaigns((c || []).filter(x => x.subject))) }, [])

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--text-h)', fontSize: 13, marginBottom: 10 }}>
        <Sparkles size={14} style={{ color: 'var(--accent)' }} /> AI writer
      </div>
      {!ready ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Turn on AI in Settings → AI to write and adapt posts for each platform.</p>
      ) : (
        <>
          <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Write from a short description</label>
          <textarea className="textarea" rows={3} value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Free health camp this Saturday 9am–1pm at our clinic, bring your reports" style={{ marginTop: 4 }} />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} disabled={busy || !brief.trim()} onClick={() => onRun('brief', { brief })}>
            <Sparkles size={12} /> {busy ? 'Writing…' : 'Write posts'}
          </button>

          <div className="divider" style={{ margin: '12px 0' }} />
          <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Fit my main text to each platform</label>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, display: 'flex' }} disabled={busy || !hasText} onClick={() => onRun('adapt')}>
            <Sparkles size={12} /> Adapt per platform
          </button>

          {campaigns.length > 0 && <>
            <div className="divider" style={{ margin: '12px 0' }} />
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Promote an email campaign</label>
            <select className="input" style={{ marginTop: 4 }} value={campaignId} onChange={e => setCampaignId(e.target.value)}>
              <option value="">Choose a campaign…</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} disabled={busy || !campaignId} onClick={() => onRun('campaign', { campaign_id: Number(campaignId) })}>
              <Sparkles size={12} /> Turn into posts
            </button>
          </>}
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12 }}>The AI writes a version per platform. Check facts and fill in any [placeholders] before publishing.</p>
        </>
      )}
    </div>
  )
}

// ── Accounts ─────────────────────────────────────────────────────────────────

const SETUP_STEPS = {
  meta: [
    <>Go to <strong>developers.facebook.com/apps</strong>, click <strong>Create app</strong>, and choose the use case for managing a business's Pages / <strong>Facebook Login</strong>. Leave the app in <strong>Development</strong> mode: as its admin you can post to your own Pages without Meta's review.</>,
    <>Add the permissions <strong>pages_show_list, pages_read_engagement, pages_manage_posts, business_management</strong>, and for Instagram <strong>instagram_basic, instagram_content_publish</strong>.</>,
    <>Under <strong>Facebook Login → Settings</strong>, add the redirect URL below to <strong>Valid OAuth Redirect URIs</strong>. (Meta allows localhost addresses while the app is in development mode.)</>,
    <>For Instagram: switch the Instagram account to a <strong>Business or Creator</strong> account and link it to your Facebook Page (Page settings → Linked accounts).</>,
    <>Copy the <strong>App ID</strong> and <strong>App Secret</strong> (App settings → Basic) into the fields here, save, then click Connect and tick the Pages and Instagram accounts to share.</>,
  ],
  linkedin: [
    <>Go to <strong>linkedin.com/developers/apps</strong> and click <strong>Create app</strong>. It needs a LinkedIn Company Page to be linked; any page you admin works.</>,
    <>On the app's <strong>Products</strong> tab, add <strong>Sign In with LinkedIn using OpenID Connect</strong> and <strong>Share on LinkedIn</strong>. Both are approved instantly.</>,
    <>On the <strong>Auth</strong> tab, add the redirect URL below under <strong>Authorized redirect URLs</strong>.</>,
    <>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from the Auth tab into the fields here, save, then click Connect.</>,
  ],
}

const PROVIDER_NOTE = {
  linkedin: 'Posts to your personal profile · up to 3000 characters · one image or link per post',
  meta: 'Posts to Facebook Pages you manage, and to Instagram Business/Creator accounts linked to them · Instagram needs an image',
}
const CREDENTIAL_LABELS = { meta: ['App ID', 'App Secret'], linkedin: ['Client ID', 'Client Secret'] }

function Accounts({ accounts, config, onChanged }) {
  if (!config) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {config.providers.map(p => (
        <PlatformCard key={p.id} platform={p} accounts={accounts.filter(a => p.platforms.includes(a.platform))} onChanged={onChanged} />
      ))}
      <div className="card">
        <div style={{ fontWeight: 600, color: 'var(--text-h)', fontSize: 13, marginBottom: 10 }}>Coming next</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {config.comingSoon.map(p => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', opacity: 0.8 }}>
              <PlatformBadge platform={p.id} size={16} /> {p.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function PlatformCard({ platform, accounts, onChanged }) {
  const [clientId, setClientId] = useState(platform.clientId)
  const [secret, setSecret]     = useState('')
  const [connecting, setConnecting] = useState(false)
  const [showSetup, setShowSetup]   = useState(!platform.clientId)
  const configured = platform.clientId && platform.hasSecret

  const saveCreds = async () => {
    const r = await window.api.social.saveAppConfig({ provider: platform.id, clientId, ...(secret ? { clientSecret: secret } : {}) })
    if (r?.ok === false) { toast.error(r.error); return }
    setSecret('')
    toast.success('Saved')
    onChanged()
  }

  const connect = async () => {
    setConnecting(true)
    try {
      const r = await window.api.social.connect(platform.id)
      if (r?.ok) { toast.success(`Connected ${r.accounts.map(a => a.name).join(', ')}`); onChanged() }
      else toast.error(r?.error || 'Could not connect', { duration: 10000 })
    } finally { setConnecting(false) }
  }

  const disconnect = async (a) => {
    if (!confirm(`Disconnect ${a.name}? Scheduled posts to this account won't go out. To fully revoke access, also remove the app in your ${a.platform === 'linkedin' ? 'LinkedIn' : 'Facebook'} settings.`)) return
    await window.api.social.disconnect(a.id)
    onChanged()
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {platform.platforms.map(id => <PlatformBadge key={id} platform={id} size={26} />)}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-h)', fontSize: 14 }}>{platform.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{PROVIDER_NOTE[platform.id]}</div>
        </div>
        {connecting
          ? <button className="btn btn-ghost" onClick={() => window.api.social.cancelConnect()}>Cancel sign-in</button>
          : <button className="btn btn-primary" disabled={!configured} title={configured ? '' : 'Add the app credentials first'} onClick={connect}><Plug size={14} /> Connect</button>}
      </div>
      {connecting && <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>Finish signing in in your browser, then come back here.</p>}

      {accounts.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          {a.avatar ? <img src={a.avatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} /> : <PlatformBadge platform={a.platform} size={28} />}
          <div style={{ flex: 1, fontSize: 13 }}>
            <div style={{ color: 'var(--text-h)' }}>{a.name}</div>
            <div style={{ fontSize: 11, color: a.expired ? 'var(--danger)' : a.expiring ? '#e0a020' : 'var(--text-dim)' }}>
              {a.expired ? 'Sign-in expired: click Connect to renew' : a.expires_at ? `Sign-in valid until ${fmt(a.expires_at)}` : 'Connected'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => disconnect(a)}><Unplug size={12} /> Disconnect</button>
        </div>
      ))}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: accounts.length ? 0 : 4 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSetup(v => !v)}>{showSetup ? 'Hide' : 'Show'} app setup{configured ? '' : ' (needed once)'}</button>
        {showSetup && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              MailWave connects through your own free {platform.name} developer app, the same way it sends email through your own SMTP account. Nothing goes through our servers.
            </p>
            <ol style={{ fontSize: 12, color: 'var(--text)', paddingLeft: 18, marginBottom: 12, lineHeight: 1.7 }}>
              {(SETUP_STEPS[platform.id] || []).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <div className="form-group">
              <label>Redirect URL</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" readOnly value={platform.redirectUri} />
                <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(platform.redirectUri); toast.success('Copied') }}><Copy size={12} /></button>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label>{(CREDENTIAL_LABELS[platform.id] || CREDENTIAL_LABELS.linkedin)[0]}</label>
                <input className="input" value={clientId} onChange={e => setClientId(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>{(CREDENTIAL_LABELS[platform.id] || CREDENTIAL_LABELS.linkedin)[1]} {platform.hasSecret && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(saved; type to replace)</span>}</label>
                <input className="input" type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={platform.hasSecret ? '••••••••' : ''} />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveCreds} disabled={!clientId.trim() || (!secret && !platform.hasSecret)}>Save credentials</button>
          </div>
        )}
      </div>
    </div>
  )
}

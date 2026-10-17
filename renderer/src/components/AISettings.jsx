import { useEffect, useState } from 'react'
import { Sparkles, Wifi, Check, Lock } from 'lucide-react'
import toast from 'react-hot-toast'

const h3Style = { fontSize: 14, color: 'var(--text-h)', marginBottom: 4, paddingBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }
const dim = { fontSize: 12, color: 'var(--text-dim)' }

// AI writing & review settings. Saved through ai:saveConfig (not the main
// Settings form) so the API key is written in the main process, sealed, and
// never read back into the renderer.
export default function AISettings() {
  const [cfg, setCfg]     = useState(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy]   = useState(false)
  const [testMsg, setTestMsg] = useState(null)

  const load = () => window.api.ai.getConfig().then(setCfg)
  useEffect(() => { load() }, [])
  if (!cfg) return null

  const set = (k, v) => { setCfg(c => ({ ...c, [k]: v })); setTestMsg(null) }

  const save = async () => {
    setBusy(true)
    const data = {
      enabled: cfg.enabled, provider: cfg.provider,
      model_fast: cfg.model_fast, model_smart: cfg.model_smart,
      brand_about: cfg.brand_about, brand_tone: cfg.brand_tone,
      brand_avoid: cfg.brand_avoid, brand_signoff: cfg.brand_signoff,
    }
    if (keyInput.trim()) data.api_key = keyInput.trim()
    const r = await window.api.ai.saveConfig(data)
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }
    setKeyInput('')
    setCfg(r.config)
    toast.success('AI settings saved')
  }

  const removeKey = async () => {
    const r = await window.api.ai.saveConfig({ api_key: '' })
    if (r.ok) { setCfg(r.config); toast.success('API key removed') }
  }

  const test = async () => {
    setBusy(true); setTestMsg(null)
    const r = await window.api.ai.test()
    setBusy(false)
    setTestMsg(r)
    r.ok ? toast.success('AI connection works') : toast.error(r.error)
  }

  const usage = cfg.usage || {}

  return (
    <section>
      <h3 style={h3Style}>
        <Sparkles size={14} color="var(--accent)" /> AI Writing &amp; Review
        <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12 }}>— draft emails, subject lines, rewrites, replies</span>
      </h3>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-h)' }}>Enable AI features</div>
          <div style={dim}>Uses your own Anthropic API key. You pay Anthropic directly for usage.</div>
        </div>
        <Toggle checked={!!cfg.enabled} onChange={v => set('enabled', v)} />
      </div>

      {cfg.enabled && (
        <>
          <div className="form-group">
            <label>Provider</label>
            <select className="select" value={cfg.provider} onChange={e => set('provider', e.target.value)}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="mock">Mock: sample output, no key, for testing</option>
            </select>
          </div>

          {cfg.provider === 'anthropic' && (
            <>
              <div className="form-group">
                <label>API Key {cfg.hasKey && <span className="badge badge-green" style={{ marginLeft: 6 }}>saved</span>}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
                    placeholder={cfg.hasKey ? 'Saved. Enter a new key to replace it' : 'sk-ant-...'} />
                  {cfg.hasKey && <button className="btn btn-ghost" onClick={removeKey}>Remove</button>}
                </div>
                <p style={{ ...dim, marginTop: 6 }}>
                  Get a key at console.anthropic.com. Stored encrypted in your OS keychain where available, and never synced through Team Sync.
                </p>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Fast model <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(subject lines, rewrites)</span></label>
                  <input className="input" value={cfg.model_fast} onChange={e => set('model_fast', e.target.value)} placeholder="claude-haiku-5-5" />
                </div>
                <div className="form-group">
                  <label>Smart model <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(drafts, replies, review)</span></label>
                  <input className="input" value={cfg.model_smart} onChange={e => set('model_smart', e.target.value)} placeholder="claude-sonnet-5-5" />
                </div>
              </div>
            </>
          )}

          <div style={{ fontSize: 12, color: 'var(--text-h)', fontWeight: 600, margin: '16px 0 8px' }}>Brand voice <span style={{ ...dim, fontWeight: 400 }}>— used in every AI-written email</span></div>
          <div className="form-group">
            <label>About your company / newsletter</label>
            <textarea className="textarea" rows={3} value={cfg.brand_about || ''} onChange={e => set('brand_about', e.target.value)}
              placeholder="e.g. We are a small pharmacy chain and send a monthly health newsletter to our customers." />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Default tone</label>
              <select className="select" value={cfg.brand_tone} onChange={e => set('brand_tone', e.target.value)}>
                <option value="friendly">Friendly</option>
                <option value="formal">Formal</option>
                <option value="clinical">Clinical / scientific</option>
                <option value="playful">Playful</option>
              </select>
            </div>
            <div className="form-group">
              <label>Sign-off</label>
              <input className="input" value={cfg.brand_signoff || ''} onChange={e => set('brand_signoff', e.target.value)} placeholder="e.g. The Bak.dev team" />
            </div>
          </div>
          <div className="form-group">
            <label>Words to avoid</label>
            <input className="input" value={cfg.brand_avoid || ''} onChange={e => set('brand_avoid', e.target.value)} placeholder="e.g. cure, guaranteed, miracle" />
          </div>

          <div style={{ ...dim, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
            <strong style={{ color: 'var(--text-h)' }}>What is sent to the AI:</strong> the brief or text you write, the campaign subject and body,
            and for follow-ups the delivered/failed counts. Subscriber emails, names and custom field values are never sent.
            Only call metadata (feature, tokens, time) is logged on this computer.
            {!cfg.pro && <div style={{ marginTop: 6 }}><Lock size={11} style={{ verticalAlign: -1 }} /> AI pre-send review is a Pro feature. Writing tools work on every plan.</div>}
          </div>

          <div style={{ ...dim, marginBottom: 12 }}>
            This month: {usage.calls || 0} calls · {(usage.input_tokens || 0).toLocaleString()} input / {(usage.output_tokens || 0).toLocaleString()} output tokens
            {usage.failed > 0 && ` · ${usage.failed} failed`}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}><Check size={14} /> Save AI Settings</button>
        {cfg.enabled && (
          <button className="btn btn-ghost" disabled={busy || (cfg.provider === 'anthropic' && !cfg.hasKey)} onClick={test}>
            <Wifi size={14} /> Test AI connection
          </button>
        )}
        {testMsg && <span style={{ fontSize: 12, color: testMsg.ok ? 'var(--success)' : 'var(--danger)' }}>{testMsg.ok ? testMsg.message : testMsg.error}</span>}
      </div>
    </section>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
      background: checked ? 'var(--accent)' : 'var(--bg3)',
      boxShadow: checked ? '0 0 0 1px var(--accent)' : '0 0 0 1px var(--border)',
      position: 'relative', flexShrink: 0, transition: 'background 0.2s',
    }}>
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

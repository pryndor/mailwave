import { TONE_OPTIONS } from '../utils/tones.js'

// Tone for one AI-written email or series; "" uses the brand voice tone from Settings.
export default function ToneSelect({ value, onChange }) {
  return (
    <select className="select" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Brand default (Settings)</option>
      {TONE_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  )
}

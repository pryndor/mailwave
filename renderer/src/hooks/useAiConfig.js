import { useEffect, useState } from 'react'

// AI settings as the main process reports them (no API key, just hasKey).
// `ready` = AI is on and has a key, or its provider needs none (mock, Ollama,
// a custom endpoint).
export default function useAiConfig() {
  const [config, setConfig] = useState(null)
  const reload = () => window.api.ai.getConfig().then(setConfig)
  useEffect(() => { reload() }, [])
  const ready = !!config?.enabled && (config.hasKey || !config.needsKey || config.provider === 'mock')
  return { config, ready, reload }
}

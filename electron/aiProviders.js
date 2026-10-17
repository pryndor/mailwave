// AI providers. The user pastes one API key; detectProvider() works out whose
// it is from the key's prefix (or, for ambiguous keys, by asking each likely
// provider's /models endpoint). Anthropic goes through its SDK in ai.js; every
// other provider — including local Ollama and custom endpoints — speaks the
// OpenAI-compatible chat API and goes through chatCompat() below.
//
// Default model names are a starting point only: after a key is saved,
// pickModel() checks them against the provider's live model list and falls
// back to the closest match, and the user can change them under Advanced.

class AiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const PROVIDERS = {
  anthropic:  { label: 'Anthropic (Claude)', fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' },
  openai:     { label: 'OpenAI (GPT)',       base: 'https://api.openai.com/v1', fast: 'gpt-5-mini', smart: 'gpt-5', tokenParam: 'max_completion_tokens' },
  gemini:     { label: 'Google Gemini',      base: 'https://generativelanguage.googleapis.com/v1beta/openai', fast: 'gemini-2.5-flash', smart: 'gemini-2.5-pro' },
  groq:       { label: 'Groq',               base: 'https://api.groq.com/openai/v1', fast: 'llama-3.1-8b-instant', smart: 'llama-3.3-70b-versatile' },
  xai:        { label: 'xAI (Grok)',         base: 'https://api.x.ai/v1', fast: 'grok-3-mini', smart: 'grok-4' },
  mistral:    { label: 'Mistral',            base: 'https://api.mistral.ai/v1', fast: 'mistral-small-latest', smart: 'mistral-large-latest' },
  deepseek:   { label: 'DeepSeek',           base: 'https://api.deepseek.com/v1', fast: 'deepseek-chat', smart: 'deepseek-chat' },
  openrouter: { label: 'OpenRouter',         base: 'https://openrouter.ai/api/v1', fast: 'anthropic/claude-haiku-4.5', smart: 'anthropic/claude-sonnet-4.5' },
  ollama:     { label: 'Ollama (local, no key)', base: 'http://localhost:11434/v1', fast: '', smart: '', noKey: true, local: true },
  custom:     { label: 'Custom (OpenAI-compatible)', base: '', fast: '', smart: '', local: true },
  mock:       { label: 'Mock (sample output, for testing)', fast: 'mock', smart: 'mock', noKey: true },
};

// Prefix → provider. `null` = ambiguous, probe these providers in order.
const KEY_PATTERNS = [
  [/^sk-ant-/,                    'anthropic'],
  [/^sk-or-/,                     'openrouter'],
  [/^sk-(proj|svcacct|admin)-/,   'openai'],
  [/^gsk_/,                       'groq'],
  [/^xai-/,                       'xai'],
  [/^AIza/,                       'gemini'],
  [/^sk-/,                        ['openai', 'deepseek']],
  [/^[A-Za-z0-9]{32}$/,           ['mistral']],
];
const FALLBACK_PROBE = ['openai', 'mistral', 'deepseek'];

const baseFor = (provider, baseUrl) => (baseUrl?.trim() || PROVIDERS[provider]?.base || '').replace(/\/+$/, '');

function authHeaders(provider, key) {
  const h = { 'content-type': 'application/json' };
  if (key) h.authorization = `Bearer ${key}`;
  else if (provider === 'ollama') h.authorization = 'Bearer ollama';
  if (provider === 'openrouter') { h['HTTP-Referer'] = 'https://drugvigil.com'; h['X-Title'] = 'MailWave'; }
  return h;
}

async function fetchJson(url, { timeoutMs = 20000, ...opts } = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new AiError('The AI request timed out. Try again.', 'timeout');
    throw new AiError(`Could not reach ${new URL(url).host}. Check your connection${url.includes('localhost') ? ' and that Ollama is running' : ''}.`, 'network');
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  return { res, body, text };
}

function httpError(status, body, text) {
  const msg = body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : '') || text?.slice(0, 200) || '';
  if (status === 401 || status === 403) return new AiError('The API key was rejected. Check it in Settings → AI.', 'auth');
  if (status === 404) return new AiError(`Model or endpoint not found${msg ? `: ${msg}` : ''}. Check the models under Settings → AI → Advanced.`, 'model');
  if (status === 429) return new AiError('Rate limit or usage quota reached. Wait a minute and try again.', 'rate_limit');
  if (status === 402) return new AiError(`Payment required by the AI provider${msg ? `: ${msg}` : ''}.`, 'billing');
  if (status >= 500)  return new AiError(`AI service error (${status}). Try again shortly.`, 'api');
  return new AiError(`AI request rejected: ${msg || `HTTP ${status}`}`, 'bad_request');
}

// ── Detection & model lists ───────────────────────────────────────────────────
async function compatModels(provider, key, baseUrl) {
  const base = baseFor(provider, baseUrl);
  if (!base) throw new AiError('Enter the endpoint URL first.', 'input');
  const { res, body, text } = await fetchJson(`${base}/models`, { headers: authHeaders(provider, key) });
  if (!res.ok) throw httpError(res.status, body, text);
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return list.map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}

async function detectProvider(key) {
  key = (key || '').trim();
  const hit = KEY_PATTERNS.find(([re]) => re.test(key));
  const candidates = hit ? hit[1] : FALLBACK_PROBE;
  if (typeof candidates === 'string') return candidates;
  for (const p of candidates) {
    try { await compatModels(p, key); return p; }
    catch (err) { if (err.code === 'network' || err.code === 'timeout') throw err; }
  }
  throw new AiError('Could not recognise this API key. Check it, or pick the provider under Advanced.', 'unknown_key');
}

const NON_CHAT = /embed|whisper|tts|dall-e|image|audio|moderation|realtime|transcribe|search|rerank|guard|ocr|codestral-mamba/i;
// Size hints as whole name parts ("gemini" must not match "mini"); models up
// to ~14B parameters count as fast.
const FAST_HINT = /(^|[-_.:/])(mini|flash|haiku|instant|small|lite|nano|tiny|([1-9]|1[0-4])(\.\d+)?b)([-_.:]|$)/i;

// The configured default if the provider still offers it; otherwise, among
// models of the right size for the tier, the newest from the same family
// (gemini-2.5-*), then the same variant (*-pro), then any.
function pickModel(models, preferred, tier) {
  if (!models?.length) return preferred;
  if (preferred && models.includes(preferred)) return preferred;
  const chat = models.filter(m => !NON_CHAT.test(m));
  const pool = chat.length ? chat : models;
  const sized = pool.filter(m => tier === 'fast' ? FAST_HINT.test(m) : !FAST_HINT.test(m));
  const candidates = sized.length ? sized : pool;
  const newest = (list) => [...list].sort().reverse()[0];
  const family  = (preferred || '').replace(/-[^-]*$/, '');
  const variant = (preferred || '').match(/-([a-z]+)$/i)?.[1];
  const sameFamily  = family ? candidates.filter(m => m.startsWith(family)) : [];
  if (sameFamily.length) return newest(sameFamily);
  const sameVariant = variant ? candidates.filter(m => m.endsWith(`-${variant}`)) : [];
  if (sameVariant.length) return newest(sameVariant);
  return candidates[0];
}

// ── OpenAI-compatible chat ────────────────────────────────────────────────────
function extractJson(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AiError('The AI returned an unreadable response. Try again or use a larger model.', 'parse');
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw new AiError('The AI returned an unreadable response. Try again or use a larger model.', 'parse'); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Structured output support varies: try a strict JSON schema first, then
// plain JSON mode, then no response_format at all (the schema is also in the
// system prompt, so the model still knows the shape).
async function chatCompat({ provider, key, baseUrl, model, system, user, schema, maxTokens }) {
  const def = PROVIDERS[provider] || {};
  const base = baseFor(provider, baseUrl);
  if (!base) throw new AiError('Enter the endpoint URL under Settings → AI → Advanced.', 'input');
  if (!model) throw new AiError('Choose a model under Settings → AI → Advanced.', 'model');

  const sys = schema
    ? `${system}\n\nReply with only a JSON object matching this JSON schema, with no other text:\n${JSON.stringify(schema)}`
    : system;
  const formats = schema
    ? [{ type: 'json_schema', json_schema: { name: 'output', schema, strict: true } }, { type: 'json_object' }, null]
    : [null];

  for (let f = 0; f < formats.length; f++) {
    const body = {
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      [def.tokenParam || 'max_tokens']: maxTokens,
    };
    if (formats[f]) body.response_format = formats[f];

    for (let attempt = 0; ; attempt++) {
      const { res, body: out, text } = await fetchJson(`${base}/chat/completions`, {
        method: 'POST', headers: authHeaders(provider, key), body: JSON.stringify(body),
        timeoutMs: def.local ? 300000 : 120000,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * (attempt + 1);
        await sleep(Math.min(wait, 10000));
        continue;
      }
      if (res.status === 400 && f < formats.length - 1) break; // try the next format
      if (!res.ok) throw httpError(res.status, out, text);

      const choice = out?.choices?.[0] || {};
      const content = Array.isArray(choice.message?.content)
        ? choice.message.content.map(p => p.text || '').join('')
        : choice.message?.content || '';
      const usage = { input_tokens: out?.usage?.prompt_tokens || 0, output_tokens: out?.usage?.completion_tokens || 0 };
      if (choice.finish_reason === 'content_filter' || choice.message?.refusal) {
        throw Object.assign(new AiError('The AI declined this request. Try rephrasing the brief.', 'refusal'), { usage });
      }
      if (choice.finish_reason === 'length') {
        throw Object.assign(new AiError('The AI response was cut off. Try a shorter email or brief.', 'truncated'), { usage });
      }
      return { result: schema ? extractJson(content) : content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(), usage };
    }
  }
  throw new AiError('This model could not produce the required format. Try a different model.', 'format');
}

module.exports = { AiError, PROVIDERS, detectProvider, compatModels, pickModel, chatCompat, httpError };

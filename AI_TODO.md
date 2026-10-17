# AI features: TODO

Status: **Phase 1 writing + review built (2026-10-17).** Written 2026-10-03.

Built so far: `electron/ai.js`, `electron/aiPrompts.js`, `electron/secrets.js` (shared with Team Sync),
`ai:*` IPC, Settings → AI Writing & Review, "Write with AI" (new draft / follow-up / reply to a pasted
message), subject suggestions (+ "use as B"), AI Rewrite in the editor toolbar, AI Review in the editor
and the pre-send checklist (Pro), `ai_log` table. Tests: fake-API harness (not in repo yet, see §6).

Decisions taken: fast = `claude-haiku-5-5` (newer and ~10x cheaper than Haiku 4.5), smart =
`claude-sonnet-5-5`; both editable in Settings. BYO key; writing free, review Pro. Requests to Sonnet 5.5
use the server-side refusal fallback (`fallbacks: "default"`), since health/drug wording can trip safety
classifiers. Still open: streaming, preheader (needs a campaign field + mailer
change), "send subscriber data" toggle (nothing in Phase 1 sends subscriber data).

Goal: add AI to MailWave for (1) writing emails, (2) analysing emails before and after sending, and (3) a set of smaller AI helpers that fit the existing app (subscribers, smart schedule, Brevo stats, automation API).

---

## 0. Foundation (do first, everything else depends on it)

### 0.1 AI provider module: `electron/ai.js` (new)
- [x] One `ai.complete({ system, messages, json, maxTokens })` function, used by every feature below.
- [x] Default provider: Claude API (`@anthropic-ai/sdk`).
  - [ ] Quick tasks (subject lines, rewrite, classify): `claude-haiku-4-5-20251001`.
  - [ ] Long tasks (full drafts, campaign reports): `claude-sonnet-5-5`.
- [x] Optional providers behind the same interface: OpenAI-compatible endpoint, local Ollama (offline / privacy users). Done in `electron/aiProviders.js`: one key field, provider auto-detected from the key (Claude, OpenAI, Gemini, Groq, xAI, Mistral, DeepSeek, OpenRouter); Ollama / custom endpoint / model choice under Advanced.
- [ ] Streaming support (`ai:stream` IPC + `webContents.send('ai:chunk')`) so drafts appear as they are written.
- [x] Structured output helper (JSON schema / tool use) for the analysis features.
- [x] Timeouts, retries on 429/5xx, clear error messages ("No API key", "Quota exceeded").
- [x] Prompt caching for the long system prompts (brand voice + template HTML).

### 0.2 Settings (`electron/settings.js`, `Settings.jsx`)
- [x] New DEFAULTS: `ai_provider`, `ai_model_fast`, `ai_model_smart`, `ai_base_url`, `ai_enabled`.
- [x] API key stored encrypted with `safeStorage` (same way Team Sync keeps its key), **not** plain text in `settings.json`.
- [x] Add AI keys to `withoutTeamKeys()` / never sync them through Team Sync or website sync.
- [x] "Test AI connection" button (like `settings:test` for SMTP).
- [x] Brand voice section: company description, tone (formal / friendly / clinical), words to avoid, sign-off. Saved once, injected into every writing prompt.

### 0.3 IPC + preload
- [x] `main.js`: `ai:*` handlers. `preload.js`: `window.api.ai.*`.
- [x] Never expose the API key to the renderer. All calls go through the main process.

### 0.4 Licensing / plan gating (`license.js`, `trial.js`)
- [ ] Decide model: BYO key (user pays Anthropic) vs. our hosted proxy (we pay, Pro only). Recommendation: **BYO key for Free, Pro unlocks the advanced features** (analysis, reports, bulk personalisation).
- [x] Gate in main process with `license.isPro()` / trial, same as `smartSchedule.js`.
- [x] Usage counter per month (tokens + calls) shown in Settings.

### 0.5 Privacy and safety
- [ ] Settings toggle: "Send subscriber data to AI" (off by default). When off, only campaign content is sent, never emails/names/custom fields.
- [ ] Strip / pseudonymise emails before sending subscriber data (`user_123@…`).
- [x] Short notice in Settings + README on what leaves the device.
- [x] Log AI calls (feature, model, tokens, time) in a new `ai_log` table. No content stored by default.

---

## 1. AI writing

Main place: `Campaigns.jsx` editor + `RichEditor.jsx` toolbar + `Templates.jsx`.

- [x] **Draft from brief**: panel "Write with AI": goal, audience (group), key points, CTA, length, tone. Returns subject + preheader + HTML body + plain text. Must keep merge tags (`{{first_name}}` etc.) valid.
- [x] **Subject line generator**: 5–10 options with a short reason for each. Click to apply. Feeds A/B testing (section 3).
- [ ] **Preheader generator**.
- [x] **Rewrite selection** (RichEditor toolbar): shorter, longer, friendlier, more formal, fix grammar, simplify, make persuasive.
- [ ] **Continue writing** from the cursor.
- [ ] **Generate plain-text version** from HTML (better than stripping tags).
- [ ] **Translate campaign** into another language, keeping HTML structure and merge tags.
- [ ] **Template generator**: describe a layout, get a responsive, email-safe HTML template (tables, inline CSS) saved into Templates.
- [ ] **CTA / button text suggestions**.
- [x] **Reply / follow-up draft**: from a past campaign in History, write the follow-up for non-openers or clickers.
- [ ] **Sequence writer**: outline + drafts for a welcome / nurture series (3–7 emails) as separate draft campaigns.
- [x] Validation after every generation: HTML sanitised, merge tags checked against `subscribers:customFields`, unsubscribe link kept.
- [x] Undo: AI output always lands as a change the user can revert, never silently overwrites.

---

## 2. AI analysis

### 2.1 Before sending: extend `PreSendChecklist.jsx`
- [x] **AI content review** next to the existing `utils/spamCheck.js` rule check: spam risk with reasons, readability grade, tone match with brand voice, length, clarity of CTA.
- [ ] **Deliverability hints**: image-to-text ratio, link count, link-shortener use, ALL CAPS, missing unsubscribe, missing physical address.
- [x] **Mistake finder**: typos, broken or placeholder links ("example.com", "TODO", "lorem"), wrong dates/days, merge tags with no data for many subscribers.
- [x] **Compliance check**: CAN-SPAM / GDPR basics; optional strict mode for health / pharma claims (unsupported medical claims, missing disclaimers).
- [ ] **Accessibility check**: missing alt text, low contrast, "click here" links.
- [x] **Subject line score** (0–100) with suggested improvements.
- [x] Results are advisory: show as warnings, never block sending (critical checks stay rule-based).

### 2.2 After sending: campaign reports (`History.jsx`, `CampaignMetrics.jsx`, `brevo.js`)
- [ ] **Campaign summary in plain language**: what went well / badly, compared to the user's own past campaigns (data from `send_history` + Brevo metrics).
- [ ] **Why did it under-perform?** Link results to subject, send time, length, audience.
- [ ] **Bounce / failure analysis**: group SMTP error messages in `send_history` into causes (bad address, mailbox full, blocked, rate-limited) with fixes.
- [ ] **Next-step suggestions**: resend to non-openers with a new subject, clean list, change send time.
- [ ] **Dashboard insight card** (`Dashboard.jsx`): weekly "3 things to know" from all campaigns.
- [ ] **Ask your data**: chat box ("Which group opens most?", "Best day to send last month?"). AI turns the question into a call to safe, read-only query functions in `db.js`; never raw SQL from the model.

---

## 3. Other AI features that fit MailWave

### Subscribers (`Subscribers.jsx`, `db.js`)
- [ ] **CSV import mapping**: AI guesses which column is email / first name / country / timezone when headers are messy.
- [ ] **Data cleaning**: fix name casing, split full names, spot role addresses (info@, admin@), likely typo domains (gmial.com), duplicates.
- [ ] **Auto-segmentation**: suggest groups from custom fields + engagement (e.g. "engaged doctors in India").
- [ ] **Engagement scoring / churn risk** per subscriber (rule-based score first, AI explains it).
- [ ] **Natural-language filter**: "subscribers from Germany who never opened" builds the filter.

### Personalisation and sending (`mailer.js`, `smartSchedule.js`)
- [ ] **Per-recipient personalised opening line** from custom fields (Pro, opt-in, batched, cost shown before running).
- [ ] **Dynamic content blocks**: different paragraph variants per group, chosen at send time.
- [ ] **AI send-time advice**: extend Smart Schedule with each subscriber's past open times (when Brevo data exists).
- [ ] **Subject A/B test**: split a small sample, pick the winner automatically, send the rest. Needs new campaign fields (`variant`, `test_size`, `winner_rule`).

### Templates
- [ ] **Template from screenshot / URL**: rebuild an email layout as editable HTML (Claude vision).
- [ ] **Image alt text generator** for images in the editor.

### Automation API (`automation-server.js`)
- [ ] Expose `POST /ai/draft` and `POST /ai/analyse` so n8n flows can create AI drafts (Pro, token-protected like other endpoints).

### Team Sync
- [ ] Sync the brand voice profile and saved AI prompts through `teamStore.js` (but never the API key).

### Assistant
- [ ] **In-app help assistant**: answers "how do I…" questions about MailWave settings (SMTP setup, daily limits, Team Sync), using README / TEAM_SYNC.md as context.

---

## 4. Code to modify (summary)

| File | Change |
|---|---|
| `package.json` | add `@anthropic-ai/sdk` (and optional `ollama` client) |
| `electron/ai.js` | **new**: provider wrapper, prompts, JSON helpers |
| `electron/aiPrompts.js` | **new**: all system prompts in one place, versioned |
| `electron/settings.js` | AI defaults, brand voice |
| `electron/main.js` | `ai:*` IPC handlers, key kept out of `settings:get` |
| `electron/preload.js` | `window.api.ai` |
| `electron/db.js` | `ai_log` table, read-only stats queries for "Ask your data", A/B fields on `campaigns` |
| `electron/mailer.js` | personalised lines, A/B split, winner pick |
| `electron/smartSchedule.js` | engagement-based send time |
| `electron/brevo.js` | per-recipient open/click data for analysis |
| `electron/automation-server.js` | `/ai/*` endpoints |
| `electron/teamStore.js` | sync brand voice + saved prompts |
| `renderer/src/components/AIPanel.jsx` | **new**: write-with-AI side panel |
| `renderer/src/components/RichEditor.jsx` | AI toolbar (rewrite / continue) |
| `renderer/src/components/PreSendChecklist.jsx` | AI review section |
| `renderer/src/components/AIInsights.jsx` | **new**: report + dashboard card |
| `renderer/src/pages/Campaigns.jsx` | open AI panel, subject options, A/B setup |
| `renderer/src/pages/History.jsx` | campaign AI report, follow-up draft |
| `renderer/src/pages/Subscribers.jsx` | import mapping, cleaning, NL filter, segments |
| `renderer/src/pages/Templates.jsx` | template generator |
| `renderer/src/pages/Settings.jsx` | AI section (provider, key, models, brand voice, privacy, usage) |
| `README.md` | AI setup + privacy notes |

---

## 5. Suggested order

1. **Phase 1 (MVP)**: 0.1–0.5 foundation, draft from brief, subject lines, rewrite selection, AI pre-send review.
2. **Phase 2**: campaign reports, bounce analysis, follow-up draft, template generator, translation.
3. **Phase 3**: subscriber cleaning / segmentation, NL filter, "Ask your data", dashboard insights.
4. **Phase 4**: per-recipient personalisation, A/B testing, AI send time, automation API endpoints, Team Sync of brand voice.

## 6. Testing

- [x] Mock provider in `ai.js` (returns fixed output) so features work in dev without a key.
- [ ] Golden tests for prompts: merge tags kept, unsubscribe link kept, valid HTML.
- [ ] Test with Ollama offline and with no key (features hidden or show "Set up AI").
- [ ] Check no subscriber data is sent when the privacy toggle is off (log outgoing payloads in dev).
- [ ] Cost check: tokens per feature on a typical campaign, shown in Settings.

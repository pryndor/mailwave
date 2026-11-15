# AI features: TODO

Written 2026-10-03. Last revised 2026-11-15.

**Status:** phases 1–3 are built and tested (`npm test`). Writing helpers are free with the user's own
API key; review, campaign reports and the Automation API's AI endpoints are Pro. No feature sends
subscriber addresses, names or field values to the AI; `tests/ai.test.js` checks this.

**2026-11-15:** paid plans are switched off (`PAID_PLANS_ENABLED` in `electron/license.js`), so
the Pro features are free for everyone for now. The Pro gating code is kept unchanged. See TODO.md.

Decisions taken: bring-your-own key for everyone, no hosted proxy. Default models: fast =
`claude-haiku-5-5`, smart = `claude-sonnet-5-5`, both editable in Settings (other providers get their own
defaults from `aiProviders.js`). Requests to Sonnet 5.5 use the server-side refusal fallback, since
health/drug wording can trip safety classifiers.

## What's left, in priority order

1. **Test with Ollama offline and with no key** (§6). Cheap, and catches regressions in the setup flow.
2. **Streaming** (§0.1). Long drafts and sequences show only a spinner until the whole result arrives.
3. **Dashboard insight card** (§2.2). Mostly rule-based from data that already exists; AI optional.
4. **Image alt text generator** (§3). Small, and the pre-send check already flags missing alt text.
5. **In-app help assistant** (§3). README and TEAM_SYNC.md are now complete enough to serve as context.
6. **Cost check per feature** (§6). Monthly calls and tokens are shown; per-feature cost isn't.
7. **Ask your data** (§2.2). Read-only query functions, like the Smart filter's structured approach.
8. **Template generator / template from screenshot** (§1, §3). Blocked: the editor keeps only simple
   tags, so table layouts would be stripped. Needs an HTML template mode first.
9. **Needs per-subscriber open/click data first** (MailWave doesn't store it yet): engagement scoring,
   AI send-time advice (§3).
10. **Needs the privacy toggle first** (§0.5), since they would send subscriber data: per-recipient
    opening lines, dynamic content blocks (§3).

---

## 0. Foundation (do first, everything else depends on it)

### 0.1 AI provider module: `electron/ai.js` (new)
- [x] One `ai.complete({ system, messages, json, maxTokens })` function, used by every feature below.
- [x] Default provider: Claude API (`@anthropic-ai/sdk`).
  - [x] Quick tasks (subject lines, rewrite, classify): `claude-haiku-5-5` (newer and cheaper than the Haiku 4.5 first planned).
  - [x] Long tasks (full drafts, campaign reports): `claude-sonnet-5-5`.
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
- [x] Decide model: BYO key (user pays Anthropic) vs. our hosted proxy (we pay, Pro only). Decided: **BYO key for everyone; writing free, review and reports Pro.**
- [x] Gate in main process with `license.isPro()` / trial, same as `smartSchedule.js`.
- [x] Usage counter per month (tokens + calls) shown in Settings.

### 0.5 Privacy and safety
- [ ] Settings toggle: "Send subscriber data to AI" (off by default). When off, only campaign content is sent, never emails/names/custom fields. Not needed yet: no current feature sends subscriber data. Build it together with the first feature that does.
- [ ] Strip / pseudonymise emails before sending subscriber data (`user_123@…`). Same as above.
- [x] Short notice in Settings + README on what leaves the device.
- [x] Log AI calls (feature, model, tokens, time) in a new `ai_log` table. No content stored by default.

---

## 1. AI writing

Main place: `Campaigns.jsx` editor + `RichEditor.jsx` toolbar + `Templates.jsx`.

- [x] **Draft from brief**: panel "Write with AI": goal, audience (group), key points, CTA, length, tone. Returns subject + preheader + HTML body + plain text. Must keep merge tags (`{{first_name}}` etc.) valid.
- [x] **Subject line generator**: 5–10 options with a short reason for each. Click to apply. Feeds A/B testing (section 3).
- [x] **Preheader generator**. Drafts, follow-ups, replies and sequences now return preview text too; "Suggest" next to the Preview Text field (`ai:previewText`).
- [x] **Rewrite selection** (RichEditor toolbar): shorter, longer, friendlier, more formal, fix grammar, simplify, make persuasive.
- [x] **Continue writing** from the cursor. "AI Write → Continue writing from cursor" in the editor (`ai:continue`).
- [x] **Generate plain-text version** from HTML (better than stripping tags). "Write with AI" next to Plain Text (`ai:plainText`).
- [x] **Translate campaign** into another language, keeping HTML structure and merge tags. Translate button in the editor (`ai:translate`); warns if links changed; undoable.
- [ ] **Template generator**: describe a layout, get a responsive, email-safe HTML template (tables, inline CSS) saved into Templates.
- [x] **CTA / button text suggestions**. "Turn into button text" rewrite action.
- [x] **Reply / follow-up draft**: from a past campaign in History, write the follow-up for non-openers or clickers.
- [x] **Sequence writer**: outline + drafts for a welcome / nurture series (3–7 emails) as separate draft campaigns. "AI Sequence" on the Campaigns page (`ai:sequence`); drafts are named with their send day, never auto-scheduled.
- [x] Validation after every generation: HTML sanitised, merge tags checked against `subscribers:customFields`, unsubscribe link kept.
- [x] Undo: AI output always lands as a change the user can revert, never silently overwrites.

---

## 2. AI analysis

### 2.1 Before sending: extend `PreSendChecklist.jsx`
- [x] **AI content review** next to the existing `utils/spamCheck.js` rule check: spam risk with reasons, readability grade, tone match with brand voice, length, clarity of CTA.
- [x] **Deliverability hints**: image-to-text ratio, link count, link-shortener use, ALL CAPS, missing unsubscribe, missing physical address. Rule-based in `utils/spamCheck.js` + checklist (postal address, Gmail clip, placeholder and http links).
- [x] **Mistake finder**: typos, broken or placeholder links ("example.com", "TODO", "lorem"), wrong dates/days, merge tags with no data for many subscribers.
- [x] **Compliance check**: CAN-SPAM / GDPR basics; optional strict mode for health / pharma claims (unsupported medical claims, missing disclaimers).
- [x] **Accessibility check**: missing alt text, low contrast, "click here" links. Alt text and vague link text (rule-based); contrast not checked since the editor has no colours.
- [x] **Subject line score** (0–100) with suggested improvements.
- [x] Results are advisory: show as warnings, never block sending (critical checks stay rule-based).

### 2.2 After sending: campaign reports (`History.jsx`, `CampaignMetrics.jsx`, `brevo.js`)
- [x] **Campaign summary in plain language**: what went well / badly, compared to the user's own past campaigns (data from `send_history` + Brevo metrics). History → pick a campaign → "AI campaign report" (Pro, `ai:report`).
- [x] **Why did it under-perform?** Link results to subject, send time, length, audience. Part of the report (`likely_causes`).
- [x] **Bounce / failure analysis**: group SMTP error messages in `send_history` into causes (bad address, mailbox full, blocked, rate-limited) with fixes. Rule-based and free: `electron/smtpErrors.js`, shown in History per campaign.
- [x] **Next-step suggestions**: resend to non-openers with a new subject, clean list, change send time. Part of the report (`next_steps`).
- [ ] **Dashboard insight card** (`Dashboard.jsx`): weekly "3 things to know" from all campaigns.
- [ ] **Ask your data**: chat box ("Which group opens most?", "Best day to send last month?"). AI turns the question into a call to safe, read-only query functions in `db.js`; never raw SQL from the model.

---

## 3. Other AI features that fit MailWave

### Subscribers (`Subscribers.jsx`, `db.js`)
- [x] **CSV import mapping**: AI guesses which column is email / first name / country / timezone when headers are messy. New "Match columns" step: rules (`utils/importMapping.js`) first, "Guess with AI" for the rest; sends headers and value *shapes* only.
- [x] **Data cleaning**: fix name casing, split full names, spot role addresses (info@, admin@), likely typo domains (gmial.com), duplicates. Role, typo, duplicate, throwaway, spam-trap and no-MX checks done rule-based at import (`electron/contactChecks.js`). Not done: name casing, splitting full names.
- [x] **Auto-segmentation**: suggest groups from custom fields + engagement (e.g. "engaged doctors in India"). Partly: any Smart filter can be saved as a group. No automatic suggestions yet.
- [ ] **Engagement scoring / churn risk** per subscriber (rule-based score first, AI explains it).
- [x] **Natural-language filter**: "subscribers from Germany who never opened" builds the filter. Smart filter on Subscribers (`ai:subscriberFilter` → structured filter → `db.filterSql`, bound parameters only). Opens/clicks aren't tracked per subscriber, so those parts are reported as unsupported.

### Personalisation and sending (`mailer.js`, `smartSchedule.js`)
- [ ] **Per-recipient personalised opening line** from custom fields (Pro, opt-in, batched, cost shown before running).
- [ ] **Dynamic content blocks**: different paragraph variants per group, chosen at send time.
- [ ] **AI send-time advice**: extend Smart Schedule with each subscriber's past open times (when Brevo data exists).
- [x] **Subject A/B test**: split a small sample, pick the winner automatically, send the rest. Needs new campaign fields (`variant`, `test_size`, `winner_rule`). "Test, then send the winner" mode: `ab_mode`, `ab_test_pct`, `ab_wait_hours`, `ab_metric`, `ab_winner`; winner from Brevo open/click rates, subject A kept without stats.

### Templates
- [ ] **Template from screenshot / URL**: rebuild an email layout as editable HTML (Claude vision).
- [ ] **Image alt text generator** for images in the editor.

### Automation API (`automation-server.js`)
- [x] Expose `POST /ai/draft` and `POST /ai/analyse` so n8n flows can create AI drafts (Pro, token-protected like other endpoints). `POST /ai/draft` (optionally `save: true`), `POST /ai/review`, `POST /ai/report`.

### Team Sync
- [x] Sync the brand voice profile and saved AI prompts through `teamStore.js` (but never the API key). Brand voice syncs (`brand` entity). There are no saved prompts to sync yet.

### Assistant
- [ ] **In-app help assistant**: answers "how do I…" questions about MailWave settings (SMTP setup, daily limits, Team Sync), using README / TEAM_SYNC.md as context.

---

## 4. Where the AI code lives

| File | What |
|---|---|
| `electron/ai.js` | Every AI feature, the `complete()` entry point, output checks, the mock provider |
| `electron/aiPrompts.js` | System prompts and structured-output schemas |
| `electron/aiProviders.js` | Provider detection from the key, OpenAI-compatible calls, model lists |
| `electron/smtpErrors.js` | Rule-based failure causes (History, free) |
| `electron/db.js` | `ai_log`, `filterSql` for the Smart filter, report queries, A/B fields |
| `electron/teamStore.js` | Brand voice sync (`brand` entity) |
| `electron/automation-server.js` | `POST /ai/draft`, `/ai/review`, `/ai/report` |
| `renderer/src/components/AIWriter.jsx`, `AISequence.jsx`, `AIReview.jsx`, `AISettings.jsx` | Writing panel, sequence writer, review, settings |
| `renderer/src/pages/History.jsx` | Failure causes and the AI campaign report |
| `renderer/src/pages/Subscribers.jsx`, `utils/importMapping.js` | Smart filter, column matching |
| `tests/ai.test.js` | Prompts, schemas, sanitising, privacy, Pro gating |

---

## 6. Testing

- [x] Mock provider in `ai.js` (returns fixed output) so features work in dev without a key.
- [x] Golden tests for prompts: merge tags kept, unsubscribe link kept, valid HTML. `tests/ai.test.js` (`npm test`): prompt rules, strict schemas, sanitising, tag/link checks.
- [ ] Test with Ollama offline and with no key (features hidden or show "Set up AI").
- [x] Check no subscriber data is sent when the privacy toggle is off (log outgoing payloads in dev). `tests/ai.test.js` asserts no addresses, names or field values reach the provider in the Smart filter and report prompts.
- [ ] Cost check: tokens per feature on a typical campaign, shown in Settings.

// Brevo API — account stats only (not used for sending)
async function getAccountStats(apiKey) {
  if (!apiKey) return { ok: false, error: 'No API key configured' };
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': apiKey, 'Accept': 'application/json' }
    });
    if (!res.ok) return { ok: false, error: `API error ${res.status}` };
    const data = await res.json();

    // Find email plan — subscription or payAsYouGo
    const plan = (data.plan || []).find(p =>
      p.type === 'subscription' || p.type === 'payAsYouGo' || p.type === 'free'
    );

    return {
      ok:               true,
      email:            data.email,
      company:          data.companyName,
      plan_type:        plan?.type || 'unknown',
      credits_total:    plan?.credits         || null,
      credits_remaining:plan?.creditsRemaining|| null,
      // Daily sending stats
      daily_limit:      data.plan?.[0]?.credits || null,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Today's send stats from Brevo
async function getTodayStats(apiKey) {
  if (!apiKey) return { ok: false, error: 'No API key' };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res   = await fetch(
      `https://api.brevo.com/v3/smtp/statistics/aggregatedReport?startDate=${today}&endDate=${today}`,
      { headers: { 'api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return { ok: false, error: `API error ${res.status}` };
    const data = await res.json();
    return {
      ok:        true,
      delivered: data.delivered  || 0,
      sent:      data.requests   || 0,
      bounced:   data.hardBounces + data.softBounces || 0,
      spam:      data.spamReports || 0,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Campaign-level metrics via Brevo tag. `tags` are tried in order and the
// first with any sends wins (see main.js brevo:campaignMetrics).
async function getCampaignMetrics(apiKey, tags) {
  if (!apiKey) return { ok: false, error: 'No API key' };
  if (!tags.length) return { ok: true, ...EMPTY_METRICS };
  let last;
  for (const tag of tags) {
    last = await getTagMetrics(apiKey, tag);
    if (!last.ok || last.requests > 0) return last;
  }
  return last;
}

const EMPTY_METRICS = { requests: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, spam: 0, unsubscribed: 0, open_rate: 0, click_rate: 0, bounce_rate: 0 };

async function getTagMetrics(apiKey, tag) {
  try {
    const res = await fetch(
      `https://api.brevo.com/v3/smtp/statistics/aggregatedReport?tags=${encodeURIComponent(tag)}`,
      { headers: { 'api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return { ok: false, error: `API error ${res.status}` };
    const d = await res.json();
    return {
      ok:          true,
      requests:    d.requests    || 0,
      delivered:   d.delivered   || 0,
      opens:       d.uniqueOpens || 0,
      clicks:      d.uniqueClicks|| 0,
      bounces:     (d.hardBounces || 0) + (d.softBounces || 0),
      spam:        d.spamReports || 0,
      unsubscribed:d.unsubscribed|| 0,
      open_rate:   d.requests ? Math.round((d.uniqueOpens  || 0) / d.requests * 100) : 0,
      click_rate:  d.requests ? Math.round((d.uniqueClicks || 0) / d.requests * 100) : 0,
      bounce_rate: d.requests ? Math.round(((d.hardBounces || 0) + (d.softBounces || 0)) / d.requests * 100) : 0,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Stats for one campaign (or one A/B variant: 'a' | 'b'). Sends are tagged
// campaign-<uid>[-a|-b]; campaigns sent before uids existed were tagged with
// the local id, which only means something on the machine that sent them.
async function getCampaignMetricsFor(apiKey, camp, variant = '', sentHere = false) {
  const suffix = variant ? `-${variant}` : '';
  const tags = [];
  if (camp.uid) tags.push(`campaign-${camp.uid}${suffix}`);
  if (sentHere) tags.push(`campaign-${camp.id}${suffix}`);
  return getCampaignMetrics(apiKey, tags);
}

module.exports = { getAccountStats, getTodayStats, getCampaignMetrics, getCampaignMetricsFor };

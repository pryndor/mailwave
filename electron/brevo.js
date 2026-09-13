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

// Campaign-level metrics via Brevo tag
async function getCampaignMetrics(apiKey, campaignId) {
  if (!apiKey) return { ok: false, error: 'No API key' };
  try {
    const tag = `campaign-${campaignId}`;
    // Aggregated stats for this campaign tag
    const res = await fetch(
      `https://api.brevo.com/v3/smtp/statistics/aggregatedReport?tags=${tag}`,
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

module.exports = { getAccountStats, getTodayStats, getCampaignMetrics };

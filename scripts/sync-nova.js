#!/usr/bin/env node
'use strict';

/**
 * Pulls fresh Meta Marketing API data for the Mayfair Lounge & Nightclub
 * campaigns and regenerates the embedded data + header text inside
 * nova/index.html in place. Run daily by .github/workflows/nova-sync.yml.
 *
 * Requires a META_ACCESS_TOKEN environment variable: a Meta access token
 * with ads_read permission on the ad account below. Use a long-lived
 * System User token (Business Settings > System Users) so this doesn't
 * silently stop working when a personal token expires.
 */

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Missing META_ACCESS_TOKEN environment variable.');
  process.exit(1);
}

const API_VERSION = 'v21.0';
const AD_ACCOUNT = 'act_979054470216542';

// The 5 campaigns that make up the Mayfair Lounge & Nightclub dashboard.
// Hardcoded on purpose: this ad account also runs campaigns for other
// clients, and this report should never pick those up.
const CAMPAIGN_IDS = [
  '120249405635630447', // Big Gigantic
  '120249542614910447', // Dillon Francis C&C - SATX
  '120249542930620447', // Dillon Francis C&C - Houston
  '120249666783480447', // LP Giobbi - Dallas
  '120249668584730447', // LP Giobbi - El Paso
];

const FILTERING = encodeURIComponent(JSON.stringify([
  { field: 'campaign.id', operator: 'IN', value: CAMPAIGN_IDS },
]));

const ymd = d => d.toISOString().slice(0, 10);

async function metaGet(qs) {
  const sep = qs.includes('?') ? '&' : '?';
  const url = `https://graph.facebook.com/${API_VERSION}/${qs}${sep}access_token=${TOKEN}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`Meta API error (${qs.split('?')[0]}): ${json.error.message}`);
  }
  return json;
}

function getAction(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find(a => a.action_type === type);
  return hit ? Number(hit.value) : 0;
}

async function aggregateInsights(since, until) {
  const fields = 'spend,impressions,reach,clicks,cpc,ctr,cpm,actions';
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const json = await metaGet(`${AD_ACCOUNT}/insights?fields=${fields}&time_range=${timeRange}&filtering=${FILTERING}&limit=1`);
  const row = (json.data && json.data[0]) || {};
  return {
    spend: Number(row.spend || 0),
    impressions: Number(row.impressions || 0),
    reach: Number(row.reach || 0),
    clicks: Number(row.clicks || 0),
    cpc: Number(row.cpc || 0),
    ctr: Number(row.ctr || 0),
    cpm: Number(row.cpm || 0),
    landingPageViews: getAction(row.actions, 'landing_page_view'),
    purchases: getAction(row.actions, 'omni_purchase'),
  };
}

async function dailyInsights(since, until) {
  const fields = 'spend,clicks,impressions,actions';
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const json = await metaGet(`${AD_ACCOUNT}/insights?fields=${fields}&time_range=${timeRange}&time_increment=1&filtering=${FILTERING}&limit=100`);
  return (json.data || [])
    .map(row => ({
      date: row.date_start,
      spend: Number(row.spend || 0),
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      landingPageViews: getAction(row.actions, 'landing_page_view'),
      purchases: getAction(row.actions, 'omni_purchase'),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function campaignBreakdown(since, until) {
  const fields = 'campaign_id,campaign_name,spend,clicks,impressions,actions';
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const json = await metaGet(`${AD_ACCOUNT}/insights?level=campaign&fields=${fields}&time_range=${timeRange}&filtering=${FILTERING}&limit=50`);
  return (json.data || []).map(row => {
    const spend = Number(row.spend || 0);
    const clicks = Number(row.clicks || 0);
    const impressions = Number(row.impressions || 0);
    return {
      id: row.campaign_id,
      name: row.campaign_name,
      spend,
      cpc: clicks ? spend / clicks : 0,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      landingPageViews: getAction(row.actions, 'landing_page_view'),
    };
  });
}

async function campaignOnOffMap() {
  const json = await metaGet(`${AD_ACCOUNT}/adsets?fields=campaign_id,effective_status&filtering=${FILTERING}&limit=250`);
  const on = new Map();
  for (const row of (json.data || [])) {
    const isOn = row.effective_status === 'ACTIVE';
    on.set(row.campaign_id, Boolean(on.get(row.campaign_id)) || isOn);
  }
  return on;
}

function dateLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function jsNum(n, digits = 6) {
  return Number(n.toFixed(digits));
}

function buildDataBlock({ daily, total, wowPrev, wowCurr, campaigns, onMap, since, until }) {
  const dailyLines = daily
    .map(d => `    ['${dateLabel(d.date)}', ${d.spend.toFixed(2)}, ${d.clicks}, ${d.impressions}, ${d.landingPageViews}, ${d.purchases}],`)
    .join('\n');

  const campaignLines = campaigns
    .slice()
    .sort((a, b) => b.spend - a.spend)
    .map(c => {
      const isOn = onMap.get(c.id) ? 'on' : 'off';
      const name = String(c.name).replace(/'/g, "\\'");
      return `    { name: '${name}', status: '${isOn}', spend: ${c.spend.toFixed(2)}, cpc: ${jsNum(c.cpc)}, ctr: ${jsNum(c.ctr)}, landingPageViews: ${c.landingPageViews} },`;
    })
    .join('\n');

  return `  // ---- Real Meta Marketing API data, ${AD_ACCOUNT} (Mayfair), ${ymd(since)} .. ${ymd(until)} ----
  // Auto-generated daily by scripts/sync-nova.js — do not hand-edit this block.
  // Each row: [dateLabel, spend, clicks, impressions, landingPageViews, purchases]
  const DAILY = [
${dailyLines}
  ];

  const TOTAL = {
    spend: ${jsNum(total.spend, 2)}, impressions: ${total.impressions}, reach: ${total.reach}, clicks: ${total.clicks},
    landingPageViews: ${total.landingPageViews}, cpc: ${jsNum(total.cpc)}, cpm: ${jsNum(total.cpm)}, ctr: ${jsNum(total.ctr)},
    purchases: ${total.purchases}
  };

  // Week-over-week: most recent 7 days of the window vs the 7 before that
  const WOW = {
    spend: { prev: ${jsNum(wowPrev.spend, 2)}, curr: ${jsNum(wowCurr.spend, 2)} },
    impressions: { prev: ${wowPrev.impressions}, curr: ${wowCurr.impressions} },
    clicks: { prev: ${wowPrev.clicks}, curr: ${wowCurr.clicks} },
    reach: { prev: ${wowPrev.reach}, curr: ${wowCurr.reach} },
    cpm: { prev: ${jsNum(wowPrev.cpm)}, curr: ${jsNum(wowCurr.cpm)} },
    ctr: { prev: ${jsNum(wowPrev.ctr)}, curr: ${jsNum(wowCurr.ctr)} },
    landingPageViews: { prev: ${wowPrev.landingPageViews}, curr: ${wowCurr.landingPageViews} },
    purchases: { prev: ${wowPrev.purchases}, curr: ${wowCurr.purchases} },
  };
  const pctChange = (prev, curr) => prev === 0 ? null : ((curr - prev) / prev) * 100;

  const CAMPAIGNS = [
${campaignLines}
  ];`;
}

async function main() {
  const now = new Date();
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)); // yesterday — today is still partial
  const WINDOW_DAYS = 14;
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (WINDOW_DAYS - 1));

  const currWowSince = new Date(until);
  currWowSince.setUTCDate(currWowSince.getUTCDate() - 6);
  const prevWowUntil = new Date(currWowSince);
  prevWowUntil.setUTCDate(prevWowUntil.getUTCDate() - 1);
  const prevWowSince = new Date(prevWowUntil);
  prevWowSince.setUTCDate(prevWowSince.getUTCDate() - 6);

  console.log(`Nova sync: window ${ymd(since)}..${ymd(until)}`);

  const [total, daily, campaigns, onMap, wowCurr, wowPrev] = await Promise.all([
    aggregateInsights(ymd(since), ymd(until)),
    dailyInsights(ymd(since), ymd(until)),
    campaignBreakdown(ymd(since), ymd(until)),
    campaignOnOffMap(),
    aggregateInsights(ymd(currWowSince), ymd(until)),
    aggregateInsights(ymd(prevWowSince), ymd(prevWowUntil)),
  ]);

  const dataBlock = buildDataBlock({ daily, total, wowPrev, wowCurr, campaigns, onMap, since, until });

  const filePath = path.join(__dirname, '..', 'nova', 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');

  html = html.replace(
    /  \/\/ ---- Real Meta Marketing API data[\s\S]*?\n  const CAMPAIGNS = \[[\s\S]*?\n  \];/,
    dataBlock
  );

  const rangeLabel = `${dateLabel(ymd(since))} – ${dateLabel(ymd(until))}, ${until.getUTCFullYear()}`;
  html = html.replace(
    /<span class="num" id="rangeText">[^<]*<\/span>/,
    `<span class="num" id="rangeText">${rangeLabel}</span>`
  );

  const updatedLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
  html = html.replace(
    /<span class="num" id="updatedText">[^<]*<\/span>/,
    `<span class="num" id="updatedText">${updatedLabel}</span>`
  );

  html = html.replace(
    /\(\d+ days live\)|\(\d+ days, rolling\)/,
    `(${WINDOW_DAYS} days, rolling)`
  );

  fs.writeFileSync(filePath, html);
  console.log('nova/index.html updated.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

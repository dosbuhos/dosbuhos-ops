/**
 * Dos Búhos Growth Terminal — Google Ads Script (feed + approved changes).
 *
 * Paste into Google Ads → Tools → Bulk actions → Scripts → New script, authorize, and schedule "Hourly".
 * Each run:
 *   1. Asks the Growth Terminal for changes the owner APPROVED there (budget, pause campaign/ad, exact negative).
 *      Each one is applied only if the account still shows the value the approval was based on; otherwise it is
 *      skipped and reported. Nothing else is ever changed. In "Preview" runs nothing is applied or reported.
 *   2. READS the account (reports, campaigns, ads, negatives, change history) and POSTs it, so the Growth Terminal
 *      can verify each change against the real account.
 *
 * Set the two constants below. FEED_TOKEN comes from Growth Terminal → Connections → Google Ads Script → "Create feed
 * token" (shown once). Do not commit the token anywhere; it lives only in this script inside Google Ads.
 */
var ENDPOINT = 'https://growth.dos-buhos.workers.dev/api/feed/google-ads'; // direct (not through the Hub's sign-in)
var APPLY_CHANGES = true; // set to false to keep this script read-only
var FEED_TOKEN = 'PASTE_TOKEN_HERE';
var DAYS = 90;          // backfill window; overlap re-fetch captures Google's late conversion revisions
var TERMS_DAYS = 28;

function main() {
  if (APPLY_CHANGES && !AdsApp.getExecutionInfo().isPreview()) applyApprovedChanges();
  var tz = AdsApp.currentAccount().getTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var from = Utilities.formatDate(new Date(Date.now() - DAYS * 864e5), tz, 'yyyy-MM-dd');
  var termsFrom = Utilities.formatDate(new Date(Date.now() - TERMS_DAYS * 864e5), tz, 'yyyy-MM-dd');
  var monthStart = today.slice(0, 8) + '01';

  var campaigns = [];
  var rows = AdsApp.search(
    'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, ' +
    'campaign_budget.id, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.status != "REMOVED"');
  while (rows.hasNext()) {
    var r = rows.next();
    campaigns.push({
      id: String(r.campaign.id), name: r.campaign.name, status: r.campaign.status, channel: r.campaign.advertisingChannelType,
      budgetId: r.campaignBudget ? String(r.campaignBudget.id) : null,
      budgetMicros: r.campaignBudget ? Number(r.campaignBudget.amountMicros) : null,
      budgetShared: !!(r.campaignBudget && r.campaignBudget.explicitlyShared),
      biddingStrategy: r.campaign.biddingStrategyType || ''
    });
  }

  var daily = [];
  rows = AdsApp.search('SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value ' +
    'FROM campaign WHERE segments.date BETWEEN "' + from + '" AND "' + today + '"');
  while (rows.hasNext()) {
    var d = rows.next();
    daily.push({ date: d.segments.date, campaignId: String(d.campaign.id), costMicros: Number(d.metrics.costMicros), impressions: Number(d.metrics.impressions),
      clicks: Number(d.metrics.clicks), conversions: Number(d.metrics.conversions), conversionValue: Number(d.metrics.conversionsValue) });
  }

  var mtd = 0, todayCost = 0, maxHourly = 0;
  rows = AdsApp.search('SELECT metrics.cost_micros FROM customer WHERE segments.date BETWEEN "' + monthStart + '" AND "' + today + '"');
  while (rows.hasNext()) mtd += Number(rows.next().metrics.costMicros);
  rows = AdsApp.search('SELECT segments.hour, metrics.cost_micros FROM customer WHERE segments.date DURING TODAY');
  while (rows.hasNext()) { var h = rows.next(); var c = Number(h.metrics.costMicros); todayCost += c; if (c > maxHourly) maxHourly = c; }
  // Also look at the last 7 days' busiest hour so a quiet morning does not understate exposure.
  rows = AdsApp.search('SELECT segments.date, segments.hour, metrics.cost_micros FROM customer WHERE segments.date DURING LAST_7_DAYS');
  while (rows.hasNext()) { var hh = Number(rows.next().metrics.costMicros); if (hh > maxHourly) maxHourly = hh; }

  var terms = [];
  rows = AdsApp.search('SELECT campaign.id, search_term_view.search_term, segments.search_term_match_type, metrics.cost_micros, metrics.clicks, metrics.conversions ' +
    'FROM search_term_view WHERE segments.date BETWEEN "' + termsFrom + '" AND "' + today + '" AND metrics.clicks > 0');
  while (rows.hasNext() && terms.length < 5000) {
    var t = rows.next();
    terms.push({ campaignId: String(t.campaign.id), from: termsFrom, to: today, term: t.searchTermView.searchTerm, matchType: t.segments.searchTermMatchType || '',
      keyword: '', costMicros: Number(t.metrics.costMicros), clicks: Number(t.metrics.clicks), conversions: Number(t.metrics.conversions) });
  }

  var changes = [];
  var since = Utilities.formatDate(new Date(Date.now() - 14 * 864e5), tz, 'yyyy-MM-dd HH:mm:ss');
  rows = AdsApp.search('SELECT change_event.change_date_time, change_event.change_resource_type, change_event.client_type, change_event.campaign, ' +
    'change_event.old_resource, change_event.new_resource, change_event.change_resource_name FROM change_event ' +
    'WHERE change_event.change_date_time >= "' + since + '" AND change_event.change_date_time <= "' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss') + '" AND change_event.change_resource_type = "CAMPAIGN_BUDGET" ORDER BY change_event.change_date_time DESC LIMIT 1000');
  while (rows.hasNext()) {
    var e = rows.next().changeEvent;
    var oldB = e.oldResource && e.oldResource.campaignBudget, newB = e.newResource && e.newResource.campaignBudget;
    var name = e.changeResourceName || '';
    changes.push({ at: toIso(e.changeDateTime, tz), resourceType: e.changeResourceType, campaignId: e.campaign ? String(e.campaign).split('/').pop() : null,
      budgetId: name ? name.split('/').pop() : null,
      oldBudgetMicros: oldB && oldB.amountMicros ? Number(oldB.amountMicros) : null, newBudgetMicros: newB && newB.amountMicros ? Number(newB.amountMicros) : null,
      clientType: e.clientType || '' });
  }

  // Live ads and exact campaign negatives of enabled campaigns: what the Growth Terminal checks changes against.
  var ads = [];
  rows = AdsApp.search('SELECT ad_group_ad.ad.id, campaign.id, ad_group_ad.status FROM ad_group_ad WHERE campaign.status = "ENABLED" AND ad_group_ad.status != "REMOVED"');
  while (rows.hasNext() && ads.length < 20000) { var a = rows.next(); ads.push({ id: String(a.adGroupAd.ad.id), campaignId: String(a.campaign.id), status: a.adGroupAd.status }); }
  var negatives = [];
  rows = AdsApp.search('SELECT campaign.id, campaign_criterion.keyword.text FROM campaign_criterion WHERE campaign.status = "ENABLED" AND campaign_criterion.negative = TRUE AND campaign_criterion.type = "KEYWORD" AND campaign_criterion.keyword.match_type = "EXACT"');
  while (rows.hasNext() && negatives.length < 20000) { var n = rows.next(); negatives.push({ campaignId: String(n.campaign.id), text: n.campaignCriterion.keyword.text }); }

  var acct = AdsApp.currentAccount();
  var payload = {
    schemaVersion: '1', generatedAt: new Date().toISOString(),
    account: { customerId: acct.getCustomerId().replace(/-/g, ''), currency: acct.getCurrencyCode(), timeZone: tz, name: acct.getName() },
    campaigns: campaigns, daily: daily,
    today: { date: today, costMicros: todayCost, maxHourlyMicros: maxHourly, dataAsOf: new Date().toISOString() },
    monthToDateMicros: mtd, searchTerms: terms, changes: changes, ads: ads, negatives: negatives
  };
  var res = UrlFetchApp.fetch(ENDPOINT, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
    headers: { Authorization: 'Bearer ' + FEED_TOKEN }, muteHttpExceptions: true });
  Logger.log('Growth Terminal answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
}

function toIso(local, tz) {
  // change_date_time is "yyyy-MM-dd HH:mm:ss.SSSSSS" in the account zone.
  var d = Utilities.parseDate(local.slice(0, 19), 'yyyy-MM-dd HH:mm:ss', tz);
  return d.toISOString();
}

// ---------- approved changes ----------
function customerId() { return AdsApp.currentAccount().getCustomerId().replace(/-/g, ''); }
function call(method, path, body) {
  var opts = { method: method, headers: { Authorization: 'Bearer ' + FEED_TOKEN }, muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(ENDPOINT + path, opts);
  if (res.getResponseCode() !== 200) throw new Error('Growth Terminal ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function applyApprovedChanges() {
  var ops;
  try { ops = call('get', '/ops?customerId=' + customerId()).ops; } catch (e) { Logger.log('No se pudieron leer los cambios aprobados: ' + e); return; }
  if (!ops.length) return;
  var results = [];
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i], r;
    try { r = applyOne(o); } catch (e) { r = { status: 'failed', detail: String(e).slice(0, 400) }; }
    r.id = o.id; results.push(r);
    Logger.log(o.kind + ' ' + o.id + ': ' + r.status + ' ' + r.detail);
  }
  try { call('post', '/ops', { customerId: customerId(), results: results }); } catch (e) { Logger.log('No se pudo reportar el resultado: ' + e); }
}

function applyOne(o) {
  if (o.kind === 'set_budget') {
    var it = AdsApp.budgets().withIds([Number(o.budget_id)]).get();
    if (!it.hasNext()) return { status: 'failed', detail: 'No existe el presupuesto ' + o.budget_id };
    var b = it.next(), now = Math.round(b.getAmount() * 1e6);
    if (now !== Number(o.from_micros)) return { status: 'skipped', detail: 'El presupuesto ya no es el que se aprobó (' + now + ' en vez de ' + o.from_micros + ')' };
    b.setAmount(Number(o.to_micros) / 1e6);
    return { status: 'applied', detail: 'Presupuesto ' + (Number(o.from_micros) / 1e6) + ' → ' + (Number(o.to_micros) / 1e6) };
  }
  if (o.kind === 'pause_campaign') {
    var c = AdsApp.campaigns().withIds([Number(o.campaign_id)]).get();
    if (!c.hasNext()) return { status: 'failed', detail: 'No existe la campaña ' + o.campaign_id + ' (solo campañas de búsqueda/display)' };
    var camp = c.next();
    if (!camp.isEnabled()) return { status: 'skipped', detail: 'La campaña ya no estaba activa' };
    camp.pause(); return { status: 'applied', detail: 'Campaña pausada' };
  }
  if (o.kind === 'pause_ad') {
    var a = AdsApp.ads().withCondition('ad_group_ad.ad.id = ' + Number(o.ad_id)).get();
    if (!a.hasNext()) return { status: 'failed', detail: 'No existe el anuncio ' + o.ad_id };
    var ad = a.next();
    if (!ad.isEnabled()) return { status: 'skipped', detail: 'El anuncio ya no estaba activo' };
    ad.pause(); return { status: 'applied', detail: 'Anuncio pausado' };
  }
  if (o.kind === 'add_negative_exact') {
    var cc = AdsApp.campaigns().withIds([Number(o.campaign_id)]).get();
    if (!cc.hasNext()) return { status: 'failed', detail: 'No existe la campaña ' + o.campaign_id };
    var text = String(o.text).replace(/[\[\]"]/g, '').trim();
    if (!text) return { status: 'failed', detail: 'Texto vacío' };
    cc.next().createNegativeKeyword('[' + text + ']');
    return { status: 'applied', detail: 'Negativa exacta [' + text + '] agregada' };
  }
  return { status: 'failed', detail: 'Tipo de cambio desconocido: ' + o.kind };
}

// Dos Búhos — Google Ads → Hub "Anuncios" (/ads/). Paste into Google Ads → Tools → Bulk actions → Scripts
// (script "Dashboard feed"), set TOKEN, authorize once, schedule Hourly. Each run sends the last 90 days by campaign and
// day, plus each campaign's status, budget and search impression share lost to budget (last 7 days).
// The token is made in the Hub (POST /ads/api/token, Hub admins) and is not kept in this public repo.
var HUB = 'https://hub.dos-buhos.workers.dev/ads/api/ingest';
var TOKEN = 'PASTE_TOKEN_HERE';
var DAYS = 90;

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var fmt = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var end = new Date(); // today included: runs hourly, so today's numbers fill in through the day
  var start = new Date(end.getTime() - (DAYS - 1) * 24 * 3600 * 1000);

  var daily = [];
  var it = AdsApp.search(
    'SELECT segments.date, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, ' +
    'metrics.conversions, metrics.conversions_value FROM campaign ' +
    "WHERE segments.date BETWEEN '" + fmt(start) + "' AND '" + fmt(end) + "' AND metrics.impressions > 0");
  while (it.hasNext()) {
    var r = it.next();
    daily.push({
      date: r.segments.date, campaign: r.campaign.name,
      spend: Number(r.metrics.costMicros || 0) / 1e6,
      impressions: Number(r.metrics.impressions || 0), clicks: Number(r.metrics.clicks || 0),
      conversions: Number(r.metrics.conversions || 0), conversion_value: Number(r.metrics.conversionsValue || 0)
    });
  }

  var camps = {};
  var it2 = AdsApp.search(
    'SELECT campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros ' +
    "FROM campaign WHERE campaign.status != 'REMOVED'");
  while (it2.hasNext()) {
    var c = it2.next();
    camps[c.campaign.name] = { campaign: c.campaign.name, status: c.campaign.status, type: c.campaign.advertisingChannelType,
      daily_budget: Number(c.campaignBudget.amountMicros || 0) / 1e6, lost_is_budget: null };
  }
  var it3 = AdsApp.search(
    'SELECT campaign.name, metrics.search_budget_lost_impression_share FROM campaign ' +
    "WHERE segments.date DURING LAST_7_DAYS AND campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH'");
  while (it3.hasNext()) {
    var s = it3.next(), lis = s.metrics.searchBudgetLostImpressionShare;
    if (camps[s.campaign.name] && lis != null) camps[s.campaign.name].lost_is_budget = Math.round(Number(lis) * 1000) / 10;
  }

  var list = Object.keys(camps).map(function (k) { return camps[k]; });
  var res = UrlFetchApp.fetch(HUB, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + TOKEN },
    payload: JSON.stringify({ google_daily: daily, google_campaigns: list })
  });
  Logger.log('Hub said ' + res.getResponseCode() + ': ' + res.getContentText() + ' (' + daily.length + ' rows, ' + list.length + ' campaigns)');
  if (res.getResponseCode() !== 200) throw new Error('Hub rejected the feed: ' + res.getContentText());
}

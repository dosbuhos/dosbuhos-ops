-- Google Ads search terms as GA4 sees them (sessionGoogleAdsQuery): which searches brought ad visits, how many opened
-- OpenTable and booked, and (when GA4 has the Google Ads link) clicks and cost. Used to separate brand from new searches.
CREATE TABLE ga4_ads_queries (
  date TEXT NOT NULL,
  campaign TEXT NOT NULL,
  query TEXT NOT NULL,
  sessions INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,        -- ot-availability-pageview events
  reservations INTEGER NOT NULL DEFAULT 0,  -- ot-reservation-made events
  ad_clicks INTEGER,                        -- NULL when GA4 cannot report cost by search term
  ad_cost_micros INTEGER,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (date, campaign, query)
);

-- SimAds (ads.mode = "sim"): simulated ad network events. Applied on every site (cheap, empty unless sim is on).
-- One row per event; ev in pv | req | imp | view | click | close | start | q1 | mid | q3 | complete | skip | error.
-- aid = auction id (NULL for pv): (aid, ev) is unique, so a replayed beacon or a double fire never counts twice.
-- price_micros = net publisher price of this impression in millionths of a USD (eCPM x 1000), on imp rows only.
-- visit = salted hash of the 30-minute visit cookie (simads_v); no IP, no clear identifier.
CREATE TABLE IF NOT EXISTS simads_events (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  ev           text NOT NULL,
  aid          text,
  zone         text NOT NULL DEFAULT '',
  format       text NOT NULL DEFAULT '',
  size         text NOT NULL DEFAULT '',
  audience     text NOT NULL DEFAULT 'general',
  geo          text NOT NULL DEFAULT '',
  tier         text NOT NULL DEFAULT '',
  device       text NOT NULL DEFAULT '',
  partner      text NOT NULL DEFAULT '',
  creative     text NOT NULL DEFAULT '',
  filled       boolean,
  price_micros integer NOT NULL DEFAULT 0,
  visit        text
);
CREATE UNIQUE INDEX IF NOT EXISTS simads_events_aid_ev_idx ON simads_events (aid, ev) WHERE aid IS NOT NULL;
CREATE INDEX IF NOT EXISTS simads_events_at_idx ON simads_events (at);

-- Template additions:
--  * categories.hidden: categories renamed/ordered/hidden from site.config.json, or gone from the catalog
--  * videos.media_path: "<id>" or "<id>/<v>" (versioned media path, so a re-encode never reuses cached URLs)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_path text;
UPDATE videos SET media_path = id WHERE media_path IS NULL;
ALTER TABLE videos ALTER COLUMN media_path SET NOT NULL;

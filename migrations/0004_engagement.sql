-- Milestone 2 — engagement columns for favorites (likes), view counts, and a
-- manual "featured" flag. Powers the Featured / Most-viewed / Budget / Most-liked
-- sort options and the ❤️ save button on residential cards.
ALTER TABLE properties ADD COLUMN views    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN likes    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_props_featured ON properties(featured);
CREATE INDEX IF NOT EXISTS idx_props_views    ON properties(views);
CREATE INDEX IF NOT EXISTS idx_props_likes    ON properties(likes);

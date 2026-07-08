-- Milestone 2 — group the 88 flat neighbourhood tags (mostly landmarks/building
-- names) under ~16 real Jaipur "major areas" so the filter shows main areas only.
-- major_slug/major_area are nullable; the sub-tag name stays as-is for detail pages.
ALTER TABLE neighbourhoods ADD COLUMN major_slug TEXT;
ALTER TABLE neighbourhoods ADD COLUMN major_area TEXT;
CREATE INDEX IF NOT EXISTS idx_nbhd_major ON neighbourhoods(major_slug);

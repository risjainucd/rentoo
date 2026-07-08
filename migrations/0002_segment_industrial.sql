-- Milestone 2 — split Industrial out of Commercial.
-- Widens the segment CHECK to allow 'industrial', then re-tags warehouse/factory
-- listings. SQLite can't alter a CHECK constraint in place, so we rebuild the
-- table (12-step pattern). defer_foreign_keys guards the rebuild inside D1's
-- migration transaction.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE properties_new (
  id                 TEXT PRIMARY KEY,
  display_id         TEXT NOT NULL UNIQUE,
  segment            TEXT NOT NULL CHECK (segment IN ('residential','commercial','industrial')),
  bhk_type           TEXT,
  property_type      TEXT NOT NULL,
  rent_inr           INTEGER NOT NULL,
  area_sqft          INTEGER,
  furnishing         TEXT CHECK (furnishing IN ('furnished','semi-furnished','unfurnished')),
  status             TEXT NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available','rented','on-hold')),
  landmark           TEXT,
  neighbourhood_slug TEXT NOT NULL,
  map_url            TEXT,
  description        TEXT,
  slug               TEXT NOT NULL UNIQUE,
  published          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (neighbourhood_slug) REFERENCES neighbourhoods(slug)
);

INSERT INTO properties_new
  SELECT id, display_id, segment, bhk_type, property_type, rent_inr, area_sqft,
         furnishing, status, landmark, neighbourhood_slug, map_url, description,
         slug, published, created_at
  FROM properties;

DROP TABLE properties;
ALTER TABLE properties_new RENAME TO properties;

CREATE INDEX idx_props_nbhd      ON properties(neighbourhood_slug);
CREATE INDEX idx_props_segment   ON properties(segment);
CREATE INDEX idx_props_published ON properties(published);
CREATE INDEX idx_props_status    ON properties(status);

-- Re-tag: warehouses and factories are industrial, not commercial.
UPDATE properties SET segment = 'industrial' WHERE property_type IN ('warehouse','factory');

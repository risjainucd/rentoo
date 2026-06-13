-- Rentoo milestone 1 — public-read schema (D1 / SQLite)

CREATE TABLE neighbourhoods (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  display_order     INTEGER NOT NULL DEFAULT 0,
  cover_r2_key      TEXT,
  short_description TEXT
);

CREATE TABLE properties (
  id                 TEXT PRIMARY KEY,                 -- uuid (generated at import)
  display_id         TEXT NOT NULL UNIQUE,             -- "#01"
  segment            TEXT NOT NULL CHECK (segment IN ('residential','commercial')),
  bhk_type           TEXT,                             -- "2BHK" (residential only)
  property_type      TEXT NOT NULL,                    -- apartment | office | shop | ...
  rent_inr           INTEGER NOT NULL,
  area_sqft          INTEGER,
  furnishing         TEXT CHECK (furnishing IN ('furnished','semi-furnished','unfurnished')),
  status             TEXT NOT NULL DEFAULT 'available'
                       CHECK (status IN ('available','rented','on-hold')),
  landmark           TEXT,
  neighbourhood_slug TEXT NOT NULL,
  map_url            TEXT,
  description        TEXT,
  slug               TEXT NOT NULL UNIQUE,             -- url slug
  published          INTEGER NOT NULL DEFAULT 0,       -- 0/1
  created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (neighbourhood_slug) REFERENCES neighbourhoods(slug)
);
CREATE INDEX idx_props_nbhd      ON properties(neighbourhood_slug);
CREATE INDEX idx_props_segment   ON properties(segment);
CREATE INDEX idx_props_published ON properties(published);
CREATE INDEX idx_props_status    ON properties(status);

CREATE TABLE property_media (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','video')),
  r2_key        TEXT NOT NULL,             -- BASE key "properties/<slug>/<n>"; size suffix appended at read time
  display_order INTEGER NOT NULL DEFAULT 0,
  is_cover      INTEGER NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  watermarked   INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE INDEX idx_media_property ON property_media(property_id);
CREATE INDEX idx_media_cover    ON property_media(property_id, is_cover);

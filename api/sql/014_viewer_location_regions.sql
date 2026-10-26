CREATE TABLE IF NOT EXISTS viewer_location_regions (
  latitude NUMERIC(5,2) NOT NULL,
  longitude NUMERIC(6,2) NOT NULL,
  region_name TEXT,
  country_name TEXT,
  looked_up_at TIMESTAMPTZ,
  PRIMARY KEY (latitude, longitude)
);

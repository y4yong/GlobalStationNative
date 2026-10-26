import { pool } from './db.js';

type RegionCacheRow = { region_name: string | null; country_name: string | null };

// Nominatim requires no more than one request per second. Keep lookups serialized
// and cache each rounded coordinate cell so playback heartbeats never geocode repeatedly.
let lookupQueue = Promise.resolve();
let lastLookupStartedAt = 0;
const lookupInFlight = new Set<string>();

export function lookupViewerRegion(latitude: number, longitude: number) {
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (lookupInFlight.has(key)) return lookupQueue;
  lookupInFlight.add(key);
  lookupQueue = lookupQueue.then(async () => {
    try {
      const claim = await pool.query<RegionCacheRow>(`
        INSERT INTO viewer_location_regions (latitude, longitude, looked_up_at)
        VALUES ($1, $2, now())
        ON CONFLICT (latitude, longitude) DO UPDATE SET looked_up_at = now()
          WHERE viewer_location_regions.looked_up_at IS NULL
             OR viewer_location_regions.looked_up_at < now() - interval '7 days'
        RETURNING region_name, country_name
      `, [lat, lon]);
      if (!claim.rowCount) return;

      const waitMs = Math.max(0, 1100 - (Date.now() - lastLookupStartedAt));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastLookupStartedAt = Date.now();
      const endpoint = new URL(process.env.VIEWER_GEOCODER_URL ?? 'https://nominatim.openstreetmap.org/reverse');
      endpoint.search = new URLSearchParams({
        format: 'jsonv2', addressdetails: '1', zoom: '10', lat: String(lat), lon: String(lon),
      }).toString();
      const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'GlobalStationNative/1.0 (viewer region analytics)', 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
      const result = await response.json() as { address?: Record<string, string> };
      const address = result.address ?? {};
      const region = address.state || address.region || address.province || address.state_district || null;
      const country = address.country || null;
      await pool.query(`UPDATE viewer_location_regions SET region_name = $3, country_name = $4
        WHERE latitude = $1 AND longitude = $2`, [lat, lon, region, country]);
    } catch (error) {
      console.warn('Viewer area lookup failed:', error instanceof Error ? error.message : 'unknown error');
    } finally {
      lookupInFlight.delete(key);
    }
  }).catch(error => {
    lookupInFlight.delete(key);
    console.warn('Viewer area lookup queue failed:', error instanceof Error ? error.message : 'unknown error');
  });
  return lookupQueue;
}

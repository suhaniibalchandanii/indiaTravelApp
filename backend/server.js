import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { solveDijkstra, getMultipleRoutes } from './routing.js';
import { db } from './database.js';

const app = express();
const PORT = process.env.PORT || 5001;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

app.use(cors());
app.use(express.json());

// Logger middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    googleApi: GOOGLE_KEY && GOOGLE_KEY !== 'YOUR_API_KEY_HERE' ? 'configured' : 'not_set'
  });
});

// ─── Stops list (local DB, for fallback autocomplete) ─────────────────────────
app.get('/api/stops', (req, res) => {
  try {
    const stops = db.prepare('SELECT * FROM stops ORDER BY name ASC').all();
    res.json({ success: true, stops });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Google Places Autocomplete Proxy ─────────────────────────────────────────
// GET /api/places?input=text
app.get('/api/places', async (req, res) => {
  const { input } = req.query;
  if (!input || input.trim().length < 2) return res.json({ predictions: [] });

  // No key → fall back to local DB
  if (!GOOGLE_KEY || GOOGLE_KEY === 'YOUR_API_KEY_HERE') {
    const rows = db.prepare(
      'SELECT * FROM stops WHERE name LIKE ? OR city LIKE ? LIMIT 8'
    ).all(`%${input}%`, `%${input}%`);
    return res.json({
      predictions: rows.map(s => ({
        place_id: s.id,
        description: `${s.name}, ${s.city}`,
        structured_formatting: { main_text: s.name, secondary_text: s.city },
        source: 'local'
      }))
    });
  }

  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
      `?input=${encodeURIComponent(input)}` +
      `&components=country:in` +
      `&types=geocode|establishment` +
      `&key=${GOOGLE_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error('Google Places error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Google Geocoding Proxy ───────────────────────────────────────────────────
// GET /api/geocode?address=text  OR  /api/geocode?place_id=XXX
app.get('/api/geocode', async (req, res) => {
  const { address, place_id } = req.query;
  if (!address && !place_id) {
    return res.status(400).json({ success: false, error: 'address or place_id required.' });
  }

  // No key → fall back to local DB
  if (!GOOGLE_KEY || GOOGLE_KEY === 'YOUR_API_KEY_HERE') {
    const query = address || place_id || '';
    const stop = db.prepare(
      'SELECT * FROM stops WHERE name LIKE ? OR id = ? LIMIT 1'
    ).get(`%${query}%`, query);
    if (stop) return res.json({ success: true, name: stop.name, lat: stop.lat, lon: stop.lon });
    return res.status(404).json({ success: false, error: 'Location not found. Add a Google API key to enable full geocoding.' });
  }

  try {
    const param = place_id
      ? `place_id=${encodeURIComponent(place_id)}`
      : `address=${encodeURIComponent(address)}&region=in`;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${param}&key=${GOOGLE_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.results && data.results.length > 0) {
      const loc = data.results[0].geometry.location;
      return res.json({
        success: true,
        name: data.results[0].formatted_address,
        lat: loc.lat,
        lon: loc.lng
      });
    }
    res.status(404).json({ success: false, error: 'No geocoding results found.' });
  } catch (err) {
    console.error('Google Geocoding error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Location resolver: local DB first, then Google Geocoding ────────────────
async function resolveLocation(query) {
  if (!query) return null;

  // Raw lat,lon string
  const coordMatch = query.match(/^([+-]?\d+(\.\d+)?),([+-]?\d+(\.\d+)?)$/);
  if (coordMatch) {
    return { name: `Location (${query})`, lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[3]) };
  }

  // Local DB lookup
  const stop = db.prepare(
    'SELECT * FROM stops WHERE name LIKE ? OR city LIKE ? LIMIT 1'
  ).get(`%${query}%`, `%${query}%`);
  if (stop) return { name: stop.name, lat: stop.lat, lon: stop.lon };

  // Google Geocoding fallback
  if (GOOGLE_KEY && GOOGLE_KEY !== 'YOUR_API_KEY_HERE') {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(query)}&region=in&key=${GOOGLE_KEY}`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.results && data.results.length > 0) {
        const loc = data.results[0].geometry.location;
        return { name: data.results[0].formatted_address, lat: loc.lat, lon: loc.lng };
      }
    } catch (err) {
      console.error('Geocoding fallback error:', err.message);
    }
  }

  return null;
}

// ─── Route calculation helper ─────────────────────────────────────────────────
function buildRouteOptions(origin, destination, startTime, preference) {
  // Use new multi-route generation algorithm
  const routes = getMultipleRoutes(origin, destination, startTime || '08:00');
  
  if (routes.length === 0) {
    return [];
  }

  // Format routes with additional metadata
  return routes.map((route, idx) => ({
    ...route,
    sequenceNumber: idx + 1,
    estimatedBookingTime: route.transfers > 0 ? '20-30 mins' : '5-10 mins',
    totalStops: route.path.length,
    modeBreakdown: getModeBreakdown(route.path)
  }));
}

// Helper to get mode breakdown
function getModeBreakdown(path) {
  const breakdown = {};
  path.forEach(segment => {
    if (segment.mode && segment.mode !== 'transfer') {
      breakdown[segment.mode] = (breakdown[segment.mode] || 0) + segment.duration;
    }
  });
  return Object.entries(breakdown).map(([mode, time]) => ({
    mode,
    totalMinutes: Math.round(time),
    percentage: Math.round((time / path.reduce((sum, s) => sum + (s.mode !== 'transfer' ? s.duration : 0), 0)) * 100)
  }));
}

// ─── POST /api/route (used by React frontend with lat/lon objects) ─────────────
app.post('/api/route', async (req, res) => {
  const { origin, destination, startTime, preference } = req.body;
  if (!origin || !destination || !startTime) {
    return res.status(400).json({ success: false, error: 'origin, destination, and startTime are required.' });
  }

  // If coordinates already provided, skip geocoding
  const resolvedOrigin = (origin.lat && origin.lon)
    ? origin
    : await resolveLocation(typeof origin === 'string' ? origin : origin.name);
  const resolvedDest = (destination.lat && destination.lon)
    ? destination
    : await resolveLocation(typeof destination === 'string' ? destination : destination.name);

  if (!resolvedOrigin || !resolvedDest) {
    return res.status(404).json({ success: false, error: 'Could not resolve location(s).' });
  }

  try {
    const routes = buildRouteOptions(resolvedOrigin, resolvedDest, startTime, preference);
    res.json({ success: true, routes });
  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── GET /api/route?from=A&to=B&startTime=HH:MM&preference=X ─────────────────
app.get('/api/route', async (req, res) => {
  const { from, to, startTime, preference } = req.query;
  if (!from || !to) {
    return res.status(400).json({ success: false, error: 'from and to query params are required.' });
  }

  const [origin, destination] = await Promise.all([resolveLocation(from), resolveLocation(to)]);
  if (!origin || !destination) {
    return res.status(404).json({
      success: false,
      error: `Could not resolve locations. "from=${from}" → ${origin ? 'OK' : 'NOT FOUND'}, "to=${to}" → ${destination ? 'OK' : 'NOT FOUND'}`
    });
  }

  try {
    const routes = buildRouteOptions(origin, destination, startTime, preference);
    res.json({ success: true, routes });
  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── GET /api/fare?from=A&to=B ────────────────────────────────────────────────
app.get('/api/fare', async (req, res) => {
  const { from, to, startTime } = req.query;
  if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required.' });

  const [origin, destination] = await Promise.all([resolveLocation(from), resolveLocation(to)]);
  if (!origin || !destination) return res.status(404).json({ success: false, error: 'Locations not found.' });

  try {
    const route = solveDijkstra(origin, destination, startTime || '08:00', 'fastest');
    if (!route.success) return res.status(404).json({ success: false, error: 'Route not found.' });

    res.json({
      success: true,
      totalCost: route.totalCost,
      breakdown: {
        baseFare: Math.round(route.totalCost * 0.85),
        taxesAndSurcharges: Math.round(route.totalCost * 0.12),
        serviceFee: Math.round(route.totalCost * 0.03),
        segments: route.path.map(s => ({ mode: s.mode, detail: s.detail, cost: s.cost }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── GET /api/realtime?from=A&to=B ───────────────────────────────────────────
app.get('/api/realtime', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required.' });

  const [origin, destination] = await Promise.all([resolveLocation(from), resolveLocation(to)]);
  if (!origin || !destination) return res.status(404).json({ success: false, error: 'Locations not found.' });

  try {
    const route = solveDijkstra(origin, destination, '08:00', 'fastest');
    if (!route.success) return res.status(404).json({ success: false, error: 'Route not found.' });

    const updates = route.path
      .filter(s => ['flight', 'train', 'metro'].includes(s.mode))
      .map(s => {
        const delay = [0, 0, 5, 10, 15, 30][Math.floor(Math.random() * 6)];
        return {
          mode: s.mode,
          lineOrFlight: s.detail,
          delayMinutes: delay,
          status: delay === 0 ? 'On Time' : delay <= 15 ? 'Minor Delay' : 'Delayed',
          gateOrPlatform: s.mode === 'flight'
            ? `Gate ${Math.floor(Math.random() * 15 + 1)}`
            : `Platform ${Math.floor(Math.random() * 8 + 1)}`
        };
      });

    res.json({
      success: true,
      trafficStatus: ['Normal', 'Heavy Traffic', 'Congested'][Math.floor(Math.random() * 3)],
      updates
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 India Transit Planner running on port ${PORT}`);
  if (GOOGLE_KEY && GOOGLE_KEY !== 'YOUR_API_KEY_HERE') {
    console.log(`✅ Google Maps API configured`);
  } else {
    console.log(`⚠️  Google Maps API key not set → using local DB for location resolution`);
    console.log(`   Set GOOGLE_MAPS_API_KEY in backend/.env to enable full location search`);
  }
});

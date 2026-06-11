import React, { useState, useEffect, useRef, useCallback } from 'react';
import MapContainer from './components/MapContainer';
import { 
  Plane, Train, Compass, Search, Calendar, MapPin, 
  Leaf, CreditCard, ChevronRight, AlertCircle, Loader2
} from 'lucide-react';

const API_BASE = 'http://localhost:5001';

const TRANSLATIONS = {
  en: {
    title: "India Transit Planner",
    subtitle: "Multi-Modal Routing Engine",
    origin: "Origin",
    destination: "Destination",
    startTime: "Departure Time",
    search: "Find Routes",
    fastest: "Fastest",
    cheapest: "Cheapest",
    eco: "Eco",
    presets: "Popular Journeys",
    duration: "Duration",
    cost: "Fare Est.",
    co2: "CO₂",
    booking: "Book Tickets",
    details: "Step-by-Step Breakdown",
    no_results: "Type any location in India to plan your journey.",
    loading: "Finding optimal multi-modal paths...",
    book_now: "Confirm Simulated Booking",
    booking_success: "Booking Confirmed! Ref: ",
    booking_sub: "Redirecting to portal...",
    hours: "h", mins: "m", days: "d",
    placeholder_origin: "e.g. Connaught Place, Delhi",
    placeholder_dest: "e.g. Bandra, Mumbai",
  },
  hi: {
    title: "इंडिया ट्रांजिट प्लानर",
    subtitle: "मल्टी-मॉडल मार्ग खोजक",
    origin: "प्रारंभिक स्थान",
    destination: "गंतव्य स्थान",
    startTime: "प्रस्थान समय",
    search: "मार्ग खोजें",
    fastest: "सबसे तेज़",
    cheapest: "सबसे सस्ता",
    eco: "इको",
    presets: "लोकप्रिय यात्राएं",
    duration: "समय",
    cost: "किराया",
    co2: "CO₂",
    booking: "टिकट बुक करें",
    details: "कदम-दर-कदम विवरण",
    no_results: "भारत में कोई भी स्थान टाइप करें।",
    loading: "मार्गों की गणना की जा रही है...",
    book_now: "बुकिंग की पुष्टि करें",
    booking_success: "बुकिंग सफल! संदर्भ: ",
    booking_sub: "पोर्टल पर भेजा जा रहा है...",
    hours: "घं", mins: "मि", days: "दि",
    placeholder_origin: "जैसे: कनॉट प्लेस, दिल्ली",
    placeholder_dest: "जैसे: बांद्रा, मुंबई",
  }
};

const MODE_ICONS = {
  flight: <Plane className="w-4 h-4" />,
  train:  <Train className="w-4 h-4" />,
  metro:  <Compass className="w-4 h-4" />,
  bus:    <Compass className="w-4 h-4" />,
  road:   <MapPin className="w-4 h-4" />,
  transfer: <ChevronRight className="w-3 h-3" />
};

const MODE_COLORS = {
  flight: '#06b6d4', train: '#ef4444', metro: '#eab308',
  bus: '#10b981', road: '#8b5cf6', transfer: '#64748b'
};

const QUICK_PRESETS = [
  {
    name: "Delhi Dwarka → Mumbai (Flight)",
    origin: { name: "Dwarka Sector 10 Landmark", lat: 28.5800, lon: 77.0580 },
    destination: { name: "Gateway of India, Mumbai", lat: 18.9220, lon: 72.8347 },
    time: "07:30"
  },
  {
    name: "Delhi CP → Noida (Metro)",
    origin: { name: "Connaught Place Landmark", lat: 28.6304, lon: 77.2177 },
    destination: { name: "Noida Sector 62 Metro", lat: 28.6225, lon: 77.3585 },
    time: "08:30"
  },
  {
    name: "Delhi → Agra Taj Mahal (Train)",
    origin: { name: "Connaught Place Landmark", lat: 28.6304, lon: 77.2177 },
    destination: { name: "Taj Mahal (Agra)", lat: 27.1751, lon: 78.0421 },
    time: "06:00"
  },
  {
    name: "Delhi → Jaipur (Shatabdi)",
    origin: { name: "New Delhi Railway Station (NDLS)", lat: 28.6430, lon: 77.2223 },
    destination: { name: "Hawa Mahal (Jaipur)", lat: 26.9239, lon: 75.8267 },
    time: "05:45"
  },
  {
    name: "Bengaluru Commute (Metro)",
    origin: { name: "Whitefield Metro", lat: 12.9698, lon: 77.7500 },
    destination: { name: "Electronic City Bus Stand", lat: 12.8452, lon: 77.6602 },
    time: "17:30"
  },
  {
    name: "Vellore → Delhi (Multi-Modal)",
    origin: { name: "Vellore Fort & City Centre", lat: 12.9358, lon: 79.1316 },
    destination: { name: "Connaught Place Landmark", lat: 28.6304, lon: 77.2177 },
    time: "07:00"
  },
  {
    name: "Chennai → Bangalore (Express)",
    origin: { name: "Marina Beach (Chennai)", lat: 13.0499, lon: 80.2822 },
    destination: { name: "Cubbon Park Landmark", lat: 12.9738, lon: 77.5906 },
    time: "08:00"
  }
];

// Debounce helper
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function App() {
  const [lang, setLang] = useState('en');
  const t = TRANSLATIONS[lang];

  // Search inputs
  const [originText, setOriginText]     = useState('');
  const [originCoord, setOriginCoord]   = useState(null);
  const [destText, setDestText]         = useState('');
  const [destCoord, setDestCoord]       = useState(null);
  const [startTime, setStartTime]       = useState('08:00');
  const [filterType, setFilterType]     = useState('fastest');

  // Autocomplete
  const [originPredictions, setOriginPredictions] = useState([]);
  const [destPredictions, setDestPredictions]     = useState([]);
  const [showOriginDrop, setShowOriginDrop]   = useState(false);
  const [showDestDrop, setShowDestDrop]       = useState(false);

  // Results
  const [loading, setLoading]               = useState(false);
  const [routes, setRoutes]                 = useState([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [realtimeAlert, setRealtimeAlert]   = useState(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccessMsg, setBookingSuccessMsg] = useState('');

  const originDebounced = useDebounce(originText, 280);
  const destDebounced   = useDebounce(destText, 280);

  // ─── Fetch Places predictions from backend proxy ──────────────────────────
  useEffect(() => {
    if (originDebounced.length < 2 || originCoord) {
      setOriginPredictions([]);
      return;
    }
    fetch(`${API_BASE}/api/places?input=${encodeURIComponent(originDebounced)}`)
      .then(r => r.json())
      .then(d => setOriginPredictions(d.predictions || []))
      .catch(() => {});
  }, [originDebounced, originCoord]);

  useEffect(() => {
    if (destDebounced.length < 2 || destCoord) {
      setDestPredictions([]);
      return;
    }
    fetch(`${API_BASE}/api/places?input=${encodeURIComponent(destDebounced)}`)
      .then(r => r.json())
      .then(d => setDestPredictions(d.predictions || []))
      .catch(() => {});
  }, [destDebounced, destCoord]);

  // ─── Select a prediction → geocode it ─────────────────────────────────────
  const selectPrediction = useCallback(async (prediction, isOrigin) => {
    const label = prediction.description;
    if (isOrigin) { setOriginText(label); setShowOriginDrop(false); }
    else          { setDestText(label);   setShowDestDrop(false); }

    // If the prediction has a local source with known coords, use them directly
    if (prediction.source === 'local') {
      const coord = { name: label, lat: prediction.lat, lon: prediction.lon };
      if (isOrigin) setOriginCoord(coord);
      else          setDestCoord(coord);
      return;
    }

    // Otherwise geocode via backend
    try {
      const param = prediction.place_id
        ? `place_id=${encodeURIComponent(prediction.place_id)}`
        : `address=${encodeURIComponent(label)}`;
      const r = await fetch(`${API_BASE}/api/geocode?${param}`);
      const data = await r.json();
      if (data.success) {
        const coord = { name: data.name, lat: data.lat, lon: data.lon };
        if (isOrigin) setOriginCoord(coord);
        else          setDestCoord(coord);
      }
    } catch (e) {
      console.error('Geocode error', e);
    }
  }, []);

  // ─── Handle preset click ───────────────────────────────────────────────────
  const handlePresetClick = (preset) => {
    setOriginText(preset.origin.name);
    setOriginCoord(preset.origin);
    setDestText(preset.destination.name);
    setDestCoord(preset.destination);
    setStartTime(preset.time);
    triggerSearch(preset.origin, preset.destination, preset.time);
  };

  // ─── Form submit ───────────────────────────────────────────────────────────
  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    let orig = originCoord;
    let dest = destCoord;

    // If user typed but didn't pick a suggestion, geocode the raw text
    if (!orig && originText.trim().length > 1) {
      const r = await fetch(`${API_BASE}/api/geocode?address=${encodeURIComponent(originText)}`);
      const d = await r.json();
      if (d.success) { orig = { name: d.name, lat: d.lat, lon: d.lon }; setOriginCoord(orig); }
    }
    if (!dest && destText.trim().length > 1) {
      const r = await fetch(`${API_BASE}/api/geocode?address=${encodeURIComponent(destText)}`);
      const d = await r.json();
      if (d.success) { dest = { name: d.name, lat: d.lat, lon: d.lon }; setDestCoord(dest); }
    }

    if (!orig || !dest) {
      alert(lang === 'en'
        ? 'Could not find those locations. Please select from the dropdown suggestions.'
        : 'स्थान नहीं मिला। कृपया सुझावों में से चुनें।');
      return;
    }

    triggerSearch(orig, dest, startTime);
  };

  // ─── Core route search ─────────────────────────────────────────────────────
  const triggerSearch = (orig, dest, time) => {
    setLoading(true);
    setRoutes([]);
    setSelectedRouteIdx(0);
    setRealtimeAlert(null);
    setBookingSuccessMsg('');

    fetch(`${API_BASE}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: orig, destination: dest, startTime: time, preference: filterType })
    })
      .then(r => r.json())
      .then(data => {
        setLoading(false);
        if (data.success) {
          setRoutes(data.routes);
          generateMockAlert(data.routes[0]);
        } else {
          alert('Error: ' + data.error);
        }
      })
      .catch(err => {
        setLoading(false);
        alert('Cannot connect to backend. Is the server running on port 5001?');
      });
  };

  const generateMockAlert = (route) => {
    if (!route?.path) return;
    const transit = route.path.filter(s => ['flight','train','metro'].includes(s.mode));
    if (!transit.length) return;
    const step = transit[Math.floor(Math.random() * transit.length)];
    const delay = [5, 10, 15, 30][Math.floor(Math.random() * 4)];
    if (step.mode === 'flight')  setRealtimeAlert(`⚠️ ${step.detail}: ${delay}-min ATC delay reported.`);
    else if (step.mode === 'train') setRealtimeAlert(`⚠️ Train signal delay of ${delay} mins reported on this route.`);
    else setRealtimeAlert(`ℹ️ High crowd density on ${step.detail}. Allow extra boarding time.`);
  };

  const handleBooking = () => {
    setBookingLoading(true);
    setTimeout(() => {
      setBookingLoading(false);
      setBookingSuccessMsg(`IND-${Math.floor(Math.random() * 900000 + 100000)}`);
    }, 1500);
  };

  const activeRoute = routes[selectedRouteIdx];

  const formatMins = (total) => {
    const hrs = Math.floor(total / 60);
    const mins = total % 60;
    if (hrs >= 24) {
      const days = Math.floor(hrs / 24);
      const remHrs = hrs % 24;
      return `${days}${t.days} ${remHrs}${t.hours} ${mins}${t.mins}`;
    }
    return hrs > 0 ? `${hrs}${t.hours} ${mins}${t.mins}` : `${mins}${t.mins}`;
  };

  return (
    <div className="app-container">
      {/* ═══ SIDEBAR ══════════════════════════════════════════════════════════ */}
      <aside className="sidebar">

        {/* Brand */}
        <div className="brand">
          <div className="brand-logo">
            <Compass className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1>{t.title}</h1>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t.subtitle}</p>
          </div>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* Origin */}
          <div className="form-group">
            <label className="form-label">{t.origin}</label>
            <div className="input-container" style={{ position: 'relative' }}>
              <MapPin className="input-icon w-4 h-4" />
              <input
                id="origin-input"
                type="text"
                className="form-input"
                placeholder={t.placeholder_origin}
                value={originText}
                autoComplete="off"
                onChange={e => { setOriginText(e.target.value); setOriginCoord(null); setShowOriginDrop(true); }}
                onFocus={() => setShowOriginDrop(true)}
                onBlur={() => setTimeout(() => setShowOriginDrop(false), 200)}
              />
            </div>
            {showOriginDrop && originPredictions.length > 0 && (
              <div className="autocomplete-dropdown">
                {originPredictions.map((p, i) => (
                  <div key={i} className="autocomplete-item" onMouseDown={() => selectPrediction(p, true)}>
                    <div className="stop-icon">
                      <MapPin className="w-3 h-3" style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>
                        {p.structured_formatting?.main_text || p.description}
                      </div>
                      {p.structured_formatting?.secondary_text && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {p.structured_formatting.secondary_text}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Destination */}
          <div className="form-group">
            <label className="form-label">{t.destination}</label>
            <div className="input-container" style={{ position: 'relative' }}>
              <MapPin className="input-icon w-4 h-4" />
              <input
                id="dest-input"
                type="text"
                className="form-input"
                placeholder={t.placeholder_dest}
                value={destText}
                autoComplete="off"
                onChange={e => { setDestText(e.target.value); setDestCoord(null); setShowDestDrop(true); }}
                onFocus={() => setShowDestDrop(true)}
                onBlur={() => setTimeout(() => setShowDestDrop(false), 200)}
              />
            </div>
            {showDestDrop && destPredictions.length > 0 && (
              <div className="autocomplete-dropdown">
                {destPredictions.map((p, i) => (
                  <div key={i} className="autocomplete-item" onMouseDown={() => selectPrediction(p, false)}>
                    <div className="stop-icon">
                      <MapPin className="w-3 h-3" style={{ color: 'var(--secondary)' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>
                        {p.structured_formatting?.main_text || p.description}
                      </div>
                      {p.structured_formatting?.secondary_text && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {p.structured_formatting.secondary_text}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Time + Search button */}
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{t.startTime}</label>
              <div className="input-container">
                <Calendar className="input-icon w-4 h-4" />
                <input
                  type="time"
                  className="form-input"
                  style={{ paddingLeft: '38px' }}
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                />
              </div>
            </div>
            <button type="submit" className="search-btn" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>{t.search}</span>
            </button>
          </div>
        </form>

        {/* Filter Tabs */}
        <div className="filter-tabs">
          {['fastest', 'cheapest', 'eco'].map(f => (
            <button
              key={f}
              className={`filter-tab ${filterType === f ? 'active' : ''}`}
              onClick={() => {
                setFilterType(f);
                if (originCoord && destCoord) triggerSearch(originCoord, destCoord, startTime);
              }}
            >
              {t[f]}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="results-container">
          {loading && (
            <div className="loader-container">
              <div className="spinner" />
              <p style={{ fontSize: '13px' }}>{t.loading}</p>
            </div>
          )}

          {!loading && routes.length === 0 && (
            <div className="no-results">
              <Compass className="w-10 h-10" style={{ opacity: 0.3 }} />
              <p style={{ fontSize: '13px' }}>{t.no_results}</p>
            </div>
          )}

          {!loading && routes.length > 0 && (
            <>
              {realtimeAlert && (
                <div className="status-ticker">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{realtimeAlert}</span>
                </div>
              )}

              {routes.map((route, idx) => (
                <div
                  key={route.id}
                  className={`route-card ${selectedRouteIdx === idx ? 'selected' : ''}`}
                  onClick={() => { setSelectedRouteIdx(idx); setBookingSuccessMsg(''); }}
                  style={{ cursor: 'pointer', position: 'relative' }}
                >
                  <span className="route-badge">{route.badge}</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <h3 className="route-title">{route.title}</h3>
                    <span style={{ fontSize: '10px', background: '#5b21b6', color: '#e9d5ff', padding: '4px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      Option {route.sequenceNumber}
                    </span>
                  </div>
                  
                  {route.description && (
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', fontStyle: 'italic' }}>
                      {route.description}
                    </p>
                  )}

                  <div className="route-meta">
                    <div className="meta-item"><span>{t.duration}:</span><span className="meta-val">{formatMins(route.totalDuration)}</span></div>
                    <div className="meta-item"><span>{t.cost}:</span><span className="meta-val">₹{route.totalCost}</span></div>
                    <div className="meta-item">
                      <Leaf className="w-3.5 h-3.5" style={{ color: '#34d399' }} />
                      <span>{t.co2}:</span>
                      <span className="meta-val">{route.totalCo2} kg</span>
                    </div>
                    <div className="meta-item">
                      <ChevronRight className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
                      <span>Transfers:</span>
                      <span className="meta-val">{route.transfers}</span>
                    </div>
                  </div>

                  {/* Mode Breakdown */}
                  {route.modeBreakdown && route.modeBreakdown.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', color: '#cbd5e1' }}>Transport Mix:</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {route.modeBreakdown.map((mb, i) => (
                          <div key={i} style={{
                            fontSize: '10px',
                            background: MODE_COLORS[mb.mode],
                            color: '#000',
                            padding: '3px 6px',
                            borderRadius: '4px',
                            fontWeight: 600
                          }}>
                            {mb.mode.toUpperCase()} {mb.percentage}%
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pros & Cons */}
                  {(route.pros || route.cons) && (
                    <div style={{ marginTop: '8px', fontSize: '10px', display: 'flex', gap: '12px' }}>
                      {route.pros && route.pros.length > 0 && (
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#34d399', fontWeight: 600, marginBottom: '3px' }}>✓ Pros:</div>
                          <div style={{ color: '#a7f3d0', lineHeight: 1.4 }}>
                            {route.pros.slice(0, 2).join(' • ')}
                          </div>
                        </div>
                      )}
                      {route.cons && route.cons.length > 0 && (
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#f87171', fontWeight: 600, marginBottom: '3px' }}>✗ Cons:</div>
                          <div style={{ color: '#fca5a5', lineHeight: 1.4 }}>
                            {route.cons.slice(0, 2).join(' • ')}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="route-timeline">
                    {route.path.map((step, si) => (
                      <React.Fragment key={si}>
                        {si > 0 && <span className="timeline-arrow">{MODE_ICONS.transfer}</span>}
                        <div
                          className="timeline-segment"
                          style={{ backgroundColor: MODE_COLORS[step.mode] || '#8b5cf6', flexGrow: step.duration }}
                          title={`${step.mode}: ${step.detail}`}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Step-by-Step Details */}
          {!loading && activeRoute && (
            <div className="details-panel">
              <h2 className="details-title">{t.details}</h2>
              <div className="step-list">
                {activeRoute.path.map((step, idx) => (
                  <div className="step-item" key={idx}>
                    <div className={`step-bullet ${step.mode}`} />
                    <div className="step-time">{step.depTime} → {step.arrTime} ({formatMins(step.duration)})</div>
                    <div className="step-card">
                      <div className="step-header">
                        <span className={`step-mode-label ${step.mode}`}>
                          {MODE_ICONS[step.mode]}
                          <span style={{ textTransform: 'capitalize' }}>{step.mode}</span>
                        </span>
                        {step.cost > 0 && <span className="step-cost">₹{step.cost}</span>}
                      </div>
                      <div className="step-desc">{step.detail}</div>
                      <div className="step-endpoints">{step.from.name} → {step.to.name}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Booking Widget */}
              <div className="glass-panel" style={{ padding: '16px', borderRadius: '12px', marginTop: '10px' }}>
                <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <CreditCard className="w-4 h-4" style={{ color: '#818cf8' }} />
                  {t.booking}
                </h4>
                {bookingSuccessMsg ? (
                  <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#a7f3d0' }}>
                    <p><strong>{t.booking_success}</strong></p>
                    <p style={{ fontFamily: 'monospace', fontSize: '15px', letterSpacing: '0.05em', color: '#34d399', margin: '4px 0' }}>{bookingSuccessMsg}</p>
                    <p style={{ fontSize: '11px', color: '#6ee7b7' }}>{t.booking_sub}</p>
                  </div>
                ) : (
                  <button className="search-btn" style={{ padding: '10px', fontSize: '13px' }} onClick={handleBooking} disabled={bookingLoading}>
                    {bookingLoading
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <><CreditCard className="w-3.5 h-3.5" /><span>{t.book_now}</span></>}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ═══ MAP AREA ══════════════════════════════════════════════════════════ */}
      <main style={{ position: 'relative', height: '100%' }}>

        {/* Language Toggle */}
        <div className="lang-switcher">
          {['en', 'hi'].map(l => (
            <button key={l} className={`lang-btn ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>
              {l === 'en' ? 'EN' : 'हिं'}
            </button>
          ))}
        </div>

        {/* Quick Presets */}
        <div className="quick-presets">
          <div className="preset-title">{t.presets}</div>
          <div className="preset-grid">
            {QUICK_PRESETS.map((preset, idx) => (
              <button key={idx} className="preset-item" onClick={() => handlePresetClick(preset)}>
                <span>{preset.name}</span>
                <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>

        <MapContainer activeRoute={activeRoute} />
      </main>
    </div>
  );
}

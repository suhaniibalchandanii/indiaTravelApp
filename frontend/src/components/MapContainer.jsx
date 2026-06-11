import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

// Custom SVG Icons for Start, End, and Transit Nodes
const createDivIcon = (color, text) => {
  return L.divIcon({
    html: `
      <div style="
        background-color: ${color}; 
        width: 14px; 
        height: 14px; 
        border-radius: 50%; 
        border: 2.5px solid #0b0f19;
        box-shadow: 0 0 10px ${color};
        display: flex;
        align-items: center;
        justify-content: center;
      "></div>`,
    className: 'custom-marker-icon',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
};

const createTerminusIcon = (type) => {
  const color = type === 'start' ? '#10b981' : '#ef4444';
  const label = type === 'start' ? 'A' : 'B';
  return L.divIcon({
    html: `
      <div style="
        background: linear-gradient(135deg, ${color}, #ffffff); 
        width: 26px; 
        height: 26px; 
        border-radius: 50%; 
        border: 2px solid #0b0f19;
        box-shadow: 0 0 15px ${color};
        color: #0b0f19;
        font-family: 'Outfit', sans-serif;
        font-weight: 800;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">${label}</div>`,
    className: 'custom-terminus-icon',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
};

const MODE_COLORS = {
  flight: '#06b6d4',
  train: '#ef4444',
  metro: '#eab308',
  bus: '#10b981',
  road: '#8b5cf6',
  transfer: '#64748b'
};

export default function MapContainer({ activeRoute, onSelectStop }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersGroupRef = useRef(null);

  useEffect(() => {
    if (mapInstance.current) return;

    // Initialize Map centering India
    mapInstance.current = L.map(mapRef.current, {
      zoomControl: false
    }).setView([20.5937, 78.9629], 5);

    // Zoom control position
    L.control.zoom({
      position: 'topright'
    }).addTo(mapInstance.current);

    // CartoDB Dark Matter tiles (premium look)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(mapInstance.current);

    layersGroupRef.current = L.featureGroup().addTo(mapInstance.current);
  }, []);

  // Update map features when activeRoute changes
  useEffect(() => {
    if (!mapInstance.current || !layersGroupRef.current) return;

    // Clear previous layers
    layersGroupRef.current.clearLayers();

    if (!activeRoute || !activeRoute.path || activeRoute.path.length === 0) {
      return;
    }

    const bounds = L.latLngBounds();

    // Plot Route Paths
    activeRoute.path.forEach((step, idx) => {
      const { from, to, mode, detail, duration, cost } = step;
      
      const color = MODE_COLORS[mode] || MODE_COLORS.road;
      const latlngs = [
        [from.lat, from.lon],
        [to.lat, to.lon]
      ];

      // Draw Polyline
      const isTransfer = mode === 'transfer';
      const polyline = L.polyline(latlngs, {
        color: color,
        weight: isTransfer ? 3 : 5,
        opacity: isTransfer ? 0.7 : 0.85,
        dashArray: isTransfer ? '5, 8' : null,
        lineCap: 'round',
        lineJoin: 'round'
      });

      // Add a popup on hover/click
      polyline.bindPopup(`
        <div style="color: #f8fafc; background: #111827; padding: 4px; font-family: sans-serif;">
          <strong style="text-transform: capitalize; color: ${color};">${mode} Segment</strong><br/>
          <span>${detail}</span><br/>
          <span>Time: ${duration} mins | Cost: ₹${cost}</span>
        </div>
      `, {
        className: 'dark-popup'
      });

      polyline.addTo(layersGroupRef.current);
      
      // Update bounds
      bounds.extend([from.lat, from.lon]);
      bounds.extend([to.lat, to.lon]);

      // Add Terminus & Node markers
      if (idx === 0) {
        // Start marker
        L.marker([from.lat, from.lon], { icon: createTerminusIcon('start') })
          .bindPopup(`<strong>Origin:</strong> ${from.name}`)
          .addTo(layersGroupRef.current);
      }

      if (idx === activeRoute.path.length - 1) {
        // End marker
        L.marker([to.lat, to.lon], { icon: createTerminusIcon('end') })
          .bindPopup(`<strong>Destination:</strong> ${to.name}`)
          .addTo(layersGroupRef.current);
      }

      // Add small circle indicators for intermediate stops
      if (idx > 0) {
        L.marker([from.lat, from.lon], { icon: createDivIcon(color, from.name) })
          .bindPopup(`<strong>Stop:</strong> ${from.name}`)
          .addTo(layersGroupRef.current);
      }
    });

    // Fit map to bounds with padding
    mapInstance.current.fitBounds(bounds, {
      padding: [50, 50],
      maxZoom: 14,
      animate: true,
      duration: 1.2
    });
  }, [activeRoute]);

  return (
    <div className="map-view">
      <div id="leaflet-map" ref={mapRef} />
    </div>
  );
}

import { db } from './database.js';

/**
 * MULTI-ROUTE ALGORITHM
 * Generates 3-4 distinct route alternatives using different strategies
 */

// Haversine distance formula
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Convert "HH:MM" or "HH:MM+N" string to minutes from midnight, handling day rollover
export function timeToMin(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return 0;
  }
  const [timePart, dayPart] = timeStr.split('+');
  const [h, m] = timePart.split(':').map(Number);
  const days = dayPart ? Number(dayPart) : 0;
  return (h * 60 + m) + (days * 1440);
}

// Convert minutes from midnight back to "HH:MM" (handles day rollover)
export function minToTime(minutes) {
  const mins = Math.round(minutes) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Add days indicator if rollover occurred
export function formatDuration(mins) {
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    return `${days}d ${remHrs}h ${m}m`;
  }
  return `${hrs}h ${m}m`;
}

// Load all stops and routes into memory for faster graph execution
let allStops = [];
let allRoutes = {};
let transfers = [];
let schedules = [];

const MODE_HUB_THRESHOLDS = {
  flight: 250,
  train: 250,
  bus: 120,
  metro: 120,
  ferry: 180
};

const ROAD_ACCESS_OPTIONS = {
  walk: { speed: 5, costPerKm: 0, baseWait: 0, co2PerKm: 0.0 },
  auto: { speed: 35, costPerKm: 10, baseWait: 3, co2PerKm: 0.08 },
  cab: { speed: 50, costPerKm: 15, baseWait: 5, co2PerKm: 0.12 },
  car: { speed: 60, costPerKm: 12, baseWait: 0, co2PerKm: 0.15 }
};

function loadGraphData() {
  // Fetch stops
  const stopsQuery = db.prepare('SELECT * FROM stops');
  allStops = stopsQuery.all();

  // Fetch routes
  const routesQuery = db.prepare('SELECT * FROM routes');
  const routesList = routesQuery.all();
  allRoutes = {};
  routesList.forEach(r => {
    allRoutes[r.id] = r;
  });

  // Fetch transfers
  const transfersQuery = db.prepare('SELECT * FROM inter_modal_transfers');
  transfers = transfersQuery.all();

  // Fetch schedules
  const schedulesQuery = db.prepare('SELECT * FROM schedules');
  schedules = schedulesQuery.all();
}

function getStopsByMode(mode) {
  return allStops.filter(stop => stop.type === mode);
}

function findNearestHubs(coord, mode, maxResults = 4) {
  return getStopsByMode(mode)
    .map(stop => ({ stop, dist: haversineDistance(coord.lat, coord.lon, stop.lat, stop.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxResults);
}

function buildAnchors(coord, excludedModes) {
  const anchorModes = ['flight', 'train', 'bus', 'metro', 'ferry'];
  const anchors = [];

  anchorModes.forEach(mode => {
    if (excludedModes.includes(mode)) return;
    const candidateStops = findNearestHubs(coord, mode, 3);
    if (candidateStops.length === 0) return;

    const threshold = MODE_HUB_THRESHOLDS[mode] || 120;
    const nearby = candidateStops.filter(c => c.dist <= threshold);
    if (nearby.length > 0) {
      nearby.forEach(c => anchors.push({ ...c, mode }));
      return;
    }

    // If there are no nearby stops of this mode, still include the closest hub to ensure remote access.
    anchors.push({ ...candidateStops[0], mode, isRemoteHub: true });
  });

  return anchors;
}

function getAccessModesForDistance(dist) {
  if (dist <= 3) {
    return ['walk', 'auto', 'cab'];
  }
  if (dist <= 25) {
    return ['auto', 'cab'];
  }
  return ['cab'];
}

function calculateRoadAccessEdge(distanceKm, accessMode) {
  const settings = ROAD_ACCESS_OPTIONS[accessMode] || ROAD_ACCESS_OPTIONS.cab;
  const travelMins = (distanceKm / settings.speed) * 60;
  const duration = travelMins + settings.baseWait;
  const cost = distanceKm * settings.costPerKm;
  const co2 = distanceKm * settings.co2PerKm;
  return { duration, cost, co2 };
}

// Initialize loading
loadGraphData();

/**
 * Time-Dependent Dijkstra routing algorithm
 * @param {Object} startCoord { lat, lon, name }
 * @param {Object} endCoord { lat, lon, name }
 * @param {string} startTimeStr "HH:MM"
 * @param {string} preference 'fastest' | 'cheapest' | 'eco'
 * @param {Array<string>} excludedModes Modes to exclude (e.g. ['flight'] for rail option)
 */
export function solveDijkstra(startCoord, endCoord, startTimeStr, preference = 'fastest', excludedModes = []) {
  // Re-load graph data if empty (safety check)
  if (allStops.length === 0) {
    loadGraphData();
  }

  const startTimeMins = timeToMin(startTimeStr);

  // 1. Define objective function weights based on user preference
  let wTime = 1.0;
  let wCost = 0.05; // 1 min = ₹20
  let wCo2 = 0.1;   // 1 min = 10kg CO2
  let wTransfer = 15; // penalty in minutes per transfer
  let wRemoteHub = 10; // penalty for remote hub diversion

  if (preference === 'cheapest') {
    wTime = 0.05;
    wCost = 1.0;
    wCo2 = 0.01;
    wTransfer = 5;
    wRemoteHub = 5;
  } else if (preference === 'eco') {
    wTime = 0.2;
    wCost = 0.02;
    wCo2 = 5.0; // prioritize low carbon footprints
    wTransfer = 10;
    wRemoteHub = 5;
  }

  // 2. Set up virtual start & end nodes
  const START_ID = 'VIRTUAL_START';
  const END_ID = 'VIRTUAL_END';

  // Find nearby stops (within 80 km) for first/last mile
  const nearbyStartStops = [];
  const nearbyEndStops = [];
  const remoteStartAnchors = buildAnchors(startCoord, excludedModes);
  const remoteEndAnchors = buildAnchors(endCoord, excludedModes);

  allStops.forEach(stop => {
    // If stop's mode is excluded, skip it
    if (excludedModes.includes(stop.type)) return;

    const distFromStart = haversineDistance(startCoord.lat, startCoord.lon, stop.lat, stop.lon);
    if (distFromStart <= 80) {
      nearbyStartStops.push({ stop, dist: distFromStart, mode: stop.type });
    }

    const distFromEnd = haversineDistance(endCoord.lat, endCoord.lon, stop.lat, stop.lon);
    if (distFromEnd <= 80) {
      nearbyEndStops.push({ stop, dist: distFromEnd, mode: stop.type });
    }
  });

  // Calculate a baseline road route directly from Start to End
  const directDist = haversineDistance(startCoord.lat, startCoord.lon, endCoord.lat, endCoord.lon);
  const directRoadOption = calculateRoadAccessEdge(directDist, 'cab'); // standard cab edge

  // 3. Dijkstra State Queue and Tables
  // Priority Queue: array sorted by score (ascending)
  const queue = [];
  
  // distMap stores: nodeId -> { score, time, cost, co2, parentState }
  const distMap = new Map();

  // Initialize start state
  const startState = {
    nodeId: START_ID,
    score: 0,
    time: startTimeMins,
    cost: 0,
    co2: 0,
    transfers: 0,
    parent: null,
    edgeType: 'road',
    edgeDetail: 'Start'
  };
  
  queue.push(startState);
  distMap.set(START_ID, { score: 0, time: startTimeMins, cost: 0, co2: 0 });

  while (queue.length > 0) {
    // Sort queue by score (simple and fast for smaller search spaces)
    queue.sort((a, b) => a.score - b.score);
    const curr = queue.shift();

    // If we reached the end, we can reconstruct the path
    if (curr.nodeId === END_ID) {
      return reconstructPath(curr, startCoord, endCoord);
    }

    // Skip if we found a better score already
    const bestRecord = distMap.get(curr.nodeId);
    if (bestRecord && bestRecord.score < curr.score) {
      continue;
    }

    // --- EXPLORE NEIGHBORS ---

    // Case A: Current is START
    if (curr.nodeId === START_ID) {
      // 1. Direct road route to END only as a fallback
      if (!excludedModes.includes('road')) {
        const road = calculateRoadAccessEdge(directDist, 'cab');
        const nextScore = curr.score + (road.duration * wTime) + (road.cost * wCost) + (road.co2 * wCo2) + 30;
        const nextState = {
          nodeId: END_ID,
          score: nextScore,
          time: curr.time + road.duration,
          cost: curr.cost + road.cost,
          co2: curr.co2 + road.co2,
          transfers: 0,
          parent: curr,
          edgeType: 'road',
          edgeDetail: `Cab Direct (${Math.round(directDist)} km)`
        };
        queue.push(nextState);
      }

      // 2. Connect to all nearby transit stops and remote hubs
      const nearbyStopsByMode = {};
      nearbyStartStops.forEach(({ stop, dist, mode }) => {
        if (!nearbyStopsByMode[mode]) {
          nearbyStopsByMode[mode] = [];
        }
        nearbyStopsByMode[mode].push({ stop, dist });
      });

      const startAnchors = [...nearbyStartStops];
      remoteStartAnchors.forEach(anchor => {
        if (!nearbyStopsByMode[anchor.mode] || nearbyStopsByMode[anchor.mode].every(item => item.stop.id !== anchor.stop.id)) {
          startAnchors.push(anchor);
        }
      });

      startAnchors.forEach(({ stop, dist, mode, isRemoteHub }) => {
        if (excludedModes.includes(mode)) return;
        const accessModes = getAccessModesForDistance(dist);
        accessModes.forEach(accessMode => {
          const accessEdge = calculateRoadAccessEdge(dist, accessMode);
          const remotePenalty = isRemoteHub ? wRemoteHub * 3 : 0;
          const nextScore = curr.score + (accessEdge.duration * wTime) + (accessEdge.cost * wCost) + (accessEdge.co2 * wCo2) + remotePenalty;

          const nextState = {
            nodeId: stop.id,
            score: nextScore,
            time: curr.time + accessEdge.duration,
            cost: curr.cost + accessEdge.cost,
            co2: curr.co2 + accessEdge.co2,
            transfers: 0,
            parent: curr,
            edgeType: 'road',
            edgeDetail: `${accessMode.charAt(0).toUpperCase() + accessMode.slice(1)} access (${dist.toFixed(1)} km) to ${stop.name}`
          };

          const prevDist = distMap.get(stop.id);
          if (!prevDist || prevDist.score > nextScore) {
            distMap.set(stop.id, { score: nextScore, time: nextState.time, cost: nextState.cost, co2: nextState.co2 });
            queue.push(nextState);
          }
        });
      });

      continue;
    }

    // Case B: Current is a transit stop
    // 1. Scheduled transit departures
    const outSchedules = schedules.filter(s => s.origin_id === curr.nodeId && !excludedModes.includes(allRoutes[s.route_id]?.mode));
    outSchedules.forEach(sch => {
      const depMins = timeToMin(sch.departure_time);
      
      // Calculate waiting time (minutes)
      let waitMins = depMins - (curr.time % 1440);
      if (waitMins < 0) {
        waitMins += 1440; // Departs the next day
      }

      // Add transfer penalty if we are changing routes
      const parentMode = curr.parent?.edgeType;
      const currentRoute = allRoutes[sch.route_id];
      const isTransfer = parentMode && parentMode !== currentRoute.mode;
      const transferPenalty = isTransfer ? wTransfer : 0;

      const travelTime = sch.duration_minutes;
      const nextTime = curr.time + waitMins + travelTime;
      const nextCost = curr.cost + sch.cost;
      const nextCo2 = curr.co2 + sch.co2_emissions;

      const edgeScore = (waitMins + travelTime) * wTime + sch.cost * wCost + sch.co2_emissions * wCo2 + transferPenalty;
      const nextScore = curr.score + edgeScore;

      const nextState = {
        nodeId: sch.destination_id,
        score: nextScore,
        time: nextTime,
        cost: nextCost,
        co2: nextCo2,
        transfers: curr.transfers + (isTransfer ? 1 : 0),
        parent: curr,
        edgeType: currentRoute.mode,
        edgeDetail: `${currentRoute.name} (Dep: ${sch.departure_time}, Arr: ${sch.arrival_time})`
      };

      const prevDist = distMap.get(sch.destination_id);
      if (!prevDist || prevDist.score > nextScore) {
        distMap.set(sch.destination_id, { score: nextScore, time: nextTime, cost: nextCost, co2: nextCo2 });
        queue.push(nextState);
      }
    });

    // 2. Inter-modal Transfers (walking between NDLS metro and NDLS railway etc.)
    const outTransfers = transfers.filter(t => t.stop_a === curr.nodeId);
    outTransfers.forEach(tr => {
      const nextTime = curr.time + tr.duration_minutes;
      const nextCost = curr.cost + tr.cost;
      const nextScore = curr.score + (tr.duration_minutes * wTime) + (tr.cost * wCost) + wTransfer; // transfer penalty

      const nextState = {
        nodeId: tr.stop_b,
        score: nextScore,
        time: nextTime,
        cost: nextCost,
        co2: curr.co2,
        transfers: curr.transfers + 1,
        parent: curr,
        edgeType: 'transfer',
        edgeDetail: `Walk Connection (${tr.duration_minutes} mins)`
      };

      const prevDist = distMap.get(tr.stop_b);
      if (!prevDist || prevDist.score > nextScore) {
        distMap.set(tr.stop_b, { score: nextScore, time: nextTime, cost: nextCost, co2: curr.co2 });
        queue.push(nextState);
      }
    });

    // 3. Last mile connection from current stop to the final virtual END
    const endAnchors = [...nearbyEndStops];
    remoteEndAnchors.forEach(anchor => {
      if (!endAnchors.some(item => item.stop.id === anchor.stop.id)) {
        endAnchors.push(anchor);
      }
    });

    const endStopMatch = endAnchors.find(es => es.stop.id === curr.nodeId);
    if (endStopMatch && !excludedModes.includes('road')) {
      const { dist, isRemoteHub } = endStopMatch;
      const modes = [
        { name: 'Cab', ...calculateRoadAccessEdge(dist, 'cab') },
        { name: 'Auto', ...calculateRoadAccessEdge(dist, 'auto') }
      ];
      if (dist <= 3) {
        modes.push({ name: 'Walk', ...calculateRoadAccessEdge(dist, 'walk') });
      }

      modes.forEach(mode => {
        const remotePenalty = isRemoteHub ? wRemoteHub * 2 : 0;
        const nextScore = curr.score + (mode.duration * wTime) + (mode.cost * wCost) + (mode.co2 * wCo2) + remotePenalty;
        const nextState = {
          nodeId: END_ID,
          score: nextScore,
          time: curr.time + mode.duration,
          cost: curr.cost + mode.cost,
          co2: curr.co2 + mode.co2,
          transfers: curr.transfers,
          parent: curr,
          edgeType: 'road',
          edgeDetail: `${mode.name} Last-Mile (${dist.toFixed(1)} km) to Destination`
        };

        const prevDist = distMap.get(END_ID);
        if (!prevDist || prevDist.score > nextScore) {
          distMap.set(END_ID, { score: nextScore, time: nextState.time, cost: nextState.cost, co2: nextState.co2 });
          queue.push(nextState);
        }
      });
    }
  }

  // If no path was found, return the direct road option
  if (!excludedModes.includes('road')) {
    return {
      success: true,
      directOnly: true,
      totalDuration: Math.round(directRoadOption.duration),
      totalCost: directRoadOption.cost,
      totalCo2: directRoadOption.co2,
      transfers: 0,
      path: [
        {
          mode: 'road',
          detail: `Direct Cab Route (${Math.round(directDist)} km)`,
          from: startCoord,
          to: endCoord,
          duration: Math.round(directRoadOption.duration),
          cost: directRoadOption.cost,
          co2: directRoadOption.co2,
          depTime: startTimeStr,
          arrTime: minToTime(startTimeMins + directRoadOption.duration)
        }
      ]
    };
  }

  return { success: false, error: 'No route found within parameters' };
}

// Helper to calculate duration, cost, co2 for road links
function calculateRoadEdge(distanceKm, mode = 'cab') {
  let speed = 50; // km/h
  let costPerKm = 15; // INR
  let baseWait = 5; // mins
  let co2PerKm = 0.12; // kg CO2

  if (mode === 'walk') {
    speed = 5;
    costPerKm = 0;
    baseWait = 0;
    co2PerKm = 0.0;
  } else if (mode === 'auto') {
    speed = 35;
    costPerKm = 10;
    baseWait = 3;
    co2PerKm = 0.08;
  } else if (mode === 'car') {
    speed = 60;
    costPerKm = 12;
    baseWait = 0;
    co2PerKm = 0.15;
  }

  const travelMins = (distanceKm / speed) * 60;
  const duration = travelMins + baseWait;
  const cost = distanceKm * costPerKm;
  const co2 = distanceKm * co2PerKm;

  return { duration, cost, co2 };
}

// Reconstruct path from target state
function reconstructPath(endState, startCoord, endCoord) {
  const steps = [];
  let curr = endState;

  while (curr.parent !== null) {
    const parentNode = allStops.find(s => s.id === curr.parent.nodeId) || startCoord;
    const currNode = allStops.find(s => s.id === curr.nodeId) || endCoord;

    steps.unshift({
      mode: curr.edgeType,
      detail: curr.edgeDetail,
      from: {
        id: parentNode.id || 'START',
        name: parentNode.name,
        lat: parentNode.lat,
        lon: parentNode.lon,
        city: parentNode.city || ''
      },
      to: {
        id: currNode.id || 'END',
        name: currNode.name,
        lat: currNode.lat,
        lon: currNode.lon,
        city: currNode.city || ''
      },
      duration: Math.round(curr.time - curr.parent.time),
      cost: Math.round(curr.cost - curr.parent.cost),
      co2: Math.round((curr.co2 - curr.parent.co2) * 10) / 10,
      depTime: minToTime(curr.parent.time),
      arrTime: minToTime(curr.time)
    });

    curr = curr.parent;
  }

  return {
    success: true,
    totalDuration: Math.round(endState.time - startTimeMinsOfState(endState)),
    totalCost: Math.round(endState.cost),
    totalCo2: Math.round(endState.co2 * 10) / 10,
    transfers: endState.transfers,
    path: steps
  };
}

function startTimeMinsOfState(state) {
  let root = state;
  while (root.parent !== null) {
    root = root.parent;
  }
  return root.time;
}

/**
 * GENERATE MULTIPLE ROUTE ALTERNATIVES
 * Returns 3-4 distinct route options with different transport mode combinations
 * @param {Object} startCoord { lat, lon, name }
 * @param {Object} endCoord { lat, lon, name }
 * @param {string} startTimeStr "HH:MM"
 * @returns {Array} Array of route options with different characteristics
 */
export function getMultipleRoutes(startCoord, endCoord, startTimeStr) {
  const routes = [];
  const startT = startTimeStr || '08:00';

  // OPTION 1: FASTEST (Flight if available, else fastest multi-modal)
  const fastestRoute = solveDijkstra(startCoord, endCoord, startT, 'fastest', []);
  if (fastestRoute.success) {
    routes.push({
      id: 'fastest',
      title: '⚡ Fastest Route',
      description: 'Prioritizes speed using flights when available',
      badge: 'Recommended',
      priority: 1,
      ...fastestRoute,
      pros: ['Saves time', 'Good for long distances', 'Comfortable'],
      cons: ['Most expensive', 'Higher emissions', 'Needs advance booking']
    });
  }

  // OPTION 2: BUDGET (Train & Bus preferred)
  const budgetRoute = solveDijkstra(startCoord, endCoord, startT, 'cheapest', ['flight']);
  if (budgetRoute.success && (!fastestRoute.success || 
      JSON.stringify(budgetRoute.path) !== JSON.stringify(fastestRoute.path))) {
    routes.push({
      id: 'budget',
      title: '💰 Budget Route',
      description: 'Most economical using trains and buses',
      badge: 'Cheapest',
      priority: 2,
      ...budgetRoute,
      pros: ['Most affordable', 'Good social experience', 'Scenic views'],
      cons: ['Takes longer', 'Multiple transfers', 'Limited comfort']
    });
  }

  // OPTION 3: ECO-FRIENDLY (Low carbon footprint)
  const ecoRoute = solveDijkstra(startCoord, endCoord, startT, 'eco', []);
  if (ecoRoute.success && !routes.some(r => 
      JSON.stringify(r.path) === JSON.stringify(ecoRoute.path))) {
    routes.push({
      id: 'eco',
      title: '🌱 Eco-Friendly Route',
      description: 'Minimizes carbon emissions',
      badge: 'Sustainable',
      priority: 3,
      ...ecoRoute,
      pros: ['Lowest emissions', 'Environmentally responsible', 'Cost-effective'],
      cons: ['May take longer', 'Limited high-speed options']
    });
  }

  // OPTION 4: BALANCED (No flight, prefer metro/train)
  const balancedRoute = solveDijkstra(startCoord, endCoord, startT, 'fastest', ['flight']);
  if (balancedRoute.success && !routes.some(r => 
      JSON.stringify(r.path) === JSON.stringify(balancedRoute.path))) {
    routes.push({
      id: 'balanced',
      title: '🚆 Rail & Transit Route',
      description: 'Uses trains and public transit without flights',
      badge: 'Scenic',
      priority: 4,
      ...balancedRoute,
      pros: ['No air travel', 'Reasonable price', 'Comfortable seating'],
      cons: ['Longer journey', 'Multiple transfers possible', 'Fixed schedules']
    });
  }

  // OPTION 5: COMFORT (Minimize transfers, maximize comfort)
  const comfortRoute = solveDijkstra(startCoord, endCoord, startT, 'fastest', []);
  if (comfortRoute.success && !routes.some(r => 
      r.transfers <= comfortRoute.transfers + 1 && Math.abs(r.totalDuration - comfortRoute.totalDuration) < 60)) {
    if (comfortRoute.transfers <= 2) {
      routes.push({
        id: 'comfort',
        title: '🛋️ Comfort Route',
        description: 'Minimizes transfers for maximum comfort',
        badge: 'Smooth',
        priority: 5,
        ...comfortRoute,
        pros: ['Few transfers', 'Maximum comfort', 'Shorter waiting times'],
        cons: ['May be pricier', 'Not always fastest']
      });
    }
  }

  // Sort by priority and return top 4
  return routes.slice(0, 4).sort((a, b) => a.priority - b.priority);
}

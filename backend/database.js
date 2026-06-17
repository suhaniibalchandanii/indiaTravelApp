import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'transit.db');

console.log(`Initializing database at ${dbPath}`);
const db = new DatabaseSync(dbPath);

// Create Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS stops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    type TEXT NOT NULL, -- 'metro', 'train', 'flight', 'bus', 'road'
    city TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL, -- 'metro', 'train', 'flight', 'bus', 'road'
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id TEXT,
    origin_id TEXT,
    destination_id TEXT,
    departure_time TEXT, -- "HH:MM"
    arrival_time TEXT,   -- "HH:MM"
    duration_minutes INTEGER NOT NULL,
    cost REAL NOT NULL,
    co2_emissions REAL NOT NULL, -- in kg CO2
    FOREIGN KEY(origin_id) REFERENCES stops(id),
    FOREIGN KEY(destination_id) REFERENCES stops(id),
    FOREIGN KEY(route_id) REFERENCES routes(id)
  );

  CREATE TABLE IF NOT EXISTS inter_modal_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stop_a TEXT NOT NULL,
    stop_b TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    cost REAL NOT NULL,
    FOREIGN KEY(stop_a) REFERENCES stops(id),
    FOREIGN KEY(stop_b) REFERENCES stops(id)
  );
`);

// Clear tables before inserting to avoid duplicates during dev reload
db.exec(`
  DELETE FROM schedules;
  DELETE FROM inter_modal_transfers;
  DELETE FROM routes;
  DELETE FROM stops;
`);

// 1. POPULATE STOPS
const insertStop = db.prepare(`
  INSERT INTO stops (id, name, lat, lon, type, city)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stopsList = [
  // AIRPORTS
  ['DEL_APT', 'IGI Airport Terminal 3 (DEL)', 28.5562, 77.1000, 'flight', 'Delhi'],
  ['BOM_APT', 'Chhatrapati Shivaji Maharaj Airport (BOM)', 19.0896, 72.8656, 'flight', 'Mumbai'],
  ['BLR_APT', 'Kempegowda International Airport (BLR)', 13.1986, 77.7066, 'flight', 'Bengaluru'],
  ['MAA_APT', 'Chennai International Airport (MAA)', 12.9941, 80.1709, 'flight', 'Chennai'],
  ['CCU_APT', 'Netaji Subhash Chandra Bose Airport (CCU)', 22.6547, 88.4467, 'flight', 'Kolkata'],

  // RAILWAY STATIONS
  ['NDLS_RLY', 'New Delhi Railway Station (NDLS)', 28.6430, 77.2223, 'train', 'Delhi'],
  ['NZM_RLY', 'Hazrat Nizamuddin Railway Station (NZM)', 28.5888, 77.2536, 'train', 'Delhi'],
  ['MMCT_RLY', 'Mumbai Central Railway Station (MMCT)', 18.9696, 72.8193, 'train', 'Mumbai'],
  ['BDTS_RLY', 'Bandra Terminus (BDTS)', 19.0624, 72.8403, 'train', 'Mumbai'],
  ['SBC_RLY', 'KSR Bengaluru City Railway Station (SBC)', 12.9781, 77.5697, 'train', 'Bengaluru'],
  ['YPR_RLY', 'Yesvantpur Junction (YPR)', 13.0245, 77.5484, 'train', 'Bengaluru'],
  ['MAS_RLY', 'MGR Chennai Central (MAS)', 13.0827, 80.2707, 'train', 'Chennai'],
  ['HWH_RLY', 'Howrah Junction (HWH)', 22.5835, 88.3424, 'train', 'Kolkata'],

  // DELHI METRO YELLOW LINE
  ['DL_MET_HUDA', 'Huda City Centre Metro', 28.4593, 77.0725, 'metro', 'Delhi'],
  ['DL_MET_IFFCO', 'IFFCO Chowk Metro', 28.4722, 77.0726, 'metro', 'Delhi'],
  ['DL_MET_QUTUB', 'Qutub Minar Metro', 28.5135, 77.1977, 'metro', 'Delhi'],
  ['DL_MET_HAUZ', 'Hauz Khas Metro', 28.5432, 77.2065, 'metro', 'Delhi'],
  ['DL_MET_INA', 'INA Metro (Dilli Haat)', 28.5750, 77.2091, 'metro', 'Delhi'],
  ['DL_MET_RC', 'Rajiv Chowk Metro (Connaught Place)', 28.6304, 77.2177, 'metro', 'Delhi'],
  ['DL_MET_NDLS', 'New Delhi Metro Station', 28.6425, 77.2215, 'metro', 'Delhi'],
  ['DL_MET_KG', 'Kashmere Gate Metro', 28.6675, 77.2282, 'metro', 'Delhi'],
  ['DL_MET_SAMP', 'Samaypur Badli Metro', 28.7455, 77.1375, 'metro', 'Delhi'],

  // DELHI METRO BLUE LINE
  ['DL_MET_DW21', 'Dwarka Sector 21 Metro', 28.5523, 77.0583, 'metro', 'Delhi'],
  ['DL_MET_DW10', 'Dwarka Sector 10 Metro', 28.5806, 77.0588, 'metro', 'Delhi'],
  ['DL_MET_KB', 'Karol Bagh Metro', 28.6441, 77.1878, 'metro', 'Delhi'],
  ['DL_MET_YB', 'Yamuna Bank Metro', 28.6213, 77.2655, 'metro', 'Delhi'],
  ['DL_MET_NX62', 'Noida Sector 62 Metro', 28.6225, 77.3585, 'metro', 'Delhi'],

  // DELHI METRO AIRPORT EXPRESS (ORANGE)
  ['DL_MET_APT', 'IGI Airport Metro (T3)', 28.5562, 77.0862, 'metro', 'Delhi'],

  // DELHI BUS STOPS
  ['DL_BUS_DWARKA_SEC10', 'Dwarka Sector 10 Bus Terminal', 28.5815, 77.0601, 'bus', 'Delhi'],
  ['DL_BUS_PALAM', 'Palam Village Bus Stop', 28.5839, 77.0934, 'bus', 'Delhi'],
  ['DL_BUS_CP', 'Connaught Place Bus Stop', 28.6310, 77.2195, 'bus', 'Delhi'],
  ['DL_BUS_MUNIRKA', 'Munirka Bus Stop', 28.5582, 77.1684, 'bus', 'Delhi'],

  // DELHI-MEERUT RAPID RAIL (RRTS)
  ['DL_RRTS_SKK', 'Sarai Kale Khan RRTS', 28.5898, 77.2582, 'metro', 'Delhi'], // Treated as metro for local/suburban transit
  ['DL_RRTS_GZB', 'Ghaziabad RRTS', 28.6517, 77.4250, 'metro', 'Delhi'],
  ['DL_RRTS_MEERUT', 'Meerut South RRTS', 28.9160, 77.6740, 'metro', 'Meerut'],

  // MUMBAI METRO / LOCAL
  ['BOM_LOC_CST', 'CSMT Suburban Terminal', 18.9400, 72.8353, 'metro', 'Mumbai'],
  ['BOM_LOC_DADAR', 'Dadar Suburban Station', 19.0178, 72.8428, 'metro', 'Mumbai'],
  ['BOM_LOC_BANDRA', 'Bandra Suburban Station', 19.0544, 72.8407, 'metro', 'Mumbai'],
  ['BOM_LOC_ANDHERI', 'Andheri Suburban Station', 19.1197, 72.8464, 'metro', 'Mumbai'],
  ['BOM_LOC_BORIVLI', 'Borivali Suburban Station', 19.2290, 72.8573, 'metro', 'Mumbai'],

  // BENGALURU METRO Purple/Green Lines
  ['BLR_MET_MAJESTIC', 'Majestic Interchange Metro', 12.9756, 77.5728, 'metro', 'Bengaluru'],
  ['BLR_MET_IND', 'Indiranagar Metro', 12.9784, 77.6387, 'metro', 'Bengaluru'],
  ['BLR_MET_ECITY', 'Electronic City Bus Stand', 12.8452, 77.6602, 'bus', 'Bengaluru'],
  ['BLR_MET_WHT', 'Whitefield Metro', 12.9698, 77.7500, 'metro', 'Bengaluru'],

  // POPULAR LANDMARKS (For first/last mile endpoints)
  ['DL_LM_CP', 'Connaught Place Landmark', 28.6304, 77.2177, 'road', 'Delhi'],
  ['DL_LM_TAJ', 'Taj Mahal (Agra)', 27.1751, 78.0421, 'road', 'Agra'],
  ['DL_LM_HAWA', 'Hawa Mahal (Jaipur)', 26.9239, 75.8267, 'road', 'Jaipur'],
  ['BOM_LM_GATEWAY', 'Gateway of India', 18.9220, 72.8347, 'road', 'Mumbai'],
  ['BOM_LM_BANDSTAND', 'Bandra Bandstand', 19.0522, 72.8258, 'road', 'Mumbai'],
  ['BLR_LM_CUBBON', 'Cubbon Park Landmark', 12.9738, 77.5906, 'road', 'Bengaluru'],

  // VELLORE (NEW - Important for the example)
  ['VLR_APT', 'Vellore Central Bus Stand', 12.9352, 79.1272, 'bus', 'Vellore'],
  ['VLR_RLY', 'Vellore Cantonment Railway Station', 12.9240, 79.1351, 'train', 'Vellore'],
  ['VLR_LM_FORT', 'Vellore Fort & City Centre', 12.9358, 79.1316, 'road', 'Vellore'],

  // EXTENDED CHENNAI STOPS
  ['MAA_BUS', 'Chennai Central Bus Terminal (Mofussil)', 13.0825, 80.2768, 'bus', 'Chennai'],
  ['MAA_LM_MARINA', 'Marina Beach (Chennai)', 13.0499, 80.2822, 'road', 'Chennai'],
  ['MAA_MET_CENTRAL', 'Chennai Central Metro', 13.0827, 80.2707, 'metro', 'Chennai'],

  // EXTENDED BANGALORE STOPS
  ['BLR_LM_MALL', 'Commercial Street, Bangalore', 12.9736, 77.6115, 'road', 'Bengaluru'],

  // JAMMU & KASHMIR - TIER 2 CITIES (NEW)
  ['JAM_APT', 'Jammu Airport (IXJ)', 32.7307, 75.1010, 'flight', 'Jammu'],
  ['JAM_RLY', 'Jammu Railway Station', 32.7268, 75.0947, 'train', 'Jammu'],
  ['JAM_LM_CITY', 'Jammu City Center', 32.7307, 75.0930, 'road', 'Jammu'],
  
  // LUCKNOW - TIER 2 CITIES (NEW)
  ['LKO_APT', 'Lucknow Airport (LKO)', 26.7606, 80.8942, 'flight', 'Lucknow'],
  ['LKO_RLY', 'Lucknow Central Railway Station', 26.8473, 80.9354, 'train', 'Lucknow'],
  ['LKO_LM_CITY', 'Lucknow City Center', 26.8469, 80.9460, 'road', 'Lucknow'],
  
  // AMRITSAR - TIER 2 CITIES (NEW)
  ['AMR_APT', 'Amritsar Airport (ATQ)', 31.7158, 74.8060, 'flight', 'Amritsar'],
  ['AMR_RLY', 'Amritsar Junction Railway Station', 31.6340, 74.8723, 'train', 'Amritsar'],
  ['AMR_LM_TEMPLE', 'Golden Temple, Amritsar', 31.6200, 74.8765, 'road', 'Amritsar'],
  
  // SRINAGAR - TIER 2 CITIES (NEW)
  ['SRI_APT', 'Srinagar Airport (SXR)', 34.0837, 75.3841, 'flight', 'Srinagar'],
  ['SRI_RLY', 'Srinagar Railway Station', 34.0836, 75.5702, 'train', 'Srinagar'],
  ['SRI_LM_DAL', 'Dal Lake, Srinagar', 34.1526, 75.5747, 'road', 'Srinagar'],

  // AGARTALA / TRIPURA (NEW)
  ['IXA_APT', 'Agartala Airport (IXA)', 23.8868, 91.2400, 'flight', 'Agartala'],
  ['IXA_RLY', 'Agartala Railway Station', 23.8375, 91.2766, 'train', 'Agartala'],
  ['IXA_LM_CITY', 'Agartala City Center', 23.8355, 91.2798, 'road', 'Agartala'],
  
  // HYDERABAD - TIER 2 CITIES (NEW)
  ['HYD_APT', 'Rajiv Gandhi International Airport (HYD)', 17.3732, 78.4697, 'flight', 'Hyderabad'],
  ['HYD_RLY', 'Secunderabad Railway Station (SC)', 17.3671, 78.5067, 'train', 'Hyderabad'],
  ['HYD_LM_CITY', 'Hyderabad City Center', 17.3850, 78.4867, 'road', 'Hyderabad'],
  
  // PUNE - TIER 2 CITIES (NEW)
  ['PNE_APT', 'Pune Airport (PNQ)', 18.5821, 73.9197, 'flight', 'Pune'],
  ['PNE_RLY', 'Pune Railway Station', 18.5244, 73.8447, 'train', 'Pune'],
  ['PNE_LM_CITY', 'Pune City Center', 18.5204, 73.8567, 'road', 'Pune'],
  
  // KOCHI - TIER 2 CITIES (NEW)
  ['KCH_APT', 'Kochi Airport (COK)', 10.1619, 76.4078, 'flight', 'Kochi'],
  ['KCH_RLY', 'Kochi Railway Station', 9.9674, 76.2427, 'train', 'Kochi'],
  ['KCH_LM_CITY', 'Kochi City Center', 9.9312, 76.2673, 'road', 'Kochi']
];

stopsList.forEach(s => insertStop.run(...s));


// 2. POPULATE ROUTES
const insertRoute = db.prepare(`
  INSERT INTO routes (id, name, mode, color)
  VALUES (?, ?, ?, ?)
`);

const routesList = [
  // Flight Routes
  ['INDIGO_AIR', 'IndiGo Flights', 'flight', '#1E3A8A'],
  ['AIRINDIA_AIR', 'Air India Flights', 'flight', '#B91C1C'],
  ['VISTARA_AIR', 'Vistara Flights', 'flight', '#5B21B6'],

  // Train Routes
  ['RAJDHANI_NDLS_BOM', 'NDLS-MMCT Rajdhani Express', 'train', '#DC2626'],
  ['SHATABDI_DEL_JPR', 'New Delhi-Jaipur Shatabdi', 'train', '#EA580C'],
  ['RAJDHANI_DEL_BLR', 'NDLS-SBC Rajdhani Express', 'train', '#DC2626'],
  ['EXPRESS_DEL_AGR', 'Taj Express (Delhi-Agra)', 'train', '#2563EB'],
  ['EXPRESS_BOM_BLR', 'Udyan Express (Mumbai-Bengaluru)', 'train', '#16A34A'],

  // Metro Lines Delhi
  ['DL_MET_YELLOW', 'Delhi Metro Yellow Line', 'metro', '#EAB308'],
  ['DL_MET_BLUE', 'Delhi Metro Blue Line', 'metro', '#3B82F6'],
  ['DL_MET_ORANGE', 'Delhi Metro Airport Express', 'metro', '#F97316'],

  // RRTS
  ['DL_RRTS_LINE', 'Delhi-Meerut RRTS Line', 'metro', '#8B5CF6'],

  // Mumbai Suburban
  ['BOM_SUB_WESTERN', 'Mumbai Western Local Line', 'metro', '#EC4899'],

  // Bengaluru Metro
  ['BLR_MET_PURPLE', 'Namma Metro Purple Line', 'metro', '#A855F7'],

  // Bus Lines
  ['DTC_BUS_428', 'DTC Bus Route 428', 'bus', '#10B981'],
  ['DTC_BUS_502', 'DTC Bus Route 502', 'bus', '#10B981'],
  ['BMTC_BUS_KIA9', 'BMTC Airport Shuttle KIA-9', 'bus', '#06B6D4'],

  // VELLORE ROUTES (NEW)
  ['EXPRESS_VLR_CHN', 'Vellore-Chennai Express Train', 'train', '#06B6D4'],
  ['EXPRESS_VLR_BNG', 'Vellore-Bangalore Express Bus', 'bus', '#10B981'],
  ['EXPRESS_CHN_BNG', 'Chennai-Bangalore Express', 'train', '#DC2626'],
  ['EXPRESS_BNG_DEL', 'Bangalore-Delhi Rajdhani', 'train', '#DC2626'],
  ['EXPRESS_CHN_DEL', 'Chennai-Delhi Express', 'train', '#2563EB'],
  
  // NEW ROUTES FOR TIER-2 CITIES
  ['FLIGHT_DEL_JAM', 'Delhi-Jammu Flight', 'flight', '#1E3A8A'],
  ['FLIGHT_JAM_DEL', 'Jammu-Delhi Flight', 'flight', '#1E3A8A'],
  ['FLIGHT_DEL_LKO', 'Delhi-Lucknow Flight', 'flight', '#B91C1C'],
  ['FLIGHT_LKO_DEL', 'Lucknow-Delhi Flight', 'flight', '#B91C1C'],
  ['FLIGHT_DEL_AMR', 'Delhi-Amritsar Flight', 'flight', '#5B21B6'],
  ['FLIGHT_AMR_DEL', 'Amritsar-Delhi Flight', 'flight', '#5B21B6'],
  ['FLIGHT_DEL_SRI', 'Delhi-Srinagar Flight', 'flight', '#0891B2'],
  ['FLIGHT_SRI_DEL', 'Srinagar-Delhi Flight', 'flight', '#0891B2'],
  ['FLIGHT_BLR_HYD', 'Bangalore-Hyderabad Flight', 'flight', '#EC4899'],
  ['FLIGHT_HYD_BLR', 'Hyderabad-Bangalore Flight', 'flight', '#EC4899'],
  ['FLIGHT_BOM_PNE', 'Mumbai-Pune Flight', 'flight', '#A855F7'],
  ['FLIGHT_PNE_BOM', 'Pune-Mumbai Flight', 'flight', '#A855F7'],
  ['FLIGHT_BLR_KCH', 'Bangalore-Kochi Flight', 'flight', '#06B6D4'],
  ['FLIGHT_KCH_BLR', 'Kochi-Bangalore Flight', 'flight', '#06B6D4'],
  
  // TRAIN ROUTES TO TIER-2 CITIES
  ['EXPRESS_DEL_JAM', 'Delhi-Jammu Express Train', 'train', '#DC2626'],
  ['EXPRESS_JAM_DEL', 'Jammu-Delhi Express Train', 'train', '#DC2626'],
  ['EXPRESS_DEL_LKO', 'Delhi-Lucknow Express', 'train', '#2563EB'],
  ['EXPRESS_LKO_DEL', 'Lucknow-Delhi Express', 'train', '#2563EB'],
  ['EXPRESS_DEL_AMR', 'Delhi-Amritsar Express', 'train', '#16A34A'],
  ['EXPRESS_AMR_DEL', 'Amritsar-Delhi Express', 'train', '#16A34A'],
  ['EXPRESS_BNG_HYD', 'Bangalore-Hyderabad Express', 'train', '#06B6D4'],
  ['EXPRESS_HYD_BNG', 'Hyderabad-Bangalore Express', 'train', '#06B6D4'],
  
  // FLIGHTS FROM MAJOR HUBS TO JAMMU
  ['FLIGHT_CHN_JAM', 'Chennai-Jammu Flight', 'flight', '#1E3A8A'],
  ['FLIGHT_JAM_CHN', 'Jammu-Chennai Flight', 'flight', '#1E3A8A'],
  ['FLIGHT_BLR_JAM', 'Bangalore-Jammu Flight', 'flight', '#B91C1C'],
  ['FLIGHT_JAM_BLR', 'Jammu-Bangalore Flight', 'flight', '#B91C1C'],
  
  // FLIGHTS CONNECTING TIER-2 CITIES TO SOUTH INDIA
  ['FLIGHT_LKO_CHN', 'Lucknow-Chennai Flight', 'flight', '#5B21B6'],
  ['FLIGHT_CHN_LKO', 'Chennai-Lucknow Flight', 'flight', '#5B21B6'],
  ['FLIGHT_AMR_BLR', 'Amritsar-Bangalore Flight', 'flight', '#0891B2'],
  ['FLIGHT_BLR_AMR', 'Bangalore-Amritsar Flight', 'flight', '#0891B2'],
  
  // FLIGHTS TO SRINAGAR FROM MAJOR CITIES
  ['FLIGHT_BOM_SRI', 'Mumbai-Srinagar Flight', 'flight', '#EC4899'],
  ['FLIGHT_SRI_BOM', 'Srinagar-Mumbai Flight', 'flight', '#EC4899'],
  ['FLIGHT_BLR_SRI', 'Bangalore-Srinagar Flight', 'flight', '#A855F7'],
  ['FLIGHT_SRI_BLR', 'Srinagar-Bangalore Flight', 'flight', '#A855F7'],
  
  // FLIGHTS TO KOCHI FROM MAJOR CITIES
  ['FLIGHT_DEL_KCH', 'Delhi-Kochi Flight', 'flight', '#06B6D4'],
  ['FLIGHT_KCH_DEL', 'Kochi-Delhi Flight', 'flight', '#06B6D4'],
  ['FLIGHT_HYD_KCH', 'Hyderabad-Kochi Flight', 'flight', '#10B981'],
  ['FLIGHT_KCH_HYD', 'Kochi-Hyderabad Flight', 'flight', '#10B981'],
  
  // FLIGHTS TO HYDERABAD FROM SOUTH INDIA
  ['FLIGHT_CHN_HYD', 'Chennai-Hyderabad Flight', 'flight', '#8B5CF6'],
  ['FLIGHT_HYD_CHN', 'Hyderabad-Chennai Flight', 'flight', '#8B5CF6'],
  
  // FLIGHTS TO/FROM PUNE
  ['FLIGHT_DEL_PNE', 'Delhi-Pune Flight', 'flight', '#06B6D4'],
  ['FLIGHT_PNE_DEL', 'Pune-Delhi Flight', 'flight', '#06B6D4'],
  ['FLIGHT_CHN_PNE', 'Chennai-Pune Flight', 'flight', '#EC4899'],
  ['FLIGHT_PNE_CHN', 'Pune-Chennai Flight', 'flight', '#EC4899'],
  
  ['FLIGHT_CHN_DEL', 'Chennai-Delhi Flight', 'flight', '#B91C1C'],
  ['FLIGHT_BNG_DEL', 'Bangalore-Delhi Flight', 'flight', '#1E3A8A'],
  ['FLIGHT_BNG_CHN', 'Bangalore-Chennai Flight', 'flight', '#5B21B6'],
  ['BUS_VLR_CHN', 'Vellore-Chennai Bus Route', 'bus', '#10B981'],
  ['BUS_CHN_BNG', 'Chennai-Bangalore Bus Route', 'bus', '#10B981']
];

routesList.forEach(r => insertRoute.run(...r));


// 3. POPULATE SCHEDULES (Transit Edges)
const insertSchedule = db.prepare(`
  INSERT INTO schedules (route_id, origin_id, destination_id, departure_time, arrival_time, duration_minutes, cost, co2_emissions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const schedulesList = [];

// --- FLIGHTS ---
// Delhi <-> Mumbai
const flightPairs = [
  ['DEL_APT', 'BOM_APT', 130, 4500, 150.0],
  ['BOM_APT', 'DEL_APT', 130, 4500, 150.0],
  // Delhi <-> Bengaluru
  ['DEL_APT', 'BLR_APT', 160, 5500, 180.0],
  ['BLR_APT', 'DEL_APT', 160, 5500, 180.0],
  // Mumbai <-> Bengaluru
  ['BOM_APT', 'BLR_APT', 100, 3800, 110.0],
  ['BLR_APT', 'BOM_APT', 100, 3800, 110.0],
  // VELLORE-CHENNAI flights (short hop)
  ['MAA_APT', 'BLR_APT', 80, 2800, 80.0],
  ['BLR_APT', 'MAA_APT', 80, 2800, 80.0],
  // CHENNAI <-> DELHI
  ['MAA_APT', 'DEL_APT', 180, 5200, 200.0],
  ['DEL_APT', 'MAA_APT', 180, 5200, 200.0],
  // BANGALORE <-> DELHI
  ['BLR_APT', 'DEL_APT', 160, 5500, 180.0],
  ['DEL_APT', 'BLR_APT', 160, 5500, 180.0],
  
  // *** NEW FLIGHTS TO TIER-2 CITIES ***
  // JAMMU FLIGHTS
  ['DEL_APT', 'JAM_APT', 90, 4200, 125.0],
  ['JAM_APT', 'DEL_APT', 90, 4200, 125.0],
  ['MAA_APT', 'JAM_APT', 200, 6500, 240.0],
  ['JAM_APT', 'MAA_APT', 200, 6500, 240.0],
  ['BLR_APT', 'JAM_APT', 180, 6200, 220.0],
  ['JAM_APT', 'BLR_APT', 180, 6200, 220.0],
  
  // LUCKNOW FLIGHTS
  ['DEL_APT', 'LKO_APT', 65, 3800, 100.0],
  ['LKO_APT', 'DEL_APT', 65, 3800, 100.0],
  ['BOM_APT', 'LKO_APT', 120, 4800, 160.0],
  ['LKO_APT', 'BOM_APT', 120, 4800, 160.0],
  ['BLR_APT', 'LKO_APT', 150, 5500, 190.0],
  ['LKO_APT', 'BLR_APT', 150, 5500, 190.0],
  
  // AMRITSAR FLIGHTS
  ['DEL_APT', 'AMR_APT', 75, 3600, 110.0],
  ['AMR_APT', 'DEL_APT', 75, 3600, 110.0],
  ['BOM_APT', 'AMR_APT', 140, 5200, 180.0],
  ['AMR_APT', 'BOM_APT', 140, 5200, 180.0],
  ['BLR_APT', 'AMR_APT', 170, 6000, 210.0],
  ['AMR_APT', 'BLR_APT', 170, 6000, 210.0],
  
  // SRINAGAR FLIGHTS
  ['DEL_APT', 'SRI_APT', 110, 4800, 140.0],
  ['SRI_APT', 'DEL_APT', 110, 4800, 140.0],
  ['BOM_APT', 'SRI_APT', 160, 5500, 170.0],
  ['SRI_APT', 'BOM_APT', 160, 5500, 170.0],
  ['BLR_APT', 'SRI_APT', 200, 6800, 240.0],
  ['SRI_APT', 'BLR_APT', 200, 6800, 240.0],
  
  // HYDERABAD FLIGHTS
  ['DEL_APT', 'HYD_APT', 140, 5000, 170.0],
  ['HYD_APT', 'DEL_APT', 140, 5000, 170.0],
  ['BOM_APT', 'HYD_APT', 100, 3900, 115.0],
  ['HYD_APT', 'BOM_APT', 100, 3900, 115.0],
  ['BLR_APT', 'HYD_APT', 90, 3500, 100.0],
  ['HYD_APT', 'BLR_APT', 90, 3500, 100.0],
  ['MAA_APT', 'HYD_APT', 80, 3200, 90.0],
  ['HYD_APT', 'MAA_APT', 80, 3200, 90.0],
  
  // PUNE FLIGHTS
  ['DEL_APT', 'PNE_APT', 130, 4700, 160.0],
  ['PNE_APT', 'DEL_APT', 130, 4700, 160.0],
  ['BOM_APT', 'PNE_APT', 50, 2500, 60.0],
  ['PNE_APT', 'BOM_APT', 50, 2500, 60.0],
  ['BLR_APT', 'PNE_APT', 100, 3800, 110.0],
  ['PNE_APT', 'BLR_APT', 100, 3800, 110.0],
  
  // KOCHI FLIGHTS
  ['DEL_APT', 'KCH_APT', 200, 6000, 240.0],
  ['KCH_APT', 'DEL_APT', 200, 6000, 240.0],
  ['BOM_APT', 'KCH_APT', 120, 4200, 150.0],
  ['KCH_APT', 'BOM_APT', 120, 4200, 150.0],
  ['BLR_APT', 'KCH_APT', 70, 2800, 75.0],
  ['KCH_APT', 'BLR_APT', 70, 2800, 75.0],
  ['HYD_APT', 'KCH_APT', 100, 3500, 115.0],
  ['KCH_APT', 'HYD_APT', 100, 3500, 115.0]
];

const airlines = ['INDIGO_AIR', 'AIRINDIA_AIR', 'VISTARA_AIR'];
const times = [
  ['06:00', '08:10'],
  ['09:30', '11:40'],
  ['13:00', '15:10'],
  ['16:30', '18:40'],
  ['20:00', '22:10'],
  ['22:30', '00:40']
];

flightPairs.forEach(([orig, dest, duration, baseCost, co2]) => {
  airlines.forEach((airline, airlineIdx) => {
    // Add flight schedules with slightly varied prices and times
    times.forEach(([dep, arr], timeIdx) => {
      // Vary cost by airline and time
      const finalCost = baseCost + (airlineIdx * 800) + (timeIdx % 2 === 0 ? 500 : 0);
      
      // Compute arrival time based on duration
      const [depH, depM] = dep.split(':').map(Number);
      let arrH = (depH + Math.floor((depM + duration) / 60)) % 24;
      let arrM = (depM + duration) % 60;
      const arrStr = `${String(arrH).padStart(2, '0')}:${String(arrM).padStart(2, '0')}`;

      schedulesList.push([
        airline,
        orig,
        dest,
        dep,
        arrStr,
        duration,
        finalCost,
        co2
      ]);
    });
  });
});

// --- NEW FLIGHT PAIRS: DELHI <-> AGARTALA (TRIPURA) ---
flightPairs.push(
  ['DEL_APT', 'IXA_APT', 160, 5200, 140.0],
  ['IXA_APT', 'DEL_APT', 160, 5200, 140.0]
);

// --- TRAINS ---
// NDLS <-> MMCT (Rajdhani Express)
schedulesList.push(
  ['RAJDHANI_NDLS_BOM', 'NDLS_RLY', 'MMCT_RLY', '16:55', '08:35', 940, 2400, 32.5],
  ['RAJDHANI_NDLS_BOM', 'MMCT_RLY', 'NDLS_RLY', '17:00', '08:50', 950, 2400, 32.5],
  // NDLS <-> SBC (Rajdhani Bengaluru)
  ['RAJDHANI_DEL_BLR', 'NDLS_RLY', 'SBC_RLY', '20:10', '05:20', 2010, 3100, 68.0], // ~33 hrs (overnight + next day)
  ['RAJDHANI_DEL_BLR', 'SBC_RLY', 'NDLS_RLY', '20:00', '05:55', 2035, 3100, 68.0],
  // Delhi <-> Jaipur (Shatabdi)
  ['SHATABDI_DEL_JPR', 'NDLS_RLY', 'DL_LM_HAWA', '06:10', '10:50', 280, 850, 11.2],
  ['SHATABDI_DEL_JPR', 'DL_LM_HAWA', 'NDLS_RLY', '17:50', '22:30', 280, 850, 11.2],
  // Delhi <-> Agra (Taj Express)
  ['EXPRESS_DEL_AGR', 'NDLS_RLY', 'DL_LM_TAJ', '06:55', '09:50', 175, 450, 6.0],
  ['EXPRESS_DEL_AGR', 'DL_LM_TAJ', 'NDLS_RLY', '18:50', '21:50', 180, 450, 6.0],

  // --- VELLORE-CHENNAI TRAINS ---
  // Vellore Cantonment to Chennai Central (Express train, ~2.5 hours)
  ['EXPRESS_VLR_CHN', 'VLR_RLY', 'MAS_RLY', '06:15', '08:45', 150, 400, 5.0],
  ['EXPRESS_VLR_CHN', 'VLR_RLY', 'MAS_RLY', '09:30', '12:00', 150, 400, 5.0],
  ['EXPRESS_VLR_CHN', 'VLR_RLY', 'MAS_RLY', '14:00', '16:30', 150, 400, 5.0],
  ['EXPRESS_VLR_CHN', 'VLR_RLY', 'MAS_RLY', '18:45', '21:15', 150, 400, 5.0],
  ['EXPRESS_VLR_CHN', 'MAS_RLY', 'VLR_RLY', '05:00', '07:30', 150, 400, 5.0],
  ['EXPRESS_VLR_CHN', 'MAS_RLY', 'VLR_RLY', '10:15', '12:45', 150, 400, 5.0],
  ['EXPRESS_VLR_CHN', 'MAS_RLY', 'VLR_RLY', '15:30', '18:00', 150, 400, 5.0],
  ['EXPRESS_VLR_CHN', 'MAS_RLY', 'VLR_RLY', '20:00', '22:30', 150, 400, 5.0],

  // --- CHENNAI-BANGALORE EXPRESS ---
  // Chennai to Bangalore (~6 hours by train)
  ['EXPRESS_CHN_BNG', 'MAS_RLY', 'SBC_RLY', '20:00', '02:00', 360, 1200, 25.0],
  ['EXPRESS_CHN_BNG', 'SBC_RLY', 'MAS_RLY', '22:00', '04:00', 360, 1200, 25.0],

  // --- BANGALORE-DELHI RAJDHANI ---
  // Already defined above (NDLS-SBC Rajdhani)

  // --- CHENNAI-DELHI EXPRESS (Overnight train) ---
  ['EXPRESS_CHN_DEL', 'MAS_RLY', 'NDLS_RLY', '21:00', '04:30+1', 1470, 2800, 50.0],
  ['EXPRESS_CHN_DEL', 'NDLS_RLY', 'MAS_RLY', '20:30', '05:00+1', 1470, 2800, 50.0],
  
  // --- JAMMU TRAINS ---
  // Delhi-Jammu Express (~8-9 hours by train)
  ['EXPRESS_DEL_JAM', 'NDLS_RLY', 'JAM_RLY', '18:00', '02:30+1', 510, 1800, 35.0],
  ['EXPRESS_DEL_JAM', 'NDLS_RLY', 'JAM_RLY', '20:15', '05:00+1', 525, 1800, 35.0],
  ['EXPRESS_JAM_DEL', 'JAM_RLY', 'NDLS_RLY', '06:30', '15:00', 510, 1800, 35.0],
  ['EXPRESS_JAM_DEL', 'JAM_RLY', 'NDLS_RLY', '07:45', '16:15', 510, 1800, 35.0],
  
  // --- LUCKNOW TRAINS ---
  // Delhi-Lucknow Express (~7-8 hours)
  ['EXPRESS_DEL_LKO', 'NDLS_RLY', 'LKO_RLY', '06:30', '14:00', 450, 1400, 30.0],
  ['EXPRESS_DEL_LKO', 'NDLS_RLY', 'LKO_RLY', '14:15', '21:45', 450, 1400, 30.0],
  ['EXPRESS_LKO_DEL', 'LKO_RLY', 'NDLS_RLY', '07:00', '14:30', 450, 1400, 30.0],
  ['EXPRESS_LKO_DEL', 'LKO_RLY', 'NDLS_RLY', '15:30', '23:00', 450, 1400, 30.0],
  
  // --- AMRITSAR TRAINS ---
  // Delhi-Amritsar Express (~5-6 hours)
  ['EXPRESS_DEL_AMR', 'NDLS_RLY', 'AMR_RLY', '08:15', '14:30', 315, 1100, 20.0],
  ['EXPRESS_DEL_AMR', 'NDLS_RLY', 'AMR_RLY', '16:45', '23:00', 315, 1100, 20.0],
  ['EXPRESS_AMR_DEL', 'AMR_RLY', 'NDLS_RLY', '06:00', '12:15', 315, 1100, 20.0],
  ['EXPRESS_AMR_DEL', 'AMR_RLY', 'NDLS_RLY', '17:30', '23:45', 315, 1100, 20.0],
  
  // --- HYDERABAD TRAINS ---
  // Bangalore-Hyderabad Express (~8 hours)
  ['EXPRESS_BNG_HYD', 'SBC_RLY', 'HYD_RLY', '20:00', '04:00+1', 480, 1600, 32.0],
  ['EXPRESS_BNG_HYD', 'SBC_RLY', 'HYD_RLY', '22:30', '06:30+1', 480, 1600, 32.0],
  ['EXPRESS_HYD_BNG', 'HYD_RLY', 'SBC_RLY', '19:00', '03:00+1', 480, 1600, 32.0],
  ['EXPRESS_HYD_BNG', 'HYD_RLY', 'SBC_RLY', '21:15', '05:15+1', 480, 1600, 32.0]
);

// --- DELHI METRO (Frequent - every 5-10 minutes. Mock multiple runs)
const metroRuns = [
  // Yellow Line (HUDA <-> Samaypur Badli)
  {
    route: 'DL_MET_YELLOW',
    stops: ['DL_MET_HUDA', 'DL_MET_IFFCO', 'DL_MET_QUTUB', 'DL_MET_HAUZ', 'DL_MET_INA', 'DL_MET_RC', 'DL_MET_NDLS', 'DL_MET_KG', 'DL_MET_SAMP'],
    stopTimes: [0, 5, 12, 6, 8, 10, 5, 8, 15], // time from previous stop in minutes
    baseCost: 10 // increase by 5 per stop
  },
  // Blue Line (Dwarka Sec 21 <-> Noida Sec 62)
  {
    route: 'DL_MET_BLUE',
    stops: ['DL_MET_DW21', 'DL_MET_DW10', 'DL_MET_KB', 'DL_MET_RC', 'DL_MET_YB', 'DL_MET_NX62'],
    stopTimes: [0, 6, 25, 8, 10, 20],
    baseCost: 10
  },
  // Airport Express (NDLS <-> Dwarka Sec 21 via IGI Airport)
  {
    route: 'DL_MET_ORANGE',
    stops: ['DL_MET_NDLS', 'DL_MET_APT', 'DL_MET_DW21'],
    stopTimes: [0, 18, 5],
    baseCost: 60 // Special flat pricing
  }
];

// Generate frequent departures for Metro (every 10 minutes from 06:00 to 23:00)
for (let hour = 6; hour <= 23; hour++) {
  for (let min = 0; min < 60; min += 10) {
    const depTimeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    
    metroRuns.forEach(run => {
      // Forward direction
      let currentHour = hour;
      let currentMin = min;
      
      for (let i = 0; i < run.stops.length - 1; i++) {
        const origin = run.stops[i];
        const dest = run.stops[i+1];
        const duration = run.stopTimes[i+1];
        const cost = run.route === 'DL_MET_ORANGE' ? 60 : (10 + (i * 5));
        
        const depStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
        
        currentMin += duration;
        if (currentMin >= 60) {
          currentHour = (currentHour + Math.floor(currentMin / 60)) % 24;
          currentMin %= 60;
        }
        
        const arrStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
        
        schedulesList.push([run.route, origin, dest, depStr, arrStr, duration, cost, 0.1]);
      }
      
      // Backward direction
      let bCurrentHour = hour;
      let bCurrentMin = min;
      
      for (let i = run.stops.length - 1; i > 0; i--) {
        const origin = run.stops[i];
        const dest = run.stops[i-1];
        const duration = run.stopTimes[i];
        const cost = run.route === 'DL_MET_ORANGE' ? 60 : (10 + ((run.stops.length - 1 - i) * 5));
        
        const depStr = `${String(bCurrentHour).padStart(2, '0')}:${String(bCurrentMin).padStart(2, '0')}`;
        
        bCurrentMin += duration;
        if (bCurrentMin >= 60) {
          bCurrentHour = (bCurrentHour + Math.floor(bCurrentMin / 60)) % 24;
          bCurrentMin %= 60;
        }
        
        const arrStr = `${String(bCurrentHour).padStart(2, '0')}:${String(bCurrentMin).padStart(2, '0')}`;
        
        schedulesList.push([run.route, origin, dest, depStr, arrStr, duration, cost, 0.1]);
      }
    });
  }
}

// --- DELHI-MEERUT RRTS (Rapid Rail - every 15 mins)
for (let hour = 6; hour <= 22; hour++) {
  for (let min = 0; min < 60; min += 15) {
    const depStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    
    // SKK -> GZB -> Meerut (20 mins SKK->GZB, 25 mins GZB->Meerut)
    let h1 = hour, m1 = min + 20;
    if (m1 >= 60) { h1 = (h1 + 1) % 24; m1 -= 60; }
    const arrGzbStr = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
    
    let h2 = h1, m2 = m1 + 25;
    if (m2 >= 60) { h2 = (h2 + 1) % 24; m2 -= 60; }
    const arrMeerutStr = `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;

    schedulesList.push(
      ['DL_RRTS_LINE', 'DL_RRTS_SKK', 'DL_RRTS_GZB', depStr, arrGzbStr, 20, 50, 0.2],
      ['DL_RRTS_LINE', 'DL_RRTS_GZB', 'DL_RRTS_MEERUT', arrGzbStr, arrMeerutStr, 25, 70, 0.3],
      
      // Reverse
      ['DL_RRTS_LINE', 'DL_RRTS_MEERUT', 'DL_RRTS_GZB', depStr, arrGzbStr, 25, 70, 0.3],
      ['DL_RRTS_LINE', 'DL_RRTS_GZB', 'DL_RRTS_SKK', arrGzbStr, arrMeerutStr, 20, 50, 0.2]
    );
  }
}

// --- MUMBAI LOCAL TRAINS (Western Line Churchgate <-> Borivali, every 10 mins)
const bomStops = ['BOM_LOC_CST', 'BOM_LOC_DADAR', 'BOM_LOC_BANDRA', 'BOM_LOC_ANDHERI', 'BOM_LOC_BORIVLI'];
const bomStopTimes = [0, 15, 10, 12, 18]; // CST -> Dadar (15), Dadar -> Bandra (10), Bandra -> Andheri (12), Andheri -> Borivali (18)

for (let hour = 5; hour <= 23; hour++) {
  for (let min = 0; min < 60; min += 10) {
    let currentHour = hour;
    let currentMin = min;
    
    for (let i = 0; i < bomStops.length - 1; i++) {
      const orig = bomStops[i];
      const dest = bomStops[i+1];
      const duration = bomStopTimes[i+1];
      
      const depStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
      currentMin += duration;
      if (currentMin >= 60) { currentHour = (currentHour + 1) % 24; currentMin -= 60; }
      const arrStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
      
      schedulesList.push(['BOM_SUB_WESTERN', orig, dest, depStr, arrStr, duration, 15, 0.05]);
      schedulesList.push(['BOM_SUB_WESTERN', dest, orig, depStr, arrStr, duration, 15, 0.05]); // Reverse
    }
  }
}

// --- BENGALURU METRO Purple Line (Majestic <-> Indiranagar <-> Whitefield, every 10 mins)
const blrStops = ['BLR_MET_MAJESTIC', 'BLR_MET_IND', 'BLR_MET_WHT'];
const blrStopTimes = [0, 12, 20]; // Majestic -> Indiranagar (12), Indiranagar -> Whitefield (20)

for (let hour = 6; hour <= 22; hour++) {
  for (let min = 0; min < 60; min += 10) {
    let currentHour = hour;
    let currentMin = min;
    
    for (let i = 0; i < blrStops.length - 1; i++) {
      const orig = blrStops[i];
      const dest = blrStops[i+1];
      const duration = blrStopTimes[i+1];
      
      const depStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
      currentMin += duration;
      if (currentMin >= 60) { currentHour = (currentHour + 1) % 24; currentMin -= 60; }
      const arrStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
      
      schedulesList.push(['BLR_MET_PURPLE', orig, dest, depStr, arrStr, duration, 25, 0.05]);
      schedulesList.push(['BLR_MET_PURPLE', dest, orig, depStr, arrStr, duration, 25, 0.05]); // Reverse
    }
  }
}

// --- BUSES (DTC and BMTC Airport Bus)
// DTC 428: Dwarka Sector 10 Metro <-> Dwarka Sector 10 Bus Terminal (connecting short mile, 3 mins)
// DTC 502: Saket/Munirka area -> INA (Munirka Bus Stop -> INA Metro, every 15 mins)
for (let hour = 6; hour <= 21; hour++) {
  for (let min = 0; min < 60; min += 15) {
    const depStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    let arrMin = (min + 15) % 60;
    let arrHour = min + 15 >= 60 ? (hour + 1) % 24 : hour;
    const arrStr = `${String(arrHour).padStart(2, '0')}:${String(arrMin).padStart(2, '0')}`;
    
    schedulesList.push(
      ['DTC_BUS_502', 'DL_BUS_MUNIRKA', 'DL_MET_INA', depStr, arrStr, 15, 10, 0.3],
      ['DTC_BUS_502', 'DL_MET_INA', 'DL_BUS_MUNIRKA', depStr, arrStr, 15, 10, 0.3]
    );
  }
}

// BMTC KIA-9 Airport shuttle: SBC Railway Station (Majestic) <-> BLR Airport (Every 30 mins, duration 60 mins, cost 250)
for (let hour = 4; hour <= 23; hour++) {
  for (let min = 0; min < 60; min += 30) {
    const depStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const arrHour = (hour + 1) % 24;
    const arrStr = `${String(arrHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    
    schedulesList.push(
      ['BMTC_BUS_KIA9', 'SBC_RLY', 'BLR_APT', depStr, arrStr, 60, 250, 1.5],
      ['BMTC_BUS_KIA9', 'BLR_APT', 'SBC_RLY', depStr, arrStr, 60, 250, 1.5]
    );
  }
}

// --- VELLORE-CHENNAI BUS ---
// Frequent bus service (every hour, ~2.5 hours journey)
for (let hour = 5; hour <= 22; hour++) {
  const depStr = `${String(hour).padStart(2, '0')}:00`;
  let arrHour = (hour + 2) % 24;
  let arrMin = 30;
  const arrStr = `${String(arrHour).padStart(2, '0')}:${String(arrMin).padStart(2, '0')}`;
  
  schedulesList.push(
    ['BUS_VLR_CHN', 'VLR_APT', 'MAA_BUS', depStr, arrStr, 150, 350, 8.0],
    ['BUS_VLR_CHN', 'MAA_BUS', 'VLR_APT', depStr, arrStr, 150, 350, 8.0]
  );
}

// --- CHENNAI-BANGALORE BUS ---
// Frequent bus service (every 2 hours, ~5 hours journey)
for (let hour = 5; hour <= 22; hour += 2) {
  const depStr = `${String(hour).padStart(2, '0')}:00`;
  let arrHour = (hour + 5) % 24;
  const arrStr = `${String(arrHour).padStart(2, '0')}:00`;
  
  schedulesList.push(
    ['BUS_CHN_BNG', 'MAA_BUS', 'BLR_MET_ECITY', depStr, arrStr, 300, 800, 18.0],
    ['BUS_CHN_BNG', 'BLR_MET_ECITY', 'MAA_BUS', depStr, arrStr, 300, 800, 18.0]
  );
}

// --- VELLORE-BANGALORE BUS ---
// Direct bus service (every 3 hours, ~7 hours journey)
for (let hour = 5; hour <= 21; hour += 3) {
  const depStr = `${String(hour).padStart(2, '0')}:00`;
  let arrHour = (hour + 7) % 24;
  const arrStr = `${String(arrHour).padStart(2, '0')}:00`;
  
  schedulesList.push(
    ['EXPRESS_VLR_BNG', 'VLR_APT', 'BLR_MET_ECITY', depStr, arrStr, 420, 1100, 25.0],
    ['EXPRESS_VLR_BNG', 'BLR_MET_ECITY', 'VLR_APT', depStr, arrStr, 420, 1100, 25.0]
  );
}

schedulesList.forEach(sch => insertSchedule.run(...sch));

// --- Manually add Delhi <-> Agartala flight schedules (if not generated earlier) ---
// These provide direct flight options for the solver to use when Tripura is requested.
const manualAgartalaFlights = [
  ['INDIGO_AIR', 'DEL_APT', 'IXA_APT', '09:00', '11:40', 160, 5200, 140.0],
  ['INDIGO_AIR', 'IXA_APT', 'DEL_APT', '13:00', '15:40', 160, 5200, 140.0],
  ['AIRINDIA_AIR', 'DEL_APT', 'IXA_APT', '14:00', '16:40', 160, 6000, 140.0],
  ['VISTARA_AIR', 'DEL_APT', 'IXA_APT', '19:00', '21:40', 160, 5800, 140.0]
];

manualAgartalaFlights.forEach(f => insertSchedule.run(...f));


// 4. POPULATE TRANSFERS (E.g. walking between adjacent Metro stations and Railway terminals)
const insertTransfer = db.prepare(`
  INSERT INTO inter_modal_transfers (stop_a, stop_b, duration_minutes, cost)
  VALUES (?, ?, ?, ?)
`);

const transfersList = [
  // Delhi Metro NDLS <-> NDLS Railway Station (Walk 5 mins)
  ['DL_MET_NDLS', 'NDLS_RLY', 5, 0],
  ['NDLS_RLY', 'DL_MET_NDLS', 5, 0],

  // Hazrat Nizamuddin Railway <-> Sarai Kale Khan RRTS (Walk 6 mins)
  ['NZM_RLY', 'DL_RRTS_SKK', 6, 0],
  ['DL_RRTS_SKK', 'NZM_RLY', 6, 0],

  // IGI Airport T3 (DEL_APT) <-> IGI Airport Metro (DL_MET_APT) (Walk 4 mins)
  ['DEL_APT', 'DL_MET_APT', 4, 0],
  ['DL_MET_APT', 'DEL_APT', 4, 0],

  // Mumbai Central Railway (MMCT_RLY) <-> Mumbai Central Local (BOM_LOC_CST/DADAR/etc. - wait, MMCT is Western Local)
  // Let's connect MMCT Railway Station to Mumbai Central Western Local stop (BOM_LOC_DADAR? No, BOM_LOC_CST or Dadar. Let's make a transfer from MMCT to Dadar via local train? No, they are geographically separated. Mumbai Central local is MMCT. Let's add a transfer MMCT Railway <-> Dadar: we can do a road or train. Let's add transfer MMCT_RLY to BOM_LOC_DADAR (taxi 12 mins, ₹120)
  ['MMCT_RLY', 'BOM_LOC_DADAR', 12, 120],
  ['BOM_LOC_DADAR', 'MMCT_RLY', 12, 120],

  // Bandra Terminus (BDTS) <-> Bandra Suburban Station (BOM_LOC_BANDRA) (Auto 8 mins, ₹40)
  ['BDTS_RLY', 'BOM_LOC_BANDRA', 8, 40],
  ['BOM_LOC_BANDRA', 'BDTS_RLY', 8, 40],

  // SBC Railway Station <-> Majestic Interchange Metro (Walk 4 mins)
  ['SBC_RLY', 'BLR_MET_MAJESTIC', 4, 0],
  ['BLR_MET_MAJESTIC', 'SBC_RLY', 4, 0],

  // Dwarka Sec 10 Bus terminal <-> Dwarka Sec 10 Metro (Walk 2 mins)
  ['DL_BUS_DWARKA_SEC10', 'DL_MET_DW10', 2, 0],
  ['DL_MET_DW10', 'DL_BUS_DWARKA_SEC10', 2, 0],

  // Connaught Place Bus <-> Rajiv Chowk Metro (Walk 3 mins)
  ['DL_BUS_CP', 'DL_MET_RC', 3, 0],
  ['DL_MET_RC', 'DL_BUS_CP', 3, 0],

  // --- VELLORE TRANSFERS ---
  // Vellore Railway Station <-> Bus Terminal (Auto 10 mins, ₹30)
  ['VLR_RLY', 'VLR_APT', 10, 30],
  ['VLR_APT', 'VLR_RLY', 10, 30],

  // Vellore Bus Terminal <-> City Centre (Auto 8 mins, ₹20)
  ['VLR_APT', 'VLR_LM_FORT', 8, 20],
  ['VLR_LM_FORT', 'VLR_APT', 8, 20],

  // --- CHENNAI TRANSFERS ---
  // Chennai Railway Station <-> Bus Terminal (Auto 12 mins, ₹40)
  ['MAS_RLY', 'MAA_BUS', 12, 40],
  ['MAA_BUS', 'MAS_RLY', 12, 40],

  // Chennai Airport <-> Railway Station (Taxi 25 mins, ₹200)
  ['MAA_APT', 'MAS_RLY', 25, 200],
  ['MAS_RLY', 'MAA_APT', 25, 200],

  // --- BANGALORE TRANSFERS ---
  // SBC Railway <-> BMTC Bus Terminal (Walk 4 mins)
  ['SBC_RLY', 'BLR_MET_ECITY', 4, 0],
  ['BLR_MET_ECITY', 'SBC_RLY', 4, 0],
  
  // --- NEW TIER-2 CITY TRANSFERS ---
  // Jammu Airport <-> Jammu Railway (Cab 15 mins, ₹300)
  ['JAM_APT', 'JAM_RLY', 15, 300],
  ['JAM_RLY', 'JAM_APT', 15, 300],
  // Jammu Railway <-> City Center (Walk 8 mins)
  ['JAM_RLY', 'JAM_LM_CITY', 8, 0],
  ['JAM_LM_CITY', 'JAM_RLY', 8, 0],
  
  // Lucknow Airport <-> Railway (Cab 20 mins, ₹350)
  ['LKO_APT', 'LKO_RLY', 20, 350],
  ['LKO_RLY', 'LKO_APT', 20, 350],
  ['LKO_RLY', 'LKO_LM_CITY', 6, 0],
  ['LKO_LM_CITY', 'LKO_RLY', 6, 0],
  
  // Amritsar Airport <-> Railway (Cab 18 mins, ₹320)
  ['AMR_APT', 'AMR_RLY', 18, 320],
  ['AMR_RLY', 'AMR_APT', 18, 320],
  ['AMR_RLY', 'AMR_LM_TEMPLE', 10, 0],
  ['AMR_LM_TEMPLE', 'AMR_RLY', 10, 0],
  
  // Srinagar Airport <-> Railway (Cab 25 mins, ₹400)
  ['SRI_APT', 'SRI_RLY', 25, 400],
  ['SRI_RLY', 'SRI_APT', 25, 400],
  ['SRI_RLY', 'SRI_LM_DAL', 12, 0],
  ['SRI_LM_DAL', 'SRI_RLY', 12, 0],

  // AGARTALA TRANSFERS
  // Agartala Airport <-> Railway (Cab 20 mins, ₹300)
  ['IXA_APT', 'IXA_RLY', 20, 300],
  ['IXA_RLY', 'IXA_APT', 20, 300],
  ['IXA_RLY', 'IXA_LM_CITY', 8, 0],
  ['IXA_LM_CITY', 'IXA_RLY', 8, 0],
  ['IXA_APT', 'IXA_LM_CITY', 25, 350],
  ['IXA_LM_CITY', 'IXA_APT', 25, 350],
  
  // Hyderabad Airport <-> Railway (Cab 20 mins, ₹350)
  ['HYD_APT', 'HYD_RLY', 20, 350],
  ['HYD_RLY', 'HYD_APT', 20, 350],
  ['HYD_RLY', 'HYD_LM_CITY', 7, 0],
  ['HYD_LM_CITY', 'HYD_RLY', 7, 0],
  
  // Pune Airport <-> Railway (Cab 15 mins, ₹280)
  ['PNE_APT', 'PNE_RLY', 15, 280],
  ['PNE_RLY', 'PNE_APT', 15, 280],
  ['PNE_RLY', 'PNE_LM_CITY', 5, 0],
  ['PNE_LM_CITY', 'PNE_RLY', 5, 0],
  
  // Kochi Airport <-> Railway (Cab 22 mins, ₹400)
  ['KCH_APT', 'KCH_RLY', 22, 400],
  ['KCH_RLY', 'KCH_APT', 22, 400],
  ['KCH_RLY', 'KCH_LM_CITY', 6, 0],
  ['KCH_LM_CITY', 'KCH_RLY', 6, 0]
];

transfersList.forEach(t => insertTransfer.run(...t));

console.log('Database initialized successfully with curated datasets.');

// Export db instance
export { db };

import { solveDijkstra } from './routing.js';

const start = { name: 'New Delhi Center', lat: 28.6139, lon: 77.2090 };
const end = { name: 'Agartala, Tripura', lat: 23.8355, lon: 91.2798 };
const startTime = '08:00';

console.log('=== DELHI -> AGARTALA (fastest) ===');
const res = solveDijkstra(start, end, startTime, 'fastest');
console.log(JSON.stringify(res, null, 2));

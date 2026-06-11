import { solveDijkstra } from './routing.js';

const start = { name: "Dwarka Sector 10 Landmark", lat: 28.5800, lon: 77.0580 };
const end = { name: "Gateway of India, Mumbai", lat: 18.9220, lon: 72.8347 };
const startTime = "08:00";

console.log("=== RUNNING FASTEST PREFERENCE ===");
const resFast = solveDijkstra(start, end, startTime, 'fastest');
console.log(JSON.stringify(resFast, null, 2));

console.log("\n=== RUNNING CHEAPEST PREFERENCE (Excluding Flights) ===");
const resCheap = solveDijkstra(start, end, startTime, 'cheapest', ['flight']);
console.log(JSON.stringify(resCheap, null, 2));

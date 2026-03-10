import { computeDesignZones } from "./zone-computer";

console.log("TEST STARTED");

const zones = computeDesignZones({
  wallWidthIn: 120,
  ceilingHeightIn: 96,
  returnWalls: [
    { side: "left", depthIn: 6, clearanceIn: 2 },
    { side: "right", depthIn: 6, clearanceIn: 2 },
  ],
  doorOpenings: [
    { positionFromLeftIn: 52, widthIn: 8 },
  ],
  obstacles: [],
});

console.log("Generated Zones:");
console.log(JSON.stringify(zones, null, 2));
console.log("TEST FINISHED");
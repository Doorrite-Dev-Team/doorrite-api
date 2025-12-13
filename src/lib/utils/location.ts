import turf from "@turf/turf";

export function getDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  // 1. Create Turf points
  const from = turf.point([lon1, lat1]);
  const to = turf.point([lon2, lat2]);

  // 2. Calculate distance in kilometers (default unit, can change to 'miles')
  return turf.distance(from, to, { units: "kilometers" });
}

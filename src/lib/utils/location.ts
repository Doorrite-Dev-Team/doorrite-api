import * as turf from "@turf/turf";
import { GEOAPIFY_API_KEY } from "@config/env";

export function getDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const from = turf.point([lon1, lat1]);
  const to = turf.point([lon2, lat2]);
  return turf.distance(from, to, { units: "kilometers" });
}

export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const from = turf.point([lon1, lat1]);
  const to = turf.point([lon2, lat2]);
  return turf.distance(from, to, { units: "kilometers" });
}

export function calculateIsOpen(
  openingTime?: string,
  closingTime?: string,
): boolean {
  if (!openingTime || !closingTime) return false;

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  const opening = parseTimeString(openingTime);
  const closing = parseTimeString(closingTime);

  if (closing < opening) {
    return currentTime >= opening || currentTime <= closing;
  }
  return currentTime >= opening && currentTime <= closing;
}

function parseTimeString(time: string): number {
  const [timePart, meridiem] = time.split(" ");
  if (!timePart || !meridiem) return 0;

  const [hours, minutes] = timePart.split(":").map(Number);
  let hour24 = hours;

  if (meridiem === "PM" && hours !== 12) hour24 += 12;
  if (meridiem === "AM" && hours === 12) hour24 = 0;

  return hour24 * 60 + minutes;
}

// Calculate estimated delivery time (Ilorin-optimized)
export function calculateDeliveryTime(
  avrgPreparationTime?: string,
  userLat?: number,
  userlong?: number,
  vendorAddress?: { coordinates?: { lat?: number; long?: number } },
): string {
  // Parse prep time: "20-30 mins" → get average
  let prepTime = 25; // Default
  if (avrgPreparationTime) {
    const match = avrgPreparationTime.match(/(\d+)-(\d+)/);
    if (match) {
      const min = parseInt(match[1]);
      const max = parseInt(match[2]);
      prepTime = (min + max) / 2;
    }
  }

  // Calculate delivery time based on distance (2 min per km for Ilorin)
  let deliveryTime = 10; // Default 10 min delivery
  if (
    userLat &&
    userlong &&
    vendorAddress?.coordinates?.lat &&
    vendorAddress?.coordinates?.long
  ) {
    const distance = getDistance(
      userLat,
      userlong,
      vendorAddress.coordinates.lat,
      vendorAddress.coordinates.long,
    );
    // Ilorin: 2 min per km (lighter traffic)
    deliveryTime = Math.ceil((distance / 1000) * 2);
  }

  // Peak hour multiplier
  const now = new Date();
  const hour = now.getHours();
  const isPeak = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 20);
  const isNight = hour >= 22 || hour < 6;

  let multiplier = 1.0;
  if (isPeak) multiplier = 1.3;
  else if (isNight) multiplier = 0.8;

  const totalMin = Math.ceil((prepTime + deliveryTime) * multiplier);
  const minTime = Math.floor(totalMin * 0.8); // -20%
  const maxTime = Math.ceil(totalMin * 1.2); // +20%

  return `${minTime}-${maxTime} min`;
}

// Calculate delivery fee with peak multiplier
export function calculateDeliveryFee(
  vendor: { address?: { coordinates?: { lat?: number; long?: number } } },
  lat?: number,
  long?: number,
): number {
  // Check valid coordinates
  if (!lat || !long || !vendor.address?.coordinates?.lat || !vendor.address?.coordinates?.long) {
    return 500; // Default fee
  }

  const distance = getDistance(lat, long, vendor.address.coordinates.lat, vendor.address.coordinates.long);

  // Determine peak multiplier
  const hour = new Date().getHours();
  const isPeak = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 20);
  const peakMultiplier = isPeak ? 1.3 : 1.0;

  // Formula: ₦200 base + (₦150/km * peakMultiplier) * distance
  const baseFee = 200;
  const perKmFee = 150 * peakMultiplier;
  
  return Math.ceil(baseFee + (perKmFee * distance));
}

// Geoapify Routing API — returns road distance (meters) and travel time (seconds)
export async function getGeoapifyRouting(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): Promise<{ distance: number; time: number } | null> {
  if (!GEOAPIFY_API_KEY) {
    console.warn("GEOAPIFY_API_KEY not set, falling back to Haversine");
    return null;
  }

  try {
    const url = `https://api.geoapify.com/v1/routing?waypoints=${lat1},${lon1}|${lat2},${lon2}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.warn(`Geoapify API returned ${res.status}, falling back to Haversine`);
      return null;
    }

    const data = await res.json();

    if (!data.features || data.features.length === 0) {
      console.warn("Geoapify returned no routes, falling back to Haversine");
      return null;
    }

    const props = data.features[0].properties;
    return {
      distance: props.distance / 1000, // Convert meters to km
      time: props.time,         // seconds
    };
  } catch (err) {
    console.warn("Geoapify API call failed, falling back to Haversine:", err);
    return null;
  }
}

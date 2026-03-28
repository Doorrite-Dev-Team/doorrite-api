import * as turf from "@turf/turf";

export function getDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  console.debug("Calculating distance between two points");
  console.debug(`From: ${lat1}, ${lon1}`);
  console.debug(`To: ${lat2}, ${lon2}`);

  // 1. Create Turf points
  const from = turf.point([lon1, lat1]);
  const to = turf.point([lon2, lat2]);

  // 2. Calculate distance in kilometers (default unit, can change to 'miles')
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

// Calculate estimated delivery time
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

  // Calculate delivery time based on distance
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
    // Estimate: 2 km per 5 minutes in Lagos traffic
    deliveryTime = Math.ceil((distance / 1000 / 2) * 3);
  }

  const totalMin = prepTime + deliveryTime;
  const minTime = Math.floor(totalMin * 0.8); // -20%
  const maxTime = Math.ceil(totalMin * 1.2); // +20%

  return `${minTime}-${maxTime} min`;
}

// Calculate delivery fee (you need to define your pricing logic)
export function calculateDeliveryFee(
  vendor: { address?: { coordinates?: { lat?: number; long?: number } } },
  lat?: number,
  long?: number,
): number {
  // OPTION 1: Fixed fee per vendor (add field to schema)
  // return vendor.deliveryFee || 500;

  // OPTION 2: Distance-based pricing (common in Nigeria)
  if (
    !lat ||
    !long ||
    !vendor.address?.coordinates?.lat ||
    !vendor.address?.coordinates?.long
  ) {
    return 500; // Default fee
  }

  const distance = getDistance(
    lat,
    long,
    vendor.address.coordinates.lat,
    vendor.address.coordinates.long,
  );

  // Example pricing: Free under 2km, ₦200/km after that
  // if (distance < 2) return 0;
  return Math.ceil((distance / 1000) * 2000);
}

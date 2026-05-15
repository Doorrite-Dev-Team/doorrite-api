import { socketService } from "@config/socket";
import { getDistance } from "@lib/utils/location";
import { Server } from "socket.io";

type Coord = { lat: number; long: number };

// socketIds: one per active tab/device for this rider
// coord:     single location — always the rider's latest position
type RiderEntry = { socketIds: Set<string>; coord?: Coord };

class RiderService {
  private static instance: RiderService;
  private riders = new Map<string, RiderEntry>();

  private constructor() {}

  public static getInstance(): RiderService {
    if (!RiderService.instance) {
      RiderService.instance = new RiderService();
    }
    return RiderService.instance;
  }

  private get io(): Server | null {
    return socketService.getIo();
  }

  /** Register a new socket for a rider (called on connect). */
  public add(riderId: string, socketId: string): void {
    if (!riderId) return;

    const entry = this.riders.get(riderId);
    if (entry) {
      entry.socketIds.add(socketId);
    } else {
      this.riders.set(riderId, { socketIds: new Set([socketId]) });
    }
  }

  /**
   * Remove a single socket from a rider's set (called on disconnect).
   * Deletes the rider entry only when no sockets remain.
   */
  public removeSocket(riderId: string, socketId: string): void {
    const entry = this.riders.get(riderId);
    if (!entry) return;

    entry.socketIds.delete(socketId);

    if (entry.socketIds.size === 0) {
      this.riders.delete(riderId);
      console.log(`Rider fully disconnected: ${riderId}`);
    } else {
      console.log(
        `Socket removed for rider ${riderId} (${entry.socketIds.size} socket(s) remaining)`,
      );
    }
  }

  /**
   * Full removal — use for explicit sign-out or admin eviction.
   * For normal disconnects, prefer removeSocket().
   */
  public delete(riderId: string): void {
    this.riders.delete(riderId);
  }

  /** Update the rider's location. Coord is per-rider, not per-socket. */
  public update(riderId: string, coord: Coord): void {
    if (!riderId) return;
    if (!this.io) throw new Error("Socket IO not initialized!");

    const entry = this.riders.get(riderId);
    if (!entry) return;

    entry.coord = coord;
  }

  /** Broadcast the rider's current location to a specific order channel. */
  public getCurrent(riderId: string, orderId: string) {
    if (!riderId) return;
    if (!this.io) throw new Error("Socket IO not initialized!");

    const entry = this.riders.get(riderId);
    this.io.emit(`rider:${riderId}-order:${orderId}`, entry?.coord);
  }

  public getAll(): string[] {
    return Array.from(this.riders.keys());
  }

  public getCloserRiders(
    pickupLat: number,
    pickupLon: number,
    count: number = 5,
  ) {
    const distances: { riderId: string; distance: number }[] = [];

    // coord is per-rider — unaffected by multi-socket changes
    this.riders.forEach(({ coord }, riderId) => {
      if (coord) {
        distances.push({
          riderId,
          distance: getDistance(pickupLat, pickupLon, coord.lat, coord.long),
        });
      }
    });

    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, count).map((d) => d.riderId);
  }

  /**
   * Emit an event to all active sockets for a rider.
   * Uses socketId-based targeting (not room names).
   */
  public notify(riderId: string, event: string, data?: Record<string, any>) {
    if (!this.io) throw new Error("Socket IO not initialized!");

    const entry = this.riders.get(riderId);
    if (!entry || entry.socketIds.size === 0) return false;

    entry.socketIds.forEach((socketId) => {
      this.io!.to(socketId).emit(event, data);
    });
    return true;
  }

  public notifyClosestRiders(
    orderId: string,
    pickupLat: number,
    pickupLon: number,
  ) {
    const closestRiders = this.getCloserRiders(pickupLat, pickupLon, 5);
    const pickupLocation = { lat: pickupLat, lon: pickupLon };

    console.log(
      `Order #${orderId}: Notifying riders: ${closestRiders.join(", ")}`,
    );

    closestRiders.forEach((riderId) => {
      const entry = this.riders.get(riderId);
      if (!entry?.coord) return;

      const distanceAway = getDistance(
        pickupLat,
        pickupLon,
        entry.coord.lat,
        entry.coord.long,
      );

      // notify() now fans out to all socketIds internally
      this.notify(riderId, "new-ride-job", {
        orderId,
        pickup: pickupLocation,
        message: `New ride job available! You are ${distanceAway.toFixed(2)} km away.`,
        amount: "To be calculated",
        claimUrl: `/riders/orders/${orderId}/claim`,
      });
    });
  }
}

export const riderService = RiderService.getInstance();

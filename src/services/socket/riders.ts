import { socketService } from "@config/socket";
import { getDistance } from "@lib/utils/location";
import { Server } from "socket.io";

type Coord = { lat: number; long: number };

class RiderService {
  private static instance: RiderService;
  // Map riderId -> { socketIds: Set<string>, coord?: Coord }
  private riders = new Map<string, { socketId: string; coord?: Coord }>();
  // private io: Server | null = socketService.getIo();

  private constructor() {}

  public static getInstance(): RiderService {
    if (!RiderService.instance) {
      RiderService.instance = new RiderService();
    }
    return RiderService.instance;
  }

  private get io(): Server | null {
    return socketService.getIo(); // Assuming socketService has a getIo method
  }

  public add(riderId: string, socketId: string): void {
    if (!riderId) return;

    let entry = this.riders.get(riderId);
    if (!entry) {
      entry = { socketId: socketId, coord: undefined };
      this.riders.set(riderId, entry);
    }
    // entry.socketIds.add(socketId);
  }

  public delete(riderId: string): void {
    if (this.riders.get(riderId)) {
      this.riders.delete(riderId);
    }
  }

  public update(riderId: string, coord: Coord): void {
    if (!riderId) return;
    if (!this.io) throw new Error("Socket IO not initialized!");

    const entry = this.riders.get(riderId);

    if (!entry) {
      return;
    }

    entry.coord = coord;

    this.io.emit("riders:location:update", { riderId, coord });
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

    this.riders.forEach(({ coord: location }, riderId) => {
      if (location) {
        distances.push({
          riderId,
          distance: getDistance(
            pickupLat,
            pickupLon,
            location.lat,
            location.long,
          ),
        });
      }
    });

    // Sort by distance and return the top 'count' IDs
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, count).map((d) => d.riderId);
  }

  public notify(riderId: string, event: string, data?: Record<string, any>) {
    if (!this.io) throw new Error("Socket IO not initialized!");
    if (!this.riders.get(riderId)) return false;

    this.io.to(riderId).emit(event, data);
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
      const entity = this.riders.get(riderId);
      const targetSocketId = entity?.socketId;
      const riderLoc = entity?.coord;

      if (targetSocketId && riderLoc) {
        const distanceAway = getDistance(
          pickupLat,
          pickupLon,
          riderLoc.lat,
          riderLoc.long,
        );

        // 🚀 io.to(socketId).emit() sends the job notification
        this.notify(targetSocketId, "new-ride-job", {
          orderId,
          pickup: pickupLocation,
          message: `New ride job available! You are ${distanceAway.toFixed(2)} km away.`,
        });
      }
    });
  }
}

export const riderService = RiderService.getInstance();

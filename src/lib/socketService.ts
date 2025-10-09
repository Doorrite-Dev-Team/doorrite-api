import type { Server as IOServer } from "socket.io";

type Coord = { lat: number; long: number };

let io: IOServer | null = null;

// Map riderId -> { socketIds: Set<string>, coord?: Coord }
const riders = new Map<string, { socketIds: Set<string>; coord?: Coord }>();

export function setIo(server: IOServer) {
  io = server;
}

export function registerRiderSocket(riderId: string, socketId: string) {
  if (!riderId) return;
  let entry = riders.get(riderId);
  if (!entry) {
    entry = { socketIds: new Set(), coord: undefined };
    riders.set(riderId, entry);
  }
  entry.socketIds.add(socketId);
}

export function unregisterSocket(socketId: string) {
  for (const [riderId, entry] of riders.entries()) {
    if (entry.socketIds.has(socketId)) {
      entry.socketIds.delete(socketId);
      if (entry.socketIds.size === 0) riders.delete(riderId);
      break;
    }
  }
}

export function updateRiderLocation(riderId: string, coord: Coord) {
  if (!riderId) return;
  let entry = riders.get(riderId);
  if (!entry) {
    entry = { socketIds: new Set(), coord };
    riders.set(riderId, entry);
  } else {
    entry.coord = coord;
  }

  // Emit immediate single rider update
  if (io) {
    io.emit("riders:location:update", { riderId, coord });
  }
}

export function emitAllRiderLocations() {
  const payload = Array.from(riders.entries()).map(([riderId, entry]) => ({
    riderId,
    coord: entry.coord || null,
  }));
  if (io) io.emit("riders:locations:all", payload);
  return payload;
}

export function emitOrderUpdate(order: any) {
  if (!order) return;
  if (io) io.emit("order:update", order);
}

export function getConnectedRiderIds() {
  return Array.from(riders.keys());
}

export default {
  setIo,
  registerRiderSocket,
  unregisterSocket,
  updateRiderLocation,
  emitAllRiderLocations,
  emitOrderUpdate,
  getConnectedRiderIds,
};

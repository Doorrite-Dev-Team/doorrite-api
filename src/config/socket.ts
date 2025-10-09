import { createServer } from "http";
import {
  Server as SocketIOServer,
  type Server as IOServerType,
} from "socket.io";
import type { Express } from "express";
import socketService from "@lib/socketService";

export function attachSocketServer(app: Express) {
  // Create an HTTP server that uses the Express app as the handler
  const server = createServer(app);

  // Initialize socket.io and allow CORS from the client origins used in app
  const io = new SocketIOServer(server, {
    cors: {
      origin: ["http://localhost:3000", "https://dooriteuser-ui.vercel.app"],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // Riders or clients can register themselves with their riderId
    socket.on("rider:register", (payload: { riderId?: string }) => {
      const riderId = payload?.riderId;
      if (riderId) {
        socketService.registerRiderSocket(riderId, socket.id);
        console.log(`Rider ${riderId} registered on socket ${socket.id}`);
      }
    });

    socket.on(
      "rider:location",
      (payload: { riderId?: string; lat?: number; long?: number }) => {
        const { riderId, lat, long } = payload || {};
        if (riderId && typeof lat === "number" && typeof long === "number") {
          socketService.updateRiderLocation(riderId, { lat, long });
        }
      }
    );

    socket.on("disconnect", (reason) => {
      console.log(`Socket ${socket.id} disconnected:`, reason);
    });
  });
  // expose the io to socketService so other modules can emit
  socketService.setIo(io);

  return { server, io } as {
    server: ReturnType<typeof createServer>;
    io: IOServerType;
  };
}

export type SocketServer = ReturnType<typeof attachSocketServer>;

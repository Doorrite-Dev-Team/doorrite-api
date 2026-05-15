import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { NotificationService } from "../services/redis/notification";
import { safeVerify } from "./jwt";
import { riderService } from "services/socket/riders";
import { Coordinates } from "../generated/prisma";
import type { Notification } from "../types/notifications";
import { AppSocketEvent } from "../constants/socket";
import { setupChatHandlers } from "../services/socket/chat-handler";

class WebSocketService {
  private static instance: WebSocketService;
  private io: Server | null = null;

  // userId → Set of active socketIds (one per tab/device)
  private users = new Map<string, Set<string>>();

  private constructor() {}

  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  public init(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: [
          "http://localhost:3000",
          "https://dooriteuser-ui.vercel.app",
          "https://*.netlify.app",
        ],
        methods: ["GET", "POST"],
        credentials: true,
      },
    });
    console.log("Successfully Connected to WebSocket Client");

    // Middleware for JWT token verification
    this.io.use((socket, next) => {
      console.log("New Connection Detected");
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        console.error("Connection rejected: No token provided");
        return next(new Error("Authentication error"));
      }
      const user = safeVerify(token);
      if (!user) {
        console.error(
          "Connection rejected: JWT verification failed (Expired or Invalid)",
        );
        return next(new Error("Invalid token"));
      }

      socket.user = user;
      next();
    });

    this.io.on("connection", async (socket) => {
      const user = socket.user;
      const userId = socket.user?.sub;

      if (!user || !userId) {
        console.error(
          "Connection rejected: JWT verification failed (Expired or Invalid)",
        );
        return socket.disconnect();
      }

      if (user.role === "rider") {
        riderService.add(userId, socket.id);

        socket.on("update-rider-location", (coord: Coordinates) => {
          riderService.update(userId, coord);
        });
      }

      // 1. Register socket — add to the user's set (supports multiple tabs/devices)
      const sockets = this.users.get(userId) ?? new Set<string>();
      sockets.add(socket.id);
      this.users.set(userId, sockets);
      console.log(
        `User connected: ${userId} (${sockets.size} active socket(s))`,
      );

      // 2. Check Redis for pending notifications (only on first connection)
      if (sockets.size === 1) {
        const pending = await NotificationService.getPending(userId);
        if (pending.length) socket.emit("pending-notifications", pending);
      }

      socket.on("rider:update-location", (coord: Coordinates) => {
        riderService.update(userId, coord);
      });

      socket.on("notification-read", (id) => {
        NotificationService.remove(userId, id);
      });

      socket.on("disconnect", () => {
        // Remove only this socket — keep the entry alive while other tabs remain
        const activeSockets = this.users.get(userId);
        if (activeSockets) {
          activeSockets.delete(socket.id);
          if (activeSockets.size === 0) {
            this.users.delete(userId);
            console.log(`User fully disconnected: ${userId}`);
          } else {
            console.log(
              `Socket disconnected for ${userId} (${activeSockets.size} socket(s) remaining)`,
            );
          }
        }

        riderService.removeSocket(userId, socket.id);
      });

      setupChatHandlers(this.io!, socket);
    });
  }

  /**
   * Emit an event to all active sockets for a user (all tabs/devices).
   * Falls back to Redis if the user is offline.
   */
  public notify(
    userId: string,
    event: string | undefined = "notification",
    data: Omit<Notification, "id">,
  ) {
    if (!this.io) throw new Error("Socket IO not initialized!");

    const socketIds = this.users.get(userId);

    if (socketIds && socketIds.size > 0) {
      socketIds.forEach((socketId) => {
        this.io!.to(socketId).emit(event, data);
      });
      return true; // Online
    }

    // User is offline — persist to Redis
    const notifId = `${userId}-${event}`;
    NotificationService.add(userId, notifId, { id: notifId, ...data });
    return false; // Offline
  }

  public notifyTo(
    users: string[],
    event: string | undefined = "notification",
    data: Omit<Notification, "id">,
  ) {
    users.forEach((u) => {
      this.notify(u, event, data);
    });
  }

  public logIn(id: string, fullName: string) {
    this.notify(id, AppSocketEvent.SYSTEM, {
      type: "SYSTEM",
      title: "Welcome Back",
      message: `Welcome back to Doorrite, ${fullName}`,
      priority: "normal",
      timestamp: new Date().toISOString(),
    });
  }

  public getIo() {
    return this.io;
  }
}

export const socketService = WebSocketService.getInstance();

import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { NotificationService } from "../services/redis/notification";
import { safeVerify } from "./jwt";
import { riderService } from "services/socket/riders";
import { Coordinates } from "generated/prisma";
import { Notification } from "types/notifications";
import { AppSocketEvent } from "types/socket";

class WebSocketService {
  private static instance: WebSocketService;
  private io: Server | null = null;

  // 🔒 Private State: No global variables
  private users = new Map<string, string>();

  private constructor() {}

  // Singleton Accessor
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
          "https://doorrite-user-ui.netlify.app/",
        ],
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    //Middleware for jwt Token verification
    this.io.use((socket, next) => {
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

      socket.user = user; // Attach user to socket
      next();
    });

    //On Connection
    this.io.on("connection", async (socket) => {
      const user = socket.user;
      const userId = user?.sub;

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

      // 1. Manage State
      this.users.set(userId, socket.id);
      console.log(`User connected: ${userId}`);

      // 2. Check Redis for pending (Delegate to another service)
      const pending = await NotificationService.getPending(userId);
      if (pending.length) socket.emit("pending-notifications", pending);

      socket.on("rider:update-location", (coord: Coordinates) => {
        console.log(coord);
        riderService.update(userId, coord);
      });

      //3. Notify user
      socket.emit("notification", "Welcome to Doorrite");

      socket.on("notification-read", (id) => {
        NotificationService.remove(userId, id);
      });

      socket.on("disconnect", () => {
        console.log("A user was disconnected");
        this.users.delete(userId);
        riderService.delete(userId);
      });
    });
  }

  // 🚀 Public Method to send notifications from anywhere
  public notify(
    userId: string,
    event: AppSocketEvent,
    data: Omit<Notification, "id">,
  ) {
    if (!this.io) throw new Error("Socket IO not initialized!");

    const socketId = this.users.get(userId);

    if (socketId) {
      this.io.to(socketId).emit(event, data);
      return true; // Online
    }

    const notifId = `${userId}-${event}`;

    NotificationService.add(userId, notifId, { id: notifId, ...data });
    return false; // Offline
  }

  public getIo() {
    return this.io;
  }
}

export const socketService = WebSocketService.getInstance();

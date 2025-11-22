import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { NotificationService } from "../services/redis/notification";
import { safeVerify } from "./jwt";
import { riderService } from "services/socket/riders";

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
        origin: ["http://localhost:3000", "https://dooriteuser-ui.vercel.app"],
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    this.io.on("connection", async (socket) => {
      console.log("A user is Connected");
      const token = socket.handshake.query.token as string; // Use .auth instead of .query

      if (token) {
        const user = safeVerify(token);
        const userId = user?.sub;
        if (!user || !userId) return;
        if (user.role === "rider") {
          riderService.add(userId, socket.id);
        }

        // 1. Manage State
        this.users.set(userId, socket.id);
        // console.log(`User connected: ${userId}`);

        // 2. Check Redis for pending (Delegate to another service)
        const pending = await NotificationService.getPending(userId);
        if (pending.length) socket.emit("pending-notifications", pending);

        socket.on("disconnect", () => {
          this.users.delete(userId);
          riderService.delete(userId);
        });
      }
    });
  }

  // 🚀 Public Method to send notifications from anywhere
  public notify(userId: string, event: string, data: any) {
    if (!this.io) throw new Error("Socket IO not initialized!");

    const socketId = this.users.get(userId);

    if (socketId) {
      this.io.to(socketId).emit(event, data);
      return true; // Online
    }

    const notifId = `${userId}-${event}`;

    NotificationService.add(userId, notifId, data);
    return false; // Offline
  }

  public getIo() {
    return this.io;
  }
}

export const socketService = WebSocketService.getInstance();

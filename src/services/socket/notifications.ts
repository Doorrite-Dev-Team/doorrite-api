import type { Notification } from "../../types/notifications";
import { Server } from "socket.io";

let io: Server | null = null;

const notifications = new Map<string, Notification>();

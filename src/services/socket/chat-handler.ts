import { Server, Socket } from "socket.io";
import prisma from "@config/db";
import { ChatSessionService } from "@services/redis/chat-sessions";

export function setupChatHandlers(io: Server, socket: Socket) {
  socket.on("join_order", async (orderId: string) => {
    if (!orderId) return;
    
    const userId = socket.user?.sub;
    if (!userId) return;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, riderId: true },
    });

    if (!order) {
      socket.emit("error", { message: "Order not found" });
      return;
    }

    const isAuthorized = order.customerId === userId || order.riderId === userId;
    if (!isAuthorized) {
      socket.emit("error", { message: "Not authorized to join this order chat" });
      return;
    }

    socket.join(orderId);
    await ChatSessionService.setUserOrderSession(userId, orderId);
    
    socket.emit("joined_order", { orderId, message: "Successfully joined order chat" });
  });

  socket.on("leave_order", async (orderId: string) => {
    if (!orderId) return;
    
    const userId = socket.user?.sub;
    if (!userId) return;

    socket.leave(orderId);
    await ChatSessionService.removeUserSession(userId);
    
    socket.emit("left_order", { orderId, message: "Successfully left order chat" });
  });

  socket.on("send_message", async (data: { orderId: string; content: string }) => {
    const { orderId, content } = data;
    
    if (!orderId || !content) {
      socket.emit("error", { message: "orderId and content are required" });
      return;
    }

    const userId = socket.user?.sub;
    const userRole = socket.user?.role;
    
    if (!userId) return;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, riderId: true },
    });

    if (!order) {
      socket.emit("error", { message: "Order not found" });
      return;
    }

    const isAuthorized = order.customerId === userId || order.riderId === userId;
    if (!isAuthorized) {
      socket.emit("error", { message: "Not authorized to send messages in this order" });
      return;
    }

    const senderType = userRole === "rider" ? "RIDER" : "USER";

    const messagePayload = {
      id: `temp_${Date.now()}`,
      content,
      senderId: userId,
      senderType,
      orderId,
      createdAt: new Date().toISOString(),
    };

    io.to(orderId).emit("new_message", messagePayload);

    prisma.message
      .create({
        data: {
          content,
          senderId: userId,
          senderType,
          orderId,
        },
      })
      .catch((err) => console.error("Failed to persist message:", err));
  });
}

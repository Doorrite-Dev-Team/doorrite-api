import cron from "node-cron";
import { PrismaClient } from "../generated/prisma/client";

const prisma = new PrismaClient();

/**
 * Move SCHEDULED orders to PENDING when their scheduledAt time has passed.
 * Runs every minute.
 */
async function processScheduledOrders() {
  const now = new Date();

  const scheduledOrders = await prisma.order.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
    },
    select: { id: true, scheduledAt: true },
  });

  if (scheduledOrders.length === 0) return;

  const orderIds = scheduledOrders.map((o) => o.id);

  await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: { status: "PENDING" },
  });

  console.log(
    `[ScheduledOrders] Activated ${scheduledOrders.length} orders:`,
    orderIds
  );
}

/**
 * Archive messages older than 30 days to reduce DB load.
 * Runs daily at midnight.
 */
async function archiveOldMessages() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const result = await prisma.message.updateMany({
    where: {
      isArchived: false,
      createdAt: { lt: cutoff },
    },
    data: { isArchived: true },
  });

  if (result.count > 0) {
    console.log(`[MessageArchive] Archived ${result.count} old messages`);
  }
}

export function startScheduledOrdersCron() {
  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      await processScheduledOrders();
    } catch (err) {
      console.error("[ScheduledOrders] Error:", err);
    }
  });

  console.log("[Cron] Scheduled orders cron started (every minute)");
}

export function startMessageArchiveCron() {
  // Run daily at midnight
  cron.schedule("0 0 * * *", async () => {
    try {
      await archiveOldMessages();
    } catch (err) {
      console.error("[MessageArchive] Error:", err);
    }
  });

  console.log("[Cron] Message archive cron started (daily at midnight)");
}
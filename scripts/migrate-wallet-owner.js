const { PrismaClient } = require("../src/generated/prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Connecting to database...");
  await prisma.$connect();

  // Step 1: Migrate vendor wallets — set ownerId from vendorId
  const vendorResult = await prisma.$runCommandRaw({
    update: "Wallet",
    updates: [
      {
        q: { vendorId: { $ne: null }, ownerId: null },
        u: { $set: { ownerId: "$vendorId", ownerType: "VENDOR" } },
        multi: true,
      },
    ],
  });
  console.log("Vendor wallets migrated:", JSON.stringify(vendorResult));

  // Step 2: Migrate rider wallets — set ownerId from riderId
  const riderResult = await prisma.$runCommandRaw({
    update: "Wallet",
    updates: [
      {
        q: { riderId: { $ne: null }, ownerId: null },
        u: { $set: { ownerId: "$riderId", ownerType: "RIDER" } },
        multi: true,
      },
    ],
  });
  console.log("Rider wallets migrated:", JSON.stringify(riderResult));

  // Step 3: Drop old unique indexes
  try {
    await prisma.$runCommandRaw({
      dropIndexes: "Wallet",
      index: "Wallet_vendorId_key",
    });
    console.log("Dropped index Wallet_vendorId_key");
  } catch {
    console.log("Wallet_vendorId_key already dropped or not found");
  }

  try {
    await prisma.$runCommandRaw({
      dropIndexes: "Wallet",
      index: "Wallet_riderId_key",
    });
    console.log("Dropped index Wallet_riderId_key");
  } catch {
    console.log("Wallet_riderId_key already dropped or not found");
  }

  console.log("\nMigration complete. Run `npm run prisma:push` next.");
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

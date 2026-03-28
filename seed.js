import { PrismaClient } from "./src/generated/prisma/client.js";

const cat = [
  "Nigerian / Local",
  "African / (non-Nigerian)",
  "International / (Indian, Chinese, Italian, etc.)",
  "Fast Food / Snacks",
  "Healthy / Fit Fam",
  "Bakery / Pastries",
  "Seafood / Grills",
  "Drinks / Beverages",
];

export const vendorCategoryId = () => {
  const ids = cat.map((c) => {
    const [id] = c.split("/");

    return id;
  });

  return ids;
};

const prisma = new PrismaClient({
  log: ["query", "error", "warn"],
});

const ranNum = (length) => Math.ceil(Math.random() * length);

async function seed() {
  try {
    // Select only the ID to avoid serialization errors on broken records
    const vendors = await prisma.vendor.findMany({
      select: { id: true },
    });

    console.log(`Found ${vendors.length} vendors. Starting update...`);

    for (let i = 0; i < vendors.length; i++) {
      const vendor = vendors[i];
      const categories = new Set();
      const categoryIds = vendorCategoryId();
      const ite = ranNum(categoryIds.length);
      for (let i = 0; i < ite; i++) {
        const id = categoryIds[ranNum(categoryIds.length)];
        if (id && !categories.has(id)) {
          categories.add(id.trim());
        }
      }

      console.log("categoryIds:", categoryIds);

      await prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          categories: {
            set: Array.from(categories),
          },
        },
      });
    }

    console.log("Successfully updated all vendors.");
  } catch (error) {
    console.error("Seed error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seed();

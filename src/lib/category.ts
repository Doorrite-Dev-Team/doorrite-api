// Categories & Subcategories inspired by Chowdeck + Glovo Nigeria
export const DeliveryCategories = {
  food: {
    cuisines: [
      "Nigerian / Local",
      "African (non-Nigerian)",
      "International (Indian, Chinese, Italian, etc.)",
    ],
    mealTypes: [
      "Breakfast",
      "Lunch / Dinner",
      "Fast Food",
      "Healthy / Fit Fam",
    ],
    dishTypes: [
      "Burgers",
      "Pizza",
      "Seafood",
      "Sushi",
      "Chicken (fried, grilled, etc.)",
      "Soups",
      "Rice / Pasta",
      "Sandwiches",
      "Desserts / Pastries / Ice Cream",
    ],
    combos: ["Value Meals", "Chowsmart-type Combos"],
  },

  groceries: {
    freshProduce: ["Fruits", "Vegetables", "Herbs / Spices (fresh)"],
    meatSeafoodDairy: [
      "Poultry",
      "Beef",
      "Goat",
      "Seafood",
      "Eggs",
      "Milk / Cheese / Yogurt",
    ],
    bakery: ["Bread", "Cakes", "Pastries"],
    drinks: ["Water", "Juices / Soft Drinks", "Alcoholic Drinks"],
    snacksAndSweets: [
      "Chips / Crisps",
      "Biscuits / Cookies",
      "Chocolates",
      "Candy",
    ],
    pantryStaples: [
      "Rice",
      "Pasta",
      "Cooking Oils",
      "Sauces",
      "Seasonings",
      "Flour",
      "Sugar",
      "Salt",
      "Canned / Packaged Foods",
    ],
    frozenAndRefrigerated: ["Frozen Meat", "Frozen Vegetables", "Ice Cream"],
    householdAndCare: [
      "Cleaning Supplies",
      "Toiletries",
      "Baby Care",
      "Pet Care",
      "Beauty & Cosmetics",
    ],
  },

  deliveryServices: {
    methods: ["Delivery from Restaurants / Stores", "Pick-Up from Vendor"],
    other: [
      "Errands / Package Delivery (non-food / supermarket)",
      "Scheduled Orders",
      "Instant Orders",
      "Promotions / Bundles / Meal Deals",
    ],
  },
} as const;

export type DeliveryCategory = typeof DeliveryCategories;

// Helpers
// Return a flat set of allowed category identifiers (keys and nested values)
export const listAllowedCategoryKeys = (): string[] => {
  // We'll use simple keys for top-level categories and nested group names
  const keys: string[] = [];
  for (const top of Object.keys(DeliveryCategories)) {
    keys.push(top);
    const bucket: any = (DeliveryCategories as any)[top];
    for (const sub of Object.keys(bucket)) {
      keys.push(`${top}.${sub}`);
    }
  }
  return keys;
};

// Validate provided categoryIds: they should be strings and belong to listAllowedCategoryKeys
export const isValidCategoryId = (id: string) => {
  if (!id || typeof id !== "string") return false;
  const allowed = listAllowedCategoryKeys();
  return allowed.includes(id);
};

// Validate an array of categoryIds; returns list of invalid ids (empty if all valid)
export const validateCategoryIds = (ids: string[] | any): string[] => {
  if (!Array.isArray(ids)) return ["invalid_type"];
  const invalid: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !isValidCategoryId(id)) invalid.push(id);
  }
  return invalid;
};

export default DeliveryCategories;

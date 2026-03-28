export const CUISINES = [
  "Nigerian / Local",
  "African / (non-Nigerian)",
  "International/ (Indian, Chinese, Italian, etc.)",
  "Fast Food / Snacks",
  "Healthy / Fit Fam",
  "Bakery / Pastries",
  "Seafood / Grills",
  "Drinks / Beverages",
] as const;

export type Cuisine = (typeof CUISINES)[number];

export const vendorCategoryId = () => {
  const ids = CUISINES.map((c) => {
    const [id] = c.split("/");

    return id.trim();
  });

  return ids;
};

export type CategoryId = ReturnType<typeof vendorCategoryId>[number];

export const isValidCategoryId = (categoryId: string): boolean => {
  return vendorCategoryId().includes(categoryId as CategoryId);
};

export const validateCategoryIds = (categoryIds: string[] | unknown): string[] => {
  if (!Array.isArray(categoryIds)) return ["invalid_type"];
  const validIds = vendorCategoryId();
  const invalid: string[] = [];
  for (const id of categoryIds) {
    if (typeof id !== "string" || !validIds.includes(id.trim() as CategoryId)) {
      invalid.push(id as string);
    }
  }
  return invalid;
};

export const isValidCuisine = (cuisine: string): boolean => {
  return CUISINES.includes(cuisine as Cuisine);
};

export const validateCuisines = (cuisines: string[] | unknown): string[] => {
  if (!Array.isArray(cuisines)) return ["invalid_type"];
  const invalid: string[] = [];
  for (const cuisine of cuisines) {
    if (typeof cuisine !== "string" || !isValidCuisine(cuisine)) {
      invalid.push(cuisine as string);
    }
  }
  return invalid;
};

export default CUISINES;

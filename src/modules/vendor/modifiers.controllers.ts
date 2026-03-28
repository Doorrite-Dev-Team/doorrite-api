import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { Request, Response } from "express";
import { isValidObjectId } from "@modules/product/helpers";
import {
  createModifierGroupSchema,
  updateModifierGroupSchema,
  createModifierOptionSchema,
  updateModifierOptionSchema,
} from "./helpers";
import { cacheService } from "@config/cache";

// ============================================================================
// MODIFIER GROUP CRUD
// ============================================================================

/**
 * GET /api/v1/vendors/modifiers
 * Get all modifier groups for the authenticated vendor
 */
export const getModifierGroups = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Get all modifier groups'
   * #swagger.description = 'Fetches all modifier groups in the vendor library.'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) throw new AppError(401, "Authentication required");

    const key = cacheService.generateKey("modifierGroups", vendorId);
    const cacheHit = await cacheService.get<any>(key);

    if (cacheHit) {
      console.debug("Cache hit: modifier groups");
      return sendSuccess(res, cacheHit);
    }

    const modifierGroups = await prisma.modifierGroup.findMany({
      where: { vendorId },
      include: {
        options: {
          where: { isAvailable: true },
          orderBy: { createdAt: "asc" },
        },
        productAssignments: {
          select: { productId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = {
      modifierGroups: modifierGroups.map((group) => ({
        ...group,
        usedInProducts: group.productAssignments.length,
      })),
    };

    await cacheService.set(key, data);
    return sendSuccess(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/v1/vendors/modifiers
 * Create a new modifier group with options
 */
export const createModifierGroup = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Create modifier group'
   * #swagger.description = 'Creates a new modifier group with its options.'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) throw new AppError(401, "Authentication required");

    const parsed = createModifierGroupSchema.parse(req.body);

    const modifierGroup = await prisma.modifierGroup.create({
      data: {
        vendorId,
        name: parsed.name,
        isRequired: parsed.isRequired,
        minSelect: parsed.minSelect,
        maxSelect: parsed.maxSelect,
        options: {
          create: parsed.options.map((opt) => ({
            name: opt.name,
            priceAdjustment: opt.priceAdjustment,
          })),
        },
      },
      include: {
        options: true,
      },
    });

    await cacheService.invalidate(
      cacheService.generateKey("modifierGroups", vendorId),
    );

    return sendSuccess(
      res,
      {
        message: "Modifier group created successfully",
        modifierGroup,
      },
      201,
    );
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/v1/vendors/modifiers/:id
 * Get single modifier group with details
 */
export const getModifierGroupById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Get modifier group by ID'
   */
  try {
    const vendorId = req.user?.sub;
    const { id } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(id)) throw new AppError(400, "Invalid ID");

    const modifierGroup = await prisma.modifierGroup.findFirst({
      where: { id, vendorId },
      include: {
        options: {
          orderBy: { createdAt: "asc" },
        },
        productAssignments: {
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!modifierGroup) throw new AppError(404, "Modifier group not found");

    return sendSuccess(res, { modifierGroup });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PUT /api/v1/vendors/modifiers/:id
 * Update modifier group (name and rules only)
 */
export const updateModifierGroup = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Update modifier group'
   */
  try {
    const vendorId = req.user?.sub;
    const { id } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(id)) throw new AppError(400, "Invalid ID");

    const parsed = updateModifierGroupSchema.parse(req.body);

    // Verify ownership
    const existing = await prisma.modifierGroup.findFirst({
      where: { id, vendorId },
    });

    if (!existing) throw new AppError(404, "Modifier group not found");

    // Validate maxSelect >= minSelect if both provided
    const finalMinSelect = parsed.minSelect ?? existing.minSelect;
    const finalMaxSelect = parsed.maxSelect ?? existing.maxSelect;

    if (finalMaxSelect < finalMinSelect) {
      throw new AppError(400, "maxSelect must be >= minSelect");
    }

    const updated = await prisma.modifierGroup.update({
      where: { id },
      data: parsed,
      include: {
        options: true,
      },
    });

    await cacheService.invalidate(
      cacheService.generateKey("modifierGroups", vendorId),
    );

    return sendSuccess(res, {
      message: "Modifier group updated",
      modifierGroup: updated,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * DELETE /api/v1/vendors/modifiers/:id
 * Delete modifier group (only if not in use)
 */
export const deleteModifierGroup = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Delete modifier group'
   */
  try {
    const vendorId = req.user?.sub;
    const { id } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(id)) throw new AppError(400, "Invalid ID");

    // Verify ownership
    const existing = await prisma.modifierGroup.findFirst({
      where: { id, vendorId },
      include: {
        productAssignments: { take: 1 },
      },
    });

    if (!existing) throw new AppError(404, "Modifier group not found");

    // Prevent deletion if in use
    if (existing.productAssignments.length > 0) {
      throw new AppError(
        400,
        "Cannot delete modifier group assigned to products. Remove from products first.",
      );
    }

    await prisma.modifierGroup.delete({ where: { id } });

    await cacheService.invalidate(
      cacheService.generateKey("modifierGroups", vendorId),
    );

    return sendSuccess(res, { message: "Modifier group deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ============================================================================
// MODIFIER OPTIONS CRUD
// ============================================================================

/**
 * POST /api/v1/vendors/modifiers/:id/options
 * Add a new option to a modifier group
 */
export const createModifierOption = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Add option to modifier group'
   */
  try {
    const vendorId = req.user?.sub;
    const { id: groupId } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(groupId)) throw new AppError(400, "Invalid group ID");

    const parsed = createModifierOptionSchema.parse(req.body);

    // Verify group ownership
    const group = await prisma.modifierGroup.findFirst({
      where: { id: groupId, vendorId },
    });

    if (!group) throw new AppError(404, "Modifier group not found");

    const option = await prisma.modifierOption.create({
      data: {
        modifierGroupId: groupId,
        name: parsed.name,
        priceAdjustment: parsed.priceAdjustment,
      },
    });

    await cacheService.invalidate(
      cacheService.generateKey("modifierGroups", vendorId),
    );

    return sendSuccess(res, { message: "Option created", option }, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PUT /api/v1/vendors/modifiers/:groupId/options/:optionId
 * Update a modifier option
 */
export const updateModifierOption = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Update modifier option'
   */
  try {
    const vendorId = req.user?.sub;
    const { groupId, optionId } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(groupId) || !isValidObjectId(optionId)) {
      throw new AppError(400, "Invalid ID");
    }

    const parsed = updateModifierOptionSchema.parse(req.body);

    // Verify ownership via group
    const option = await prisma.modifierOption.findFirst({
      where: {
        id: optionId,
        modifierGroupId: groupId,
        group: { vendorId },
      },
    });

    if (!option) throw new AppError(404, "Option not found");

    const updated = await prisma.modifierOption.update({
      where: { id: optionId },
      data: parsed,
    });

    await cacheService.invalidate(
      cacheService.generateKey("modifierGroups", vendorId),
    );

    return sendSuccess(res, { message: "Option updated", option: updated });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * DELETE /api/v1/vendors/modifiers/:groupId/options/:optionId
 * Delete a modifier option
 */
export const deleteModifierOption = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Modifiers']
   * #swagger.summary = 'Delete modifier option'
   */
  try {
    const vendorId = req.user?.sub;
    const { groupId, optionId } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(groupId) || !isValidObjectId(optionId)) {
      throw new AppError(400, "Invalid ID");
    }

    // Verify ownership and check option count
    const group = await prisma.modifierGroup.findFirst({
      where: { id: groupId, vendorId },
      include: { options: true },
    });

    if (!group) throw new AppError(404, "Modifier group not found");

    if (group.options.length <= 1) {
      throw new AppError(
        400,
        "Cannot delete the last option. A modifier group must have at least one option.",
      );
    }

    const option = group.options.find((opt) => opt.id === optionId);
    if (!option) throw new AppError(404, "Option not found");

    await prisma.modifierOption.delete({ where: { id: optionId } });

    await cacheService.invalidate(
      cacheService.generateKey("modifierGroups", vendorId),
    );

    return sendSuccess(res, { message: "Option deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ============================================================================
// PRODUCT-MODIFIER ASSIGNMENT
// ============================================================================

/**
 * POST /api/v1/vendors/products/:id/modifiers
 * Attach modifier group to product
 */
export const assignModifierToProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Product Modifiers']
   * #swagger.summary = 'Attach modifier group to product'
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId } = req.params;
    const { modifierGroupId } = req.body;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(productId))
      throw new AppError(400, "Invalid product ID");
    if (!modifierGroupId || !isValidObjectId(modifierGroupId)) {
      throw new AppError(400, "Valid modifierGroupId required");
    }

    // Verify product ownership
    const product = await prisma.product.findFirst({
      where: { id: productId, vendorId },
    });

    if (!product) throw new AppError(404, "Product not found");

    // Verify modifier group ownership
    const modifierGroup = await prisma.modifierGroup.findFirst({
      where: { id: modifierGroupId, vendorId },
    });

    if (!modifierGroup) throw new AppError(404, "Modifier group not found");

    // Check if already assigned
    const existing = await prisma.productModifierGroup.findUnique({
      where: {
        productId_modifierGroupId: {
          productId,
          modifierGroupId,
        },
      },
    });

    if (existing) {
      throw new AppError(
        400,
        "Modifier group already assigned to this product",
      );
    }

    const assignment = await prisma.productModifierGroup.create({
      data: {
        productId,
        modifierGroupId,
      },
      include: {
        modifierGroup: {
          include: { options: true },
        },
      },
    });

    await cacheService.invalidatePattern("products");
    await cacheService.invalidatePattern("vendors");

    return sendSuccess(
      res,
      { message: "Modifier group assigned", assignment },
      201,
    );
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * DELETE /api/v1/vendors/products/:productId/modifiers/:modifierGroupId
 * Remove modifier group from product
 */
export const removeModifierFromProduct = async (
  req: Request,
  res: Response,
) => {
  /**
   * #swagger.tags = ['Vendor', 'Product Modifiers']
   * #swagger.summary = 'Remove modifier group from product'
   */
  try {
    const vendorId = req.user?.sub;
    const { productId, modifierGroupId } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(productId) || !isValidObjectId(modifierGroupId)) {
      throw new AppError(400, "Invalid ID");
    }

    // Verify ownership
    const assignment = await prisma.productModifierGroup.findFirst({
      where: {
        productId,
        modifierGroupId,
        product: { vendorId },
      },
    });

    if (!assignment) throw new AppError(404, "Assignment not found");

    await prisma.productModifierGroup.delete({
      where: {
        productId_modifierGroupId: {
          productId,
          modifierGroupId,
        },
      },
    });

    await cacheService.invalidatePattern("products");

    return sendSuccess(res, { message: "Modifier group removed from product" });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/v1/vendors/products/:id/modifiers
 * Get all modifier groups assigned to a product
 */
export const getProductModifiers = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Product Modifiers']
   * #swagger.summary = 'Get product modifiers'
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");
    if (!isValidObjectId(productId))
      throw new AppError(400, "Invalid product ID");

    // Verify product ownership
    const product = await prisma.product.findFirst({
      where: { id: productId, vendorId },
      include: {
        modifierGroups: {
          include: {
            modifierGroup: {
              include: {
                options: {
                  where: { isAvailable: true },
                },
              },
            },
          },
        },
      },
    });

    if (!product) throw new AppError(404, "Product not found");

    return sendSuccess(res, {
      modifierGroups: product.modifierGroups.map((pmg) => pmg.modifierGroup),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

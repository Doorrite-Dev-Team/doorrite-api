import { AppError, handleError, sendSuccess } from "@modules/auth/helper";
import { Request, Response } from "express";

export const getVendor = async (req: Request, res: Response) => {
  const rpayload = req.user
  if (!rpayload?.sub) throw new AppError(401, "Unauthorized");
  if(rpayload?.role !== "vendor") throw new AppError(401, "Unauthorized")

  try {
    const vendor = await prisma?.vendor.findUnique({
      where: { id: rpayload.sub },
      select: {
        id: true,
        email: true,
        businessName: true,
        phoneNumber: true,
        category: true,
        subcategory: true,
        logoUrl: true,
        rating: true,
        isActive: true,
      },
      // include: {
      //   menuItems: true,
      //   orders: true,
      //   reviews: true,
      // }
    })
    
    if (!vendor) throw new AppError(404, "vendor not found");
    return sendSuccess(res, { vendor }, 200);

  } catch (error) {
    handleError(res, error)
  }
  
}

export const getVendors = async (req: Request, res: Response) => {
  try {
    const vendors = await prisma?.vendor.findMany({
    where: {
      isActive: true
    },
    select: {
      id: true,
      businessName: true,
      category: true,
      subcategory: true,
      logoUrl: true,
      rating: true,
    }
  })  

  if(!vendors) throw new AppError(404, "vendors not found");
  return sendSuccess(res, { vendors }, 200)

  } catch (error) {
    handleError(res, error)
  }
}

export const getVendorById = async (req: Request, res: Response) => {
  const { id } = req.params
  if(!id) throw new AppError(400, "id is required");
  try {
    const vendor = await prisma?.vendor.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        businessName: true,
        phoneNumber: true,
        category: true,
        subcategory: true,
        logoUrl: true,
        rating: true,
        isActive: true,
      },
    });

    if(!vendor) throw new AppError(404, "vendor not found");
  } catch (error) {
    handleError(res, error)
  }

}
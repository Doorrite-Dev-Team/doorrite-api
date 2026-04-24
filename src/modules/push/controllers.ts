import prisma from "@config/db";
import { getVapidPublicKey as getKey } from "@lib/utils/vapid";
import { pushService } from "./push.service";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import { Request, Response } from "express";

const VALID_USER_TYPES = ["user", "rider", "vendor"];

export const getVapidPublicKey = async (req: Request, res: Response) => {
  return sendSuccess(res, { publicKey: getKey() });
};

export const subscribeToPush = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");

    let { subscription, userType = "user" } = req.body;

    if (!subscription?.endpoint) {
      throw new AppError(400, "Invalid push subscription");
    }

    if (!VALID_USER_TYPES.includes(userType)) {
      throw new AppError(400, "Invalid userType. Must be user, rider, or vendor");
    }

    const roleToUserType: Record<string, string> = {
      user: "user",
      rider: "rider",
      vendor: "vendor",
      admin: "user",
    };
    
    const actorRole = actor.role || "user";
    const expectedUserType = roleToUserType[actorRole] || "user";
    if (userType !== expectedUserType) {
      throw new AppError(403, "Invalid userType for your role");
    }

    const sub = await pushService.subscribe(actor.id, userType, subscription);

    return sendSuccess(res, { subscription: sub }, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const unsubscribeFromPush = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");

    const { endpoint } = req.body;

    if (!endpoint) {
      throw new AppError(400, "Endpoint is required");
    }

    await pushService.unsubscribe(endpoint);

    return sendSuccess(res, { message: "Unsubscribed successfully" });
  } catch (error) {
    handleError(res, error);
  }
};
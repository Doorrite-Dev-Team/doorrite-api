import { Request } from "express";

export function getActorFromReq(req: Request) {
  return { id: req.user?.sub as string, role: req.user?.role };
}

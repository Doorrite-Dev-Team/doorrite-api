import { Socket } from "socket.io";
import { JwtPayloadShape } from "@config/jwt";

declare module "socket.io" {
  interface Socket {
    user?: JwtPayloadShape;
  }
}

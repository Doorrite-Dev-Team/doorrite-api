import { JwtPayloadShape } from "@config/jwt";


declare global {
  namespace Express {
    interface Request {
      user?: JwtPayloadShape; // Change 'any' to your user type if known
    }
  }
}

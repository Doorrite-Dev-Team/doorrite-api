import { JwtPayloadShape } from "@config/jwt";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayloadShape; // Change 'any' to your user type if known
      vendor?: {
        id: string;
        email: string;
        businessName: string;
        isActive: boolean;
        isVerified: boolean;
      };
      rider?: {
        id: string;
        email: string;
        fullName: string;
        isVerified: boolean;
      };
    }
  }
}

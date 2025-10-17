type User = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  role: "CUSTOMER" | "VENDOR" | "RIDER" | "ADMIN";
  fullName: string;
  email: string;
  phoneNumber: string;
  passwordHash: string;
  profileImageUrl?: string | null;
  address?: {
    address: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };
    state?: string;
    country?: string;
  } | null;
};

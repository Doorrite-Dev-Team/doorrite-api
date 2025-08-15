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
    street: string | null;
    city: string | null;
    state: string | null;
    lga: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
};

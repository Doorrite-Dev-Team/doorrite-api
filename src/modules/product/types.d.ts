interface CreateProductVariant {
  name: string;
  price: number;
  attributes?: Record<string, any>;
  isAvailable?: boolean;
}

interface CreateProductBody {
  name: string;
  description?: string;
  basePrice: number;
  categoryId: string;
  imageUrls?: string[];
  attributes?: Record<string, any>;
  isAvailable?: boolean;
  variants?: CreateProductVariant[];
}

interface UpdateProductBody {
  name?: string;
  description?: string;
  basePrice?: number;
  categoryId?: string;
  imageUrls?: string[];
  attributes?: Record<string, any>;
  isAvailable?: boolean;
}

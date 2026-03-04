export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  unit: string;
  price: number;
  reorderLevel: number;
  controlled: boolean;
  isActive: boolean;
  categoryId: number;
  categoryName: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
}

export interface ProductQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: number;
  locationId?: number;
  includeInactive?: boolean;
}

export interface ProductCreateInput {
  categoryId: number;
  sku: string;
  name: string;
  description?: string;
  unit: string;
  price: number;
  reorderLevel: number;
  controlled: boolean;
  initialStocks?: Array<{
    locationId: number;
    quantity: number;
    unitCost?: number;
  }>;
}

export interface ProductUpdateInput {
  categoryId: number;
  sku: string;
  name: string;
  description?: string;
  unit: string;
  price: number;
  reorderLevel: number;
  controlled: boolean;
  isActive: boolean;
}

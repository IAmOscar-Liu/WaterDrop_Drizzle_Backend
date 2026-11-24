import { desc, eq, ilike, or } from "drizzle-orm";
import * as schema from "../../db/schema";

export interface AdvertisementListFilters {
  sellerId?: string;
  status?: schema.AdvertisementStats["status"];
  productStatus?: schema.Product["status"];
  search?: string;
}

// Both paginated endpoints must apply identical filters and tie-breaking order.
export function advertisementListConditions(input: AdvertisementListFilters) {
  const keyword = input.search?.trim();
  const pattern = keyword ? `%${keyword.replace(/[\\%_]/g, "\\$&")}%` : undefined;
  return [
    input.sellerId ? eq(schema.productTable.sellerId, input.sellerId) : undefined,
    input.status ? eq(schema.advertisementStatsTable.status, input.status) : undefined,
    input.productStatus ? eq(schema.productTable.status, input.productStatus) : undefined,
    pattern ? or(
      ilike(schema.advertisementTable.title, pattern),
      ilike(schema.productTable.name, pattern),
    ) : undefined,
  ];
}

export function advertisementListOrder() {
  return [desc(schema.advertisementTable.createdAt), desc(schema.advertisementTable.id)];
}

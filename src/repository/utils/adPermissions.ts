import type { Account, Advertisement, AdvertisementStats, Product } from "../../db/schema";

/** Permission to fund manually or configure refill, not a guarantee of available funds. */
export function canManageAdFunding(
  actor: Pick<Account, "id" | "role"> | undefined,
  ad: Pick<Advertisement, "archivedAt" | "financiallyClosedAt">,
  product: Pick<Product, "sellerId" | "status" | "deletedAt"> | null | undefined,
  stats: Pick<AdvertisementStats, "status"> | null | undefined,
  seller: Pick<Account, "role" | "status" | "deletedAt"> | null | undefined,
): boolean {
  return !!(actor && product && stats && seller &&
    (actor.role === "admin" || (actor.role === "seller" && actor.id === product.sellerId)) &&
    product.status === "active" && !product.deletedAt &&
    seller.role === "seller" && seller.status === "active" && !seller.deletedAt &&
    ["active", "paused", "depleted"].includes(stats.status) &&
    !ad.archivedAt && !ad.financiallyClosedAt);
}

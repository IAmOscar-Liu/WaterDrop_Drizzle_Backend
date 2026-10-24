import type { listCartItems } from "../repository/cart";

export type CheckoutItem = {
  cartItemId: string;
  productVariantId: string;
  quantity: number;
  expectedUnitPrice: number;
};

const messages = {
  CART_SELECTION_CHANGED: "勾選的商品已變更，請重新確認",
  CART_ITEM_UNAVAILABLE: "購物車項目不存在或不可用",
  CART_ITEM_CHANGED: "商品規格或數量已變更，請重新確認",
  PRODUCT_UNAVAILABLE: "商品不存在、已刪除或未上架",
  VARIANT_UNAVAILABLE: "商品規格不存在或不可用",
  PRICE_CHANGED: "商品價格已變更，請重新確認",
  PRICE_UNAVAILABLE: "無法確認商品價格",
  INSUFFICIENT_STOCK: "庫存不足",
  STOCK_UNAVAILABLE: "無法確認庫存",
} as const;
type IssueCode = keyof typeof messages;
type Issue = { code: IssueCode; message: string };
const issue = (code: IssueCode): Issue => ({ code, message: messages[code] });

/** Pure evaluation of one owned cart snapshot; never reads or mutates storage. */
export function evaluateCheckout(
  requested: CheckoutItem[],
  cartItems: Awaited<ReturnType<typeof listCartItems>>,
) {
  const cartById = new Map(cartItems.map((item) => [item.id, item]));
  const selected = new Set(cartItems.filter((item) => item.checked).map((item) => item.id));
  const issues: Issue[] = [];
  if (selected.size !== requested.length || requested.some((item) => !selected.has(item.cartItemId))) {
    issues.push(issue("CART_SELECTION_CHANGED"));
  }
  const items = requested.map((input) => {
    const row = cartById.get(input.cartItemId);
    const itemIssues: Issue[] = [];
    const product = row?.product;
    const variant = row?.variant;
    const validVariant = !!variant && variant.id === row?.productVariantId && variant.productId === row?.productId;
    const currentUnitPrice = validVariant && Number.isFinite(variant.price) && variant.price >= 0
      ? variant.price : null;
    const availableStock = validVariant && Number.isSafeInteger(variant.stock) && Number.isSafeInteger(variant.reserve)
      && variant.stock >= 0 && variant.reserve >= 0
      ? Math.max(0, variant.stock - variant.reserve) : null;

    if (!row) {
      itemIssues.push(issue("CART_ITEM_UNAVAILABLE"));
    } else {
      if (!row.checked) itemIssues.push(issue("CART_SELECTION_CHANGED"));
      if (row.productVariantId !== input.productVariantId || row.quantity !== input.quantity) {
        itemIssues.push(issue("CART_ITEM_CHANGED"));
      }
      if (!product || product.deletedAt || product.status !== "active") {
        itemIssues.push(issue("PRODUCT_UNAVAILABLE"));
      }
      if (!validVariant || variant.status !== "active") {
        itemIssues.push(issue("VARIANT_UNAVAILABLE"));
      }
      if (currentUnitPrice === null) itemIssues.push(issue("PRICE_UNAVAILABLE"));
      else if (currentUnitPrice !== input.expectedUnitPrice) itemIssues.push(issue("PRICE_CHANGED"));
      if (availableStock === null) itemIssues.push(issue("STOCK_UNAVAILABLE"));
      else if (input.quantity > availableStock) itemIssues.push(issue("INSUFFICIENT_STOCK"));
    }
    return {
      cartItemId: input.cartItemId,
      productId: row?.productId ?? null,
      productVariantId: row?.productVariantId ?? null,
      productName: product?.name ?? null,
      variantName: validVariant ? variant.name : null,
      requestedQuantity: input.quantity,
      currentQuantity: row?.quantity ?? null,
      currentUnitPrice,
      availableStock,
      canCheckout: itemIssues.length === 0,
      issues: itemIssues,
    };
  });
  return { canCheckout: issues.length === 0 && items.every((item) => item.canCheckout), issues, items };
}

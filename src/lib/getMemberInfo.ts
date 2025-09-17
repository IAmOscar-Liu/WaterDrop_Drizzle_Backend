export function getMemberInfo(referralCount?: number) {
  if (typeof referralCount !== "number")
    return { level: "A0", discountRate: 0.2 };
  if (referralCount <= 0) return { level: "A0", discountRate: 0.2 };
  if (referralCount == 1) return { level: "A1", discountRate: 0.22 };
  if (referralCount == 2) return { level: "A2", discountRate: 0.24 };
  if (referralCount == 3) return { level: "A3", discountRate: 0.26 };
  if (referralCount == 4) return { level: "A4", discountRate: 0.28 };
  if (referralCount == 5) return { level: "A5", discountRate: 0.3 };
  if (referralCount == 6) return { level: "A6", discountRate: 0.32 };
  if (referralCount == 7) return { level: "A7", discountRate: 0.34 };
  if (referralCount == 8) return { level: "A8", discountRate: 0.36 };
  if (referralCount == 9) return { level: "A9", discountRate: 0.38 };
  return { level: "A10", discountRate: 0.4 };
}

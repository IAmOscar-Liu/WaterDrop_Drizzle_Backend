export function getMemberInfo(referralCount?: number) {
  if (typeof referralCount !== "number")
    return { level: "A0", discountRage: 0.2 };
  if (referralCount <= 0) return { level: "A0", discountRage: 0.2 };
  if (referralCount == 1) return { level: "A1", discountRage: 0.22 };
  if (referralCount == 2) return { level: "A2", discountRage: 0.24 };
  if (referralCount == 3) return { level: "A3", discountRage: 0.26 };
  if (referralCount == 4) return { level: "A4", discountRage: 0.28 };
  if (referralCount == 5) return { level: "A5", discountRage: 0.3 };
  if (referralCount == 6) return { level: "A6", discountRage: 0.32 };
  if (referralCount == 7) return { level: "A7", discountRage: 0.34 };
  if (referralCount == 8) return { level: "A8", discountRage: 0.36 };
  if (referralCount == 9) return { level: "A9", discountRage: 0.38 };
  return { level: "A10", discountRage: 0.4 };
}

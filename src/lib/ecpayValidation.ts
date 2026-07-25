/**
 * Calculates string length using ECPay rules: Chinese/full-width characters
 * count as 2, other characters count as 1.
 */
export function getEcpayLength(str: string) {
  let length = 0;
  for (let i = 0; i < str.length; i++) {
    length += str.charCodeAt(i) > 255 ? 2 : 1;
  }
  return length;
}

export function hasSpecialChars(str: string) {
  const specialCharRegex = /[\^'`!@#%&*+\\"<>|_\[\]‘”]/;
  return specialCharRegex.test(str);
}

export function hasEmoji(str: string) {
  const emojiRegex = /\p{Emoji}/u;
  return emojiRegex.test(str);
}

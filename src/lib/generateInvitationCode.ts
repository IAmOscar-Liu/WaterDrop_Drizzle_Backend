/**
 * Generates an alphanumeric invitation code.
 * The code can contain uppercase letters, lowercase letters, and numbers.
 *
 * @param length The length of the invitation code. Defaults to 6.
 * @returns {string} An alphanumeric string of the specified length.
 */
export function generateInvitationCode(length: number = 6): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charactersLength);
    result += characters.charAt(randomIndex);
  }

  return result;
}

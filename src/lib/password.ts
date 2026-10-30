/** Mirrors `MIN_MASTER_PASSWORD_LEN` in the Rust vault manager. */
export const MIN_PASSWORD_LENGTH = 10;

export type PasswordStrength = {
  score: number;
  label: string;
};

export function passwordStrength(password: string): PasswordStrength {
  let score = 0;

  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;

  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score] };
}

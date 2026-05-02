// Single source of truth for prototype password strength.
// Production should obviously layer this with hashing + breach checks server-side.

export interface PasswordCheck {
  ok: boolean;
  errors: string[];
}

export const PASSWORD_MIN_LENGTH = 8;

export function checkPassword(input: string): PasswordCheck {
  const errors: string[] = [];
  if (input.length < PASSWORD_MIN_LENGTH) errors.push(`٨ أحرف أو أكثر`);
  if (!/[A-Za-z]/.test(input)) errors.push(`حرف واحد على الأقل`);
  if (!/[0-9]/.test(input)) errors.push(`رقم واحد على الأقل`);
  return { ok: errors.length === 0, errors };
}

/** Render-friendly hint summarising the rule. */
export const PASSWORD_HINT_AR =
  "يجب أن تكون كلمة المرور ٨ أحرف أو أكثر، وتحوي حرفاً ورقماً على الأقل.";

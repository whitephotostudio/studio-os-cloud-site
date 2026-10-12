// Keep signup guidance and password recovery on the same established policy.
const SUPABASE_PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export const PASSWORD_REQUIREMENTS = [
  { key: "length", label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { key: "lower", label: "One lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { key: "upper", label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { key: "number", label: "One number", test: (value: string) => /\d/.test(value) },
  { key: "symbol", label: "One special character", test: (value: string) => Array.from(value).some(character => SUPABASE_PASSWORD_SYMBOLS.includes(character)) },
] as const;

/** Return control to the form when an auth request never settles. */
export async function withAuthRequestTimeout<T>(request: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 15000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Keep useful provider validation errors, but explain transport failures plainly. */
export function authRequestErrorMessage(error: unknown, fallback: string, service: string) {
  if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") return fallback;
  if (("name" in error && error.name === "AuthRetryableFetchError") ||
    /failed to fetch|fetch failed|network (?:request|connection)|load failed|networkerror/i.test(error.message)) {
    return `We could not reach the ${service} service. Check your connection and try again.`;
  }
  return error.message || fallback;
}

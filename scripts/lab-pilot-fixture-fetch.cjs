/* HTTP integration tests only: actual pilot guards, synthetic local providers.
 * Loaded solely by lab-system-fixture --pilot-http through NODE_OPTIONS.
 * This never weakens the application pilot gate or reads a provider credential.
 */
const pilotOrigin = 'https://lgwmxqjwgkzktikhkebp.supabase.co';
const fixtureUrl = process.env.STUDIO_OS_SYNTHETIC_LAB_FIXTURE_URL;
if (process.env.STUDIO_OS_SYNTHETIC_LAB_HTTP !== '1' || !fixtureUrl ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureUrl) || process.env.NODE_ENV === 'production') {
  throw new Error('Synthetic pilot HTTP preload requires the explicit local fixture configuration.');
}
const actualFetch = globalThis.fetch;
globalThis.fetch = function syntheticPilotFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === pilotOrigin) {
    const target = fixtureUrl + url.pathname + url.search;
    return actualFetch(input instanceof Request ? new Request(target, input) : target, { ...init, redirect: 'error' });
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('External provider requests are disabled in the synthetic pilot HTTP fixture.');
  }
  return actualFetch(input, { ...init, redirect: 'error' });
};

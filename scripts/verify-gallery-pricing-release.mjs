import { pathToFileURL } from 'node:url';
import { getPlanDefinitions } from '../lib/studio-pricing.ts';

// Execute in the remote build where the existing secret is available. Only new
// versioned catalog entries can be created; no customer or payment is touched.
export function galleryReleaseEntries() {
  return Object.values(getPlanDefinitions('gallery_v2')).flatMap(plan =>
    ['month', 'year'].map(interval => ({
      lookupKey: `studio-os-${plan.code}-${interval === 'year' ? 'annual' : 'monthly'}-gallery-v2`,
      name: `${plan.publicName} ${interval === 'year' ? 'Annual' : 'Monthly'}`,
      description: `Studio OS ${plan.publicName} ${interval === 'year'
        ? 'annual subscription paid in advance' : 'monthly subscription'}`,
      unitAmount: interval === 'year' ? plan.annualPriceCents : plan.priceCents,
      interval,
      currency: 'cad',
    })));
}

function verifyPrice(price, entry) {
  if (!price || price.object !== 'price' || !/^price_[A-Za-z0-9_]+$/.test(price.id || '')
    || price.lookup_key !== entry.lookupKey || price.active !== true || price.livemode !== true
    || price.currency !== entry.currency || price.unit_amount !== entry.unitAmount
    || price.type !== 'recurring' || price.billing_scheme !== 'per_unit'
    || price.recurring?.interval !== entry.interval || price.recurring?.interval_count !== 1
    || price.recurring?.usage_type !== 'licensed' || price.recurring?.meter != null
    || (price.metadata?.pricing_profile && price.metadata.pricing_profile !== 'gallery_v2')
    || !/^prod_[A-Za-z0-9_]+$/.test(typeof price.product === 'string' ? price.product : '')) {
    throw Error(`Gallery catalog price is incompatible: ${entry.lookupKey}. No lookup keys will be transferred.`);
  }
}

function verifyProduct(product, entry) {
  if (!product || product.object !== 'product' || !/^prod_[A-Za-z0-9_]+$/.test(product.id || '')
    || product.active !== true || product.livemode !== true
    || product.metadata?.lookup_key !== entry.lookupKey
    || (product.metadata?.pricing_profile && product.metadata.pricing_profile !== 'gallery_v2')) {
    throw Error(`Gallery catalog product is incompatible: ${entry.lookupKey}.`);
  }
}

export async function verifyGalleryPricingRelease(env = process.env, fetcher = fetch, report = console.log) {
  if (env.STUDIO_GALLERY_PRICING_V2_ENABLED !== '1') return { skipped: true };
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  const expectedAccount = (env.STUDIO_GALLERY_PRICING_EXPECTED_ACCOUNT_ID || '').trim();
  if (!/^sk_live_[A-Za-z0-9]+$/.test(key)) {
    throw Error('Gallery pricing release requires the existing live Stripe secret in the remote build.');
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) {
    throw Error('Gallery pricing release requires the exact expected platform Stripe account ID.');
  }
  if ((env.STRIPE_BILLING_CURRENCY || 'cad').toLowerCase() !== 'cad') {
    throw Error('Gallery pricing release requires CAD subscription billing.');
  }

  let catalogMutations = 0;
  async function stripe(path, { body, idempotencyKey } = {}) {
    let response;
    try {
      response = await fetcher(`https://api.stripe.com/v1/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Stripe-Version': (env.STRIPE_API_VERSION || '2025-06-30.basil').trim(),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body ? { body: body.toString() } : {}),
        cache: 'no-store', signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw Error('Gallery catalog provider request did not complete; release stopped, details withheld.');
    }
    if (!response.ok) {
      throw Error(`Gallery catalog provider request failed (HTTP ${response.status}); release stopped, details withheld.`);
    }
    let data;
    try { data = await response.json(); }
    catch { throw Error('Gallery catalog provider response could not be verified; release stopped, details withheld.'); }
    if (body) catalogMutations++;
    return data;
  }

  const account = await stripe('account');
  if (account?.object !== 'account' || account.id !== expectedAccount
    || account.charges_enabled !== true || account.payouts_enabled !== true || account.details_submitted !== true
    || account.requirements?.disabled_reason || (account.requirements?.currently_due?.length ?? 0) > 0
    || (account.requirements?.past_due?.length ?? 0) > 0) {
    throw Error('Gallery pricing release platform account does not match or is not ready for payments and payouts.');
  }
  const entries = galleryReleaseEntries();
  const query = new URLSearchParams({ limit: '100' });
  for (const entry of entries) query.append('lookup_keys[]', entry.lookupKey);
  async function readPrices() {
    const list = await stripe(`prices?${query}`);
    if (!list || list.object !== 'list' || !Array.isArray(list.data) || list.has_more !== false) {
      throw Error('Gallery price list could not be verified completely; release stopped.');
    }
    const rows = new Map();
    for (const price of list.data) {
      const entry = entries.find(candidate => candidate.lookupKey === price.lookup_key);
      if (!entry || rows.has(entry.lookupKey)) throw Error('Gallery catalog lookup is unexpected or ambiguous; release stopped.');
      verifyPrice(price, entry);
      rows.set(entry.lookupKey, price);
    }
    // Every existing entry is checked before the first creation, including
    // inactive/malformed prices. A bad sixth entry cannot mutate the first.
    for (const entry of entries) {
      const price = rows.get(entry.lookupKey);
      if (price) verifyProduct(await stripe(`products/${encodeURIComponent(price.product)}`), entry);
    }
    return rows;
  }

  const initialPrices = await readPrices();
  for (const entry of entries) {
    if (initialPrices.has(entry.lookupKey)) continue;
    const product = await stripe('products', {
      body: new URLSearchParams({ name: entry.name, description: entry.description, 'metadata[lookup_key]': entry.lookupKey }),
      idempotencyKey: `studio-os-product-${entry.lookupKey}`,
    });
    verifyProduct(product, entry);
    const price = await stripe('prices', {
      body: new URLSearchParams({ currency: entry.currency, unit_amount: String(entry.unitAmount), product: product.id,
        lookup_key: entry.lookupKey, transfer_lookup_key: 'true', 'recurring[interval]': entry.interval }),
      idempotencyKey: `studio-os-price-${entry.lookupKey}-${entry.unitAmount}`,
    });
    verifyPrice(price, entry);
    if (price.product !== product.id) throw Error('Created Gallery price product could not be verified; release stopped.');
  }
  const verifiedPrices = await readPrices();
  for (const entry of entries) {
    const price = verifiedPrices.get(entry.lookupKey);
    if (!price) throw Error(`Gallery price is still missing after catalog preparation: ${entry.lookupKey}. Release stopped.`);
    report(JSON.stringify({ check: 'gallery-subscription-price', ok: true, accountId: expectedAccount,
      lookupKey: entry.lookupKey, priceId: price.id, unitAmount: price.unit_amount, currency: price.currency,
      interval: price.recurring.interval }));
  }
  report(JSON.stringify({ check: 'gallery-pricing-release', ok: true, verifiedPrices: entries.length,
    catalogMutations, financialMutations: 0, customerMutations: 0 }));
  return { skipped: false, prices: entries.map(entry => verifiedPrices.get(entry.lookupKey).id), catalogMutations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyGalleryPricingRelease().catch(error => {
    console.error('[gallery-pricing-release]', error instanceof Error ? error.message : 'Verification failed; details withheld.');
    process.exitCode = 1;
  });
}

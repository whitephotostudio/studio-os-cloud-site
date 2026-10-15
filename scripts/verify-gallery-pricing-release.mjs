import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { getPlanDefinitions } from '../lib/studio-pricing.ts';
import { SUBSCRIPTION_CURRENCIES, localSubscriptionBillingEnabled,
  subscriptionPlanLookupKey, subscriptionExtraKeyLookupKey } from '../lib/subscription-currency.ts';

// Execute in the remote build where the existing secret is available. Localized
// catalogs are GET-only unless their explicit one-shot preparation flag is set.
export function galleryReleaseEntries(pricingProfile = 'gallery_v2', localized = false) {
  if (!['gallery_v2', 'gallery_v3'].includes(pricingProfile)) throw Error('Unsupported Gallery release profile.');
  if (localized && pricingProfile !== 'gallery_v3') throw Error('Localized subscriptions require the approved Gallery V3 offer.');
  const suffix = pricingProfile.replace('_', '-');
  return (localized ? SUBSCRIPTION_CURRENCIES : ['cad']).flatMap(currency => [
    ...Object.values(getPlanDefinitions(pricingProfile)).flatMap(plan =>
    ['month', 'year'].map(interval => ({
      lookupKey: localized ? subscriptionPlanLookupKey(plan.code, interval, currency)
        : `studio-os-${plan.code}-${interval === 'year' ? 'annual' : 'monthly'}-${suffix}`,
      kind: 'base', planCode: plan.code,
      pricingProfile,
      orderFeeRateCents: plan.usageRateCents,
      orderFeeScope: plan.orderFeeScope,
      name: `${plan.publicName} ${interval === 'year' ? 'Annual' : 'Monthly'}`,
      description: `Studio OS ${plan.publicName} ${interval === 'year'
        ? 'annual subscription paid in advance' : 'monthly subscription'}`,
      unitAmount: interval === 'year' ? plan.annualPriceCents : plan.priceCents,
      interval,
      currency,
    }))),
    ...(localized ? ['month', 'year'].map(interval => ({
      lookupKey: subscriptionExtraKeyLookupKey(interval, currency), kind: 'extra_key', pricingProfile,
      name: interval === 'year' ? 'Extra Desktop Key Annual' : 'Extra Desktop Key Monthly',
      description: interval === 'year' ? 'Additional Studio OS desktop key billed annually in advance'
        : 'Additional Studio OS desktop key billed monthly',
      unitAmount: interval === 'year' ? 59400 : 5500, interval, currency,
    })) : []),
  ]);
}

function verifyPrice(price, entry) {
  if (!price || price.object !== 'price' || !/^price_[A-Za-z0-9_]+$/.test(price.id || '')
    || price.lookup_key !== entry.lookupKey || price.active !== true || price.livemode !== true
    || price.currency !== entry.currency || price.unit_amount !== entry.unitAmount
    || price.type !== 'recurring' || price.billing_scheme !== 'per_unit'
    || price.recurring?.interval !== entry.interval || price.recurring?.interval_count !== 1
    || price.recurring?.usage_type !== 'licensed' || price.recurring?.meter != null
    || ((entry.kind !== 'extra_key' || entry.currency !== 'cad') &&
      price.metadata?.pricing_profile && price.metadata.pricing_profile !== entry.pricingProfile)
    || !/^prod_[A-Za-z0-9_]+$/.test(typeof price.product === 'string' ? price.product : '')) {
    throw Error(`Gallery catalog price is incompatible: ${entry.lookupKey}. No lookup keys will be transferred.`);
  }
}

function verifyProduct(product, entry) {
  if (!product || product.object !== 'product' || !/^prod_[A-Za-z0-9_]+$/.test(product.id || '')
    || product.active !== true || product.livemode !== true
    || product.metadata?.lookup_key !== entry.lookupKey
    || ((entry.kind !== 'extra_key' || entry.currency !== 'cad') &&
      product.metadata?.pricing_profile && product.metadata.pricing_profile !== entry.pricingProfile)) {
    throw Error(`Gallery catalog product is incompatible: ${entry.lookupKey}.`);
  }
}

export async function verifyGalleryPricingRelease(env = process.env, fetcher = fetch, report = console.log) {
  const pricingProfile = env.STUDIO_GALLERY_PRICING_V3_ENABLED === '1' ? 'gallery_v3'
    : env.STUDIO_GALLERY_PRICING_V2_ENABLED === '1' ? 'gallery_v2' : null;
  const localized = localSubscriptionBillingEnabled(env);
  const prepareLocalizedCatalog = env.STUDIO_LOCAL_SUBSCRIPTIONS_CATALOG_PREPARE === '1';
  if (prepareLocalizedCatalog && !localized) throw Error('Localized catalog preparation requires localized subscriptions.');
  if (localized && pricingProfile !== 'gallery_v3') throw Error('Localized subscriptions require the approved Gallery V3 offer.');
  if (!pricingProfile) return { skipped: true };
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  const expectedAccount = (env.STUDIO_GALLERY_PRICING_EXPECTED_ACCOUNT_ID || '').trim();
  if (!/^sk_live_[A-Za-z0-9]+$/.test(key)) {
    throw Error('Gallery pricing release requires the existing live Stripe secret in the remote build.');
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) {
    throw Error('Gallery pricing release requires the exact expected platform Stripe account ID.');
  }
  if ((env.STRIPE_BILLING_CURRENCY || 'cad').toLowerCase() !== 'cad') {
    throw Error('The platform billing default must remain CAD; localized subscriptions use separate versioned prices.');
  }
  const verifyCheckouts = env.STUDIO_GALLERY_PRICING_CHECKOUT_VERIFY === '1';
  const deployment = (env.VERCEL_URL || '').trim();
  if (verifyCheckouts && !/^studio-os-cloud-site-[a-z0-9-]+-whitephotostudio-7289s-projects\.vercel\.app$/.test(deployment)) {
    throw Error('Subscription checkout verification requires this project deployment identity.');
  }

  let catalogMutations = 0;
  let checkoutSessionMutations = 0;
  async function stripe(path, { body, idempotencyKey, mutation = 'catalog' } = {}) {
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
    if (body) {
      if (mutation === 'checkout') checkoutSessionMutations++;
      else catalogMutations++;
    }
    return data;
  }

  const account = await stripe('account');
  if (account?.object !== 'account' || account.id !== expectedAccount
    || account.charges_enabled !== true || account.payouts_enabled !== true || account.details_submitted !== true
    || account.requirements?.disabled_reason || (account.requirements?.currently_due?.length ?? 0) > 0
    || (account.requirements?.past_due?.length ?? 0) > 0) {
    throw Error('Gallery pricing release platform account does not match or is not ready for payments and payouts.');
  }
  if (localized) {
    const balance = await stripe('balance');
    if (balance?.object !== 'balance' || balance.livemode !== true) throw Error('Localized subscription release requires fresh live platform balance proof.');
  }
  const entries = galleryReleaseEntries(pricingProfile, localized);
  async function readPrices() {
    const rows = new Map();
    // Stripe accepts at most ten lookup keys per list request. Finish every
    // batch before considering any creation, so later mismatches stay atomic.
    for (let offset = 0; offset < entries.length; offset += 10) {
      const batch = entries.slice(offset, offset + 10);
      // An inactive lookup is still a conflicting contract. Query it explicitly
      // rather than allowing the provider's active-price default to hide it.
      for (const active of localized ? ['true', 'false'] : [null]) {
        const query = new URLSearchParams({ limit: '100' });
        if (active !== null) query.set('active', active);
        for (const entry of batch) query.append('lookup_keys[]', entry.lookupKey);
        const list = await stripe(`prices?${query}`);
        if (!list || list.object !== 'list' || !Array.isArray(list.data) || list.has_more !== false) {
          throw Error('Gallery price list could not be verified completely; release stopped.');
        }
        for (const price of list.data) {
          const entry = batch.find(candidate => candidate.lookupKey === price.lookup_key);
          if (!entry || rows.has(entry.lookupKey)) throw Error('Gallery catalog lookup is unexpected or ambiguous; release stopped.');
          verifyPrice(price, entry);
          rows.set(entry.lookupKey, price);
        }
      }
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
  if (localized && !prepareLocalizedCatalog && entries.some(entry => !initialPrices.has(entry.lookupKey))) {
    throw Error('Localized subscription catalog is incomplete. Explicit one-shot catalog preparation is required; no catalog writes were performed.');
  }
  for (const entry of entries) {
    if (initialPrices.has(entry.lookupKey)) continue;
    const product = await stripe('products', {
      body: new URLSearchParams({ name: entry.name, description: entry.description, 'metadata[lookup_key]': entry.lookupKey }),
      idempotencyKey: `studio-os-product-${entry.lookupKey}`,
    });
    verifyProduct(product, entry);
    const price = await stripe('prices', {
      body: new URLSearchParams({ currency: entry.currency, unit_amount: String(entry.unitAmount), product: product.id,
        lookup_key: entry.lookupKey, ...(!localized || entry.currency === 'cad' ? { transfer_lookup_key: 'true' } : {}),
        'recurring[interval]': entry.interval }),
      idempotencyKey: `studio-os-price-${entry.lookupKey}-${entry.unitAmount}`,
    });
    verifyPrice(price, entry);
    if (price.product !== product.id) throw Error('Created Gallery price product could not be verified; release stopped.');
  }
  const verifiedPrices = await readPrices();
  for (const entry of entries) {
    const price = verifiedPrices.get(entry.lookupKey);
    if (!price) throw Error(`Gallery price is still missing after catalog preparation: ${entry.lookupKey}. Release stopped.`);
    report(JSON.stringify({ check: entry.kind === 'extra_key' ? 'gallery-extra-key-price' : 'gallery-subscription-price', ok: true, accountId: expectedAccount,
      lookupKey: entry.lookupKey, priceId: price.id, unitAmount: price.unit_amount, currency: price.currency,
      interval: price.recurring.interval, pricingProfile,
      orderFeeRateCents: entry.orderFeeRateCents, orderFeeScope: entry.orderFeeScope }));
  }
  let verifiedCheckouts = 0;
  if (verifyCheckouts) {
    const runKey = createHash('sha256').update(deployment).digest('hex').slice(0, 24);
    for (const entry of entries) {
      const price = verifiedPrices.get(entry.lookupKey);
      const matchingStudio = entry.kind === 'extra_key' ? entries.find(candidate => candidate.kind === 'base'
        && candidate.planCode === 'studio' && candidate.currency === entry.currency && candidate.interval === entry.interval) : null;
      if (entry.kind === 'extra_key' && !matchingStudio) throw Error('Extra-key verification requires its matching Studio currency and cadence.');
      const probeLines = matchingStudio
        ? [{ price: verifiedPrices.get(matchingStudio.lookupKey), amount: matchingStudio.unitAmount }, { price, amount: entry.unitAmount }]
        : [{ price, amount: entry.unitAmount }];
      const expectedAmount = probeLines.reduce((sum, line) => sum + line.amount, 0);
      const key = `studio-os-release-checkout-${runKey}-${entry.lookupKey}`;
      const body = new URLSearchParams({ mode: 'subscription', 'payment_method_types[0]': 'card',
        success_url: 'https://www.studiooscloud.com/pricing?checkout_verification=success',
        cancel_url: 'https://www.studiooscloud.com/pricing?checkout_verification=cancelled',
        'metadata[release_verification]': 'unpaid_checkout_only' });
      for (let index = 0; index < probeLines.length; index++) {
        body.set(`line_items[${index}][price]`, probeLines[index].price.id);
        body.set(`line_items[${index}][quantity]`, '1');
      }
      const created = await stripe('checkout/sessions', {
        body,
        idempotencyKey: key, mutation: 'checkout',
      });
      if (created?.object !== 'checkout.session' || !/^cs_live_[A-Za-z0-9]+$/.test(created.id || '')) {
        throw Error('Subscription checkout creation could not be verified.');
      }
      const sessionPath = `checkout/sessions/${encodeURIComponent(created.id)}`;
      let verified = false;
      try {
        const session = await stripe(sessionPath);
        if (session?.id !== created.id || session.livemode !== true || session.mode !== 'subscription'
          || !['open', 'expired'].includes(session.status) || session.payment_status !== 'unpaid'
          || session.customer != null || session.subscription != null || session.payment_intent != null
          || session.currency !== entry.currency || session.amount_total !== expectedAmount) {
          throw Error('Unpaid subscription checkout has incompatible provider state.');
        }
        const lines = await stripe(`${sessionPath}/line_items?limit=100`);
        if (lines?.object !== 'list' || lines.has_more !== false || lines.data?.length !== probeLines.length
          || new Set(lines.data?.map(item => item.price?.id)).size !== probeLines.length
          || probeLines.some(line => !lines.data.some(item => item.price?.id === line.price.id && item.quantity === 1
            && item.currency === entry.currency && item.amount_total === line.amount))) {
          throw Error('Subscription checkout does not contain the exact advertised price.');
        }
        verified = true;
      } finally {
        const latest = await stripe(sessionPath);
        if (latest?.status === 'open') await stripe(`${sessionPath}/expire`, {
          body: new URLSearchParams(), idempotencyKey: `${key}-expire`, mutation: 'checkout',
        });
        const expired = await stripe(sessionPath);
        if (expired?.status !== 'expired' || expired.payment_status !== 'unpaid'
          || expired.customer != null || expired.subscription != null || expired.payment_intent != null) {
          throw Error('Verification checkout did not expire safely without payment or customer creation.');
        }
      }
      if (verified) verifiedCheckouts++;
      report(JSON.stringify({ check: entry.kind === 'extra_key' ? 'gallery-extra-key-checkout' : 'gallery-subscription-checkout', ok: true,
        lookupKey: entry.lookupKey, unitAmount: entry.unitAmount, checkoutAmount: expectedAmount, currency: entry.currency,
        status: 'expired', financialMutations: 0, customerMutations: 0 }));
    }
  }
  report(JSON.stringify({ check: 'gallery-pricing-release', ok: true, verifiedPrices: entries.length,
    pricingProfile, localizedSubscriptions: localized, localizedCatalogPreparation: prepareLocalizedCatalog,
    verifiedBasePrices: entries.filter(entry => entry.kind === 'base').length,
    verifiedExtraKeyPrices: entries.filter(entry => entry.kind === 'extra_key').length,
    verifiedCheckouts, catalogMutations, checkoutSessionMutations,
    financialMutations: 0, customerMutations: 0 }));
  return { skipped: false, prices: entries.map(entry => verifiedPrices.get(entry.lookupKey).id),
    catalogMutations, verifiedCheckouts, checkoutSessionMutations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyGalleryPricingRelease().catch(error => {
    console.error('[gallery-pricing-release]', error instanceof Error ? error.message : 'Verification failed; details withheld.');
    process.exitCode = 1;
  });
}

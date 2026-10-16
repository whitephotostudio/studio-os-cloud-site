"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ImageIcon, Loader2, Package, Sparkles } from "lucide-react";
import type { LabRounding, LabStarterCollection, LabWorkspace, LabWorkspaceAction } from "@/lib/labs/types";
import { currencyMinorUnits, formatCurrency } from "@/lib/labs/money";
import { LAB_STARTER_COLLECTIONS, normalizedStarterFinish, resolveStarterCollection, starterFinishes, type StarterPreview } from "@/lib/labs/starters";
import { LabDialog } from "./lab-dialog";
import styles from "./labs.module.css";

type CreateAction = Extract<LabWorkspaceAction, { action: "create" }>;
type Props = { workspace: LabWorkspace | null; initialLabId?: string; loading: boolean; busy: boolean; error?: string; beforeOpen?: (open: () => void) => void; onCreate: (action: CreateAction) => Promise<boolean> };
const matchLabel = { matched: "Ready", missing: "Not offered", verification: "Needs lab confirmation", ambiguous: "Multiple matching SKUs" };

/** Bundled blueprints render without waiting for authenticated catalog requests. */
export function LabStarterLibrary(props: Props) {
  const [selected, setSelected] = useState<LabStarterCollection | null>(null);
  const open = (collection: LabStarterCollection) => props.beforeOpen ? props.beforeOpen(() => setSelected(collection)) : setSelected(collection);
  const card = (collection: LabStarterCollection) => <button key={collection.id} className={styles.collectionCard} onClick={() => open(collection)} disabled={props.busy}>
    <span className={styles.collectionIcon}>{collection.packages.length ? <Package size={21} /> : <ImageIcon size={21} />}</span>
    <span className={styles.collectionAudience}>{collection.audience}</span><strong>{collection.name}</strong><span className={styles.collectionDescription}>{collection.description}</span>
    <span className={styles.collectionCardFooter}>{collection.sizes.length} sizes{collection.packages.length ? ` · ${collection.packages.length} ${collection.packages.length === 1 ? "package" : "packages"}` : " · individual products"}<ArrowRight size={15} /></span>
  </button>;
  return <section className={styles.collectionLibrary} aria-labelledby="starter-library-title">
    <div className={styles.collectionHeading}><div><div className={styles.eyebrow}>READY TO MAKE YOUR OWN</div><h2 id="starter-library-title">Start with a collection. Set prices in seconds.</h2><p>Print sizes and packages already laid out. Choose a lab and your markup, then edit anything.</p></div><span className={styles.collectionBadge}><Sparkles size={15} />Built in</span></div>
    <div className={styles.collectionGrid}>{LAB_STARTER_COLLECTIONS.slice(0, 4).map(card)}</div>
    <details className={styles.moreCollections}><summary>More collections <span>Gift Prints · Wall & Gift</span><ChevronDown size={16} /></summary><div className={styles.collectionGrid}>{LAB_STARTER_COLLECTIONS.slice(4).map(card)}</div></details>
    <p className={styles.collectionFootnote}>Suggested collections based on published studio menus. Sizes are in inches; your lab supplies the products and costs. Customize every collection for your clients.</p>
    {selected && <StarterSetup key={selected.id} {...props} collection={selected} onClose={() => setSelected(null)} onCreated={() => setSelected(null)} />}
  </section>;
}

function StarterSetup({ collection, workspace, initialLabId, loading, busy, error, onCreate, onClose, onCreated }: Props & { collection: LabStarterCollection; onClose: () => void; onCreated: () => void }) {
  const [chosenLabId, setLabId] = useState(initialLabId || "");
  const [name, setName] = useState(collection.name);
  const [chosenFinish, setFinish] = useState("");
  const [markup, setMarkup] = useState("100");
  const [rounding, setRounding] = useState<LabRounding>("0.99");
  const lab = workspace?.labs.find(entry => entry.id === chosenLabId) ?? workspace?.labs[0];
  const finishes = lab ? starterFinishes(workspace?.catalog ?? [], lab.id, lab.currency) : [];
  const finish = finishes.find(value => normalizedStarterFinish(value) === normalizedStarterFinish(chosenFinish)) ?? finishes.find(value => normalizedStarterFinish(value) === "lustre") ?? finishes[0] ?? "";
  const numericMarkup = Number(markup), validMarkup = markup.trim() !== "" && Number.isFinite(numericMarkup) && numericMarkup >= 0 && numericMarkup <= 10_000;
  let preview: StarterPreview | null = null, pricingError = "";
  if (lab && validMarkup) {
    try { preview = resolveStarterCollection(collection, workspace?.catalog ?? [], lab.id, lab.currency, finish || "Lustre", numericMarkup, rounding); }
    catch (cause) { pricingError = cause instanceof Error ? cause.message : "Check your markup and rounding."; }
  }
  const completePackages = preview?.packages.filter(pack => pack.available) ?? [];
  const canCreate = !!lab && lab.status !== "paused" && !!name.trim() && name.trim().length <= 100 && !!finish && validMarkup && !!preview?.items.length && !pricingError && !busy;
  const unavailablePackages = collection.packages.length - completePackages.length;
  const printRequirement = (sizeId: string) => collection.sizes.find(size => size.id === sizeId)?.label ?? sizeId;
  return <LabDialog title={collection.name} description="The sizes and packages are ready. Match them to your lab, preview automatic prices, and save a new editable draft." onClose={onClose} wide busy={busy} error={error}>
    <form onSubmit={async event => { event.preventDefault(); if (!canCreate || !lab) return; if (await onCreate({ action: "create", labId: lab.id, name: name.trim(), starter: "blank", templateId: collection.id, templateVersion: collection.version, finish, markupPercent: numericMarkup, rounding })) onCreated(); }}>
      <fieldset className={styles.formFieldset} disabled={busy}>
        <div className={styles.twoColumns}><label className={styles.formLabel}>Choose a lab<select value={lab?.id ?? ""} disabled={!workspace?.labs.length} onChange={event => { setLabId(event.target.value); setFinish(""); }}><option value="" disabled>{loading ? "Loading your labs…" : "No lab available"}</option>{workspace?.labs.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.currency} · {entry.status === "active" ? "Active" : entry.status === "paused" ? "Paused" : "Setup preview"}</option>)}</select></label>
          <label className={styles.formLabel}>Print finish<select value={finish} onChange={event => setFinish(event.target.value)} disabled={!finishes.length}><option value="" disabled>{finishes.length ? "Choose finish" : "Awaiting verified print catalog"}</option>{finishes.map(value => <option key={value}>{value}</option>)}</select></label></div>
        <label className={styles.formLabel}>New price sheet name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
        <div className={styles.collectionPricing}><label className={styles.formLabel}>Markup on lab cost (%)<input type="number" inputMode="decimal" min="0" max="10000" step="any" value={markup} onChange={event => setMarkup(event.target.value)} /></label><label className={styles.formLabel}>Round prices<select value={rounding} onChange={event => setRounding(event.target.value as LabRounding)}><option value="none">Keep exact amount</option><option value="nearest-dollar">Nearest whole currency unit</option><option value="0.99">{lab && currencyMinorUnits(lab.currency) === 0 ? "Whole units (currency default)" : "Round up to .99"}</option></select></label></div>
        <p className={styles.smallNote}>100% markup means 2× lab cost; 200% means 3×. This is a starting setting, not a market price or profit margin. {lab ? `All prices below are ${lab.currency}. No currency conversion.` : "Prices appear when a lab confirms matching products."} Shipping, tax and other costs are separate.</p>
        {(!validMarkup || pricingError) && <div className={styles.error} role="alert">{pricingError || "Enter a markup between 0% and 10000%."}</div>}
        <div className={styles.collectionMatchSummary} role="status"><CheckCircle2 size={19} /><div><strong>{loading && !workspace ? "Browse now while your catalog loads" : `${preview?.counts.matched ?? 0} of ${collection.sizes.length} sizes ready${lab ? ` at ${lab.name}` : ""}`}</strong><span>{preview ? `${preview.counts.missing} not offered · ${preview.counts.verification} need confirmation · ${preview.counts.ambiguous} need SKU review` : "Every size and package stays visible below."}</span>{collection.packages.length > 0 && <span>{completePackages.length} of {collection.packages.length} complete packages ready. {unavailablePackages > 0 ? "Incomplete packages are not added to the draft." : ""}</span>}</div></div>
        <h3 className={styles.collectionSubheading}>Individual print sizes</h3>
        <div className={styles.collectionSizes}>{collection.sizes.map(size => { const match = preview?.sizes.find(entry => entry.size.id === size.id); return <div key={size.id} className={styles.collectionSize}><div><strong>{size.label}<small> inches</small></strong><span>{match?.product ? `${match.product.finish} · SKU ${match.product.sku}` : match ? matchLabel[match.status] : "Awaiting lab catalog"}</span></div><div>{match?.retailCents != null && lab ? <><strong>{formatCurrency(match.retailCents, lab.currency)} retail</strong><span>{formatCurrency(match.product!.costCents!, lab.currency)} lab cost</span></> : <span className={styles.collectionUnavailable}>Unavailable</span>}</div></div>; })}</div>
        {collection.packages.length > 0 && <><h3 className={styles.collectionSubheading}>Packages included</h3><div className={styles.collectionPackageGrid}>{collection.packages.map(pack => { const match = preview?.packages.find(entry => entry.id === pack.id); return <article key={pack.id} className={styles.collectionPackage}><div><Package size={19} /><h4>{pack.name}</h4></div><ul>{pack.items.map(item => <li key={item.sizeId}>{item.quantity} × {printRequirement(item.sizeId)} print{item.quantity === 1 ? "" : "s"}</li>)}</ul><strong>{match?.available && lab ? `${formatCurrency(match.retailCents!, lab.currency)} retail` : "Awaiting all matching sizes"}</strong>{match?.available && lab && <span>{formatCurrency(match.costCents!, lab.currency)} lab cost · {formatCurrency(match.retailCents! - match.costCents!, lab.currency)} before other costs</span>}</article>; })}</div></>}
        <div className={styles.collectionNotes}>{collection.notes.map(note => <p key={note}>{note}</p>)}<p>You can change every price and package after creating the draft.</p></div>
        {!preview?.items.length && <p className={styles.collectionHold}>This collection is ready to browse. Creating its price sheet needs at least one exact, approved product in the selected finish, confirmed as one physical print per priced unit. Your lab can upload its catalog for confirmation; GTA reference examples stay unavailable here.</p>}
        {lab?.status === "paused" && <p className={styles.collectionHold}>This lab is paused. Choose an available lab to create a new draft.</p>}
        <div className={styles.dialogFooter}><button type="button" className={styles.secondary} onClick={onClose}>Close preview</button><button className={styles.primary} disabled={!canCreate}>{busy ? <Loader2 className={styles.spin} size={16} /> : <Sparkles size={16} />}{busy ? "Creating draft…" : `Create draft${preview?.items.length ? ` · ${preview.items.length} sizes${completePackages.length ? ` + ${completePackages.length} packages` : ""}` : ""}`}</button></div>
      </fieldset>
    </form>
  </LabDialog>;
}

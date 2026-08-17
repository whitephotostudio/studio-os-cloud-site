"use client";

import Image from "next/image";
import Link from "next/link";
import { Download, Grid2X2, Heart, LockKeyhole, ShoppingBag, X } from "lucide-react";
import { useState } from "react";

const demoPhotos = [
  { id: "portrait-1", src: "/marketing/portrait-gallery-01.png", alt: "Studio portrait demo image one" },
  { id: "portrait-2", src: "/marketing/portrait-gallery-02.png", alt: "Studio portrait demo image two" },
  { id: "portrait-3", src: "/marketing/portrait-gallery-03.png", alt: "Studio portrait demo image three" },
  { id: "portrait-4", src: "/marketing/portrait-gallery-04.png", alt: "Studio portrait demo image four" },
  { id: "portrait-5", src: "/marketing/portrait-gallery-05.png", alt: "Studio portrait demo image five" },
];

export function GalleryDemoExperience() {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const activePhoto = demoPhotos.find((photo) => photo.id === activeId) ?? null;

  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setNotice("");
  }

  return (
    <div className="min-h-screen bg-[#f5f2ed] text-neutral-950">
      <header className="border-b border-black/10 bg-white/90 px-4 py-5 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Interactive Sample · Fictional Content</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">The Morgan Portrait Session</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2">
              <LockKeyhole className="h-4 w-4" /> Private-style access
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2">
              <Heart className="h-4 w-4" /> {favorites.length} favorite{favorites.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] bg-neutral-950 px-6 py-10 text-white shadow-2xl sm:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">Client Gallery Demo</p>
          <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Preview, favorite, and open a photograph.</h2>
          <p className="mt-5 max-w-3xl text-base leading-8 text-white/65">
            This safe demonstration uses marketing images only. It does not contain a real client, student roster, order, or private gallery.
          </p>
        </section>

        <div className="mt-8 flex flex-col gap-4 rounded-[1.25rem] border border-black/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
            <Grid2X2 className="h-4 w-4" /> Gallery view · {demoPhotos.length} photographs
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setNotice("Downloads are disabled in this public demo. A real photographer controls download permission.")} className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold">
              <Download className="h-4 w-4" /> Download
            </button>
            <button type="button" onClick={() => setNotice("Ordering is demonstrated without a checkout. Real galleries use the photographer’s packages and Stripe payment flow.")} className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-sm font-semibold text-white">
              <ShoppingBag className="h-4 w-4" /> View products
            </button>
          </div>
        </div>

        {notice ? (
          <div role="status" className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><X className="h-4 w-4" /></button>
          </div>
        ) : null}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {demoPhotos.map((photo, index) => {
            const isFavorite = favorites.includes(photo.id);
            return (
              <article key={photo.id} className={`group relative overflow-hidden rounded-[1.5rem] bg-neutral-200 shadow-sm ${index === 0 ? "sm:col-span-2 lg:col-span-2" : ""}`}>
                <button type="button" onClick={() => setActiveId(photo.id)} className={`relative block w-full ${index === 0 ? "aspect-[16/9]" : "aspect-[4/5]"}`} aria-label={`Open ${photo.alt}`}>
                  <Image src={photo.src} alt={photo.alt} fill priority={index === 0} sizes={index === 0 ? "(max-width: 1023px) 100vw, 850px" : "(max-width: 639px) 100vw, 420px"} className="object-cover transition duration-700 group-hover:scale-[1.03]" />
                </button>
                <button type="button" onClick={() => toggleFavorite(photo.id)} aria-pressed={isFavorite} aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"} className={`absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition ${isFavorite ? "bg-red-600 text-white" : "bg-white/90 text-neutral-950 hover:bg-white"}`}>
                  <Heart className={`h-5 w-5 ${isFavorite ? "fill-current" : ""}`} />
                </button>
              </article>
            );
          })}
        </section>

        <section className="mt-10 flex flex-col gap-6 rounded-[2rem] border border-neutral-200 bg-white p-7 shadow-sm sm:p-9 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Build your own protected gallery workflow.</h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-neutral-600">Start with the full launch trial, then choose the plan that matches your studio.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up" data-marketing-event="cta_start_trial" data-marketing-label="Interactive gallery demo" data-marketing-placement="gallery_demo" className="inline-flex items-center justify-center rounded-full bg-neutral-950 px-5 py-3 font-semibold text-white">Start 30-Day Trial</Link>
            <Link href="/sample-galleries" className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-5 py-3 font-semibold">Back to Showroom</Link>
          </div>
        </section>
      </main>

      {activePhoto ? (
        <div role="dialog" aria-modal="true" aria-label="Photograph preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setActiveId(null)}>
          <button type="button" onClick={() => setActiveId(null)} aria-label="Close preview" className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-950"><X className="h-5 w-5" /></button>
          <div className="relative h-[82vh] w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <Image src={activePhoto.src} alt={activePhoto.alt} fill sizes="100vw" className="object-contain" priority />
          </div>
        </div>
      ) : null}
    </div>
  );
}

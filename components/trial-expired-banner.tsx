"use client";

import { useState } from "react";
import { X } from "lucide-react";

export function TrialExpiredBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="mx-auto mb-8 max-w-3xl px-6">
      <div className="relative rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5 text-center shadow-sm">
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-3 top-3 rounded-full p-1 text-amber-500 transition hover:bg-amber-100 hover:text-amber-700"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-lg font-semibold text-amber-900">
          Your free trial has ended
        </p>
        <p className="mt-2 text-sm leading-6 text-amber-800">
          Thanks for trying Studio OS Cloud! To keep using your galleries,
          school workflows, and photographer tools, please choose a plan below.
        </p>
      </div>
    </div>
  );
}

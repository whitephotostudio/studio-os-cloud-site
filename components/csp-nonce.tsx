"use client";

import { createContext, useContext } from "react";

const CspNonceContext = createContext<string | undefined>(undefined);

export function CspNonceProvider({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  return <CspNonceContext.Provider value={nonce}>{children}</CspNonceContext.Provider>;
}

export function useCspNonce() {
  return useContext(CspNonceContext);
}

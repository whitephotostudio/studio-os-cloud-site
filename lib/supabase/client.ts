import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Use the implicit flow so email confirmation links work even when
        // the user signs up on one device (desktop) and clicks the link
        // on another (phone). PKCE requires the same browser/storage that
        // initiated the signup, which breaks the cross-device flow.
        flowType: "implicit",
      },
    },
  );
}

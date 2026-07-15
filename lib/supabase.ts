import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// The UI is fully previewable without keys. Add the two public env vars to turn on live auth/data.
export const supabase = url && publishableKey ? createClient(url, publishableKey) : null;

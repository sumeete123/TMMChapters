// Single source of truth for the response security headers.
//
// Both deployment targets set these: `next.config.ts` for the Vercel/Next build
// and `worker/index.ts` for the Cloudflare Worker build. They used to carry
// separate copies of the policy, so a change applied to one silently left the
// other behind. Import from here instead of restating the policy.

// The Supabase origin is needed for API and realtime traffic only. Event photos
// are emailed to the national team rather than uploaded, so the page loads no
// remote images and img-src stays closed to third-party origins.
export const SUPABASE_ORIGIN = "https://fvkkamxonsygjlhabsqb.supabase.co";

const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline' is required by the framework's inline hydration bootstrap.
  // Removing it needs per-request nonces wired through the document response.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_ORIGIN.replace("https://", "wss://")} https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const securityHeaders: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

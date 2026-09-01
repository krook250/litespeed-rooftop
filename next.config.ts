import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Next's default is 1MB, and it is enforced by *throwing* before the
       * action runs — which Next renders as a full-page "A server error
       * occurred", not as an error the form can show. On 1 Sep 2026 that turned
       * "your logo is a bit big" into a crashed admin page on /admin/website.
       *
       * 4.5MB is the ceiling Vercel puts on a request body, so this lines the
       * framework up with the platform rather than inventing a second, lower
       * cliff. It is a backstop, not a licence: every upload path downscales in
       * the browser first (`prepare-logo.ts` for logos, `prepareForUpload` for
       * photographs) and the server still enforces its own per-kind limit
       * (`MAX_LOGO_BYTES`), which is the one that produces a sentence a dealer
       * can act on. Raising this only means the sentence gets a chance to run.
       */
      bodySizeLimit: '4.5mb',
    },
  },
};

export default nextConfig;

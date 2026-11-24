import { env } from "@/lib/env";

export const APP_NAME = "env-typegen";
export const APP_DESCRIPTION =
  "Generate TypeScript types, Zod schemas, t3-env configs, and declaration files from your .env.example — in one command.";
export const APP_VERSION = "0.1.0";

// BCP 47 language tag used for the `lang` attribute in layout.tsx and global-error.tsx.
// Update this when changing the app's locale — e.g. "es", "fr", "pt".
// For multi-locale (i18n) support, see ## Internationalization in .github/copilot-instructions.md
// and .github/instructions/i18n.instructions.md for the full Tier 2 / Tier 3 setup guide.
export const APP_LOCALE = "en";

export const SITE_URL = new URL(env.NEXT_PUBLIC_APP_URL).origin;

// External links
export const GITHUB_URL = "https://github.com/xabierlameiro/env-typegen";
export const LINKEDIN_URL = "https://www.linkedin.com/in/xlameiro/";
export const NPM_URL = "https://www.npmjs.com/package/@xlameiro/env-typegen";

export const ROUTES = {
  home: "/",
  about: "/about",
  contact: "/contact",
  privacy: "/privacy",
} as const;

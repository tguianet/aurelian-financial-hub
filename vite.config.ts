// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    // The hosted production builder currently exposes the server-side Cloud
    // binding but omits its VITE_* aliases from browser chunks. These values
    // are intentionally public (project API URL + publishable browser key), so
    // define them here to keep production auth independent of that aliasing.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        "https://ttdptefgoooenpuicxvv.supabase.co",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        "sb_publishable_I4RBxRqlQhvMRiLK6v-yYA_pz74xbWu",
      ),
    },
    build: {
      // Avoid shipping syntax that older iOS Safari / Android WebViews may not parse.
      target: "es2020",
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // Keep the custom API entry isolated and force Vite to rebuild it after schema/route updates.
    server: { entry: "server" },
  },
});

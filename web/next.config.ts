import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume the workspace sync contract (@curfew/shared) directly from source.
  // IMPORTANT: this is the Vercel cloud app — keep default SSR/ISR output.
  // Do NOT set `output: 'export'` here (that constraint is only for a
  // Tauri-hosted frontend, which web/ is not).
  transpilePackages: ["@curfew/shared"],
};

export default nextConfig;

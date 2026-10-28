import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The container image copies .next/standalone and runs `node server.js`,
  // so node_modules never ships. See README section 6.2.
   output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;

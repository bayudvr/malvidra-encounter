import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @3d-dice/dice-box ships modern ESM with relative dynamic imports for its
  // Babylon world + web workers; let Next process it.
  transpilePackages: ["@3d-dice/dice-box"],
  webpack: (config) => {
    // react-konva lists `canvas` as an optional dep for Node-side rendering.
    // We only render Konva on the client (dynamic import, ssr:false), so stub it.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // react-konva lists `canvas` as an optional dep for Node-side rendering.
    // We only render Konva on the client (dynamic import, ssr:false), so stub it.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so a stray lockfile in a parent directory is ignored.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

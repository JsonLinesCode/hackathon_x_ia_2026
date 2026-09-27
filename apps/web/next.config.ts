import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/ui", "@repo/core", "@repo/types"],
  experimental: {
    cpus: 1
  }
};

export default nextConfig;

import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: process.env.VERCEL ? "./tsconfig.vercel.json" : "./tsconfig.json",
  },
  async headers() {
    return [{ source: "/(.*)", headers: [...securityHeaders] }];
  },
};

export default nextConfig;

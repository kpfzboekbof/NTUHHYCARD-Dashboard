import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // ioredis is not in Next's default opt-out list, so it was being bundled
  // into every route handler. It is a plain Node dependency — leave it external.
  serverExternalPackages: ["ioredis"],
};

export default nextConfig;

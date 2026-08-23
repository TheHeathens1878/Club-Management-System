/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source; Next must compile them.
  transpilePackages: ["@club/shared", "@club/db", "@club/fulltime"],
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  // P3.4 cutover: /recruitment was the pitch-booking site's public entry point
  // for the player waiting list. It stays a permanent redirect so links in
  // print, on social media and in old emails keep working after DNS repoints.
  async redirects() {
    return [{ source: "/recruitment", destination: "/waiting-list", permanent: true }];
  },
};

export default nextConfig;

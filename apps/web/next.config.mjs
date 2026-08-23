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
  // Gap 10: /recruitment was a permanent redirect to /waiting-list during the
  // P3.4 cutover, when there was no page to send people to. It is now a real
  // public page again — the teams that are recruiting, each with a link into
  // the waiting list form for its age group — so the redirect is gone and the
  // old printed and social links land where they used to.
};

export default nextConfig;

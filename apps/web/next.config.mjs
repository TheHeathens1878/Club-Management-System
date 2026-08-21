/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@club/shared", "@club/db"],
};

export default nextConfig;

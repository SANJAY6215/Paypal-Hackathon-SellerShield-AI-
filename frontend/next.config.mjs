// API_URL may be a full URL or a bare host[:port] (Render private-network hostport)
const rawApi = process.env.API_URL || 'http://localhost:4000';
const API = /^https?:\/\//.test(rawApi) ? rawApi : `http://${rawApi}`;
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() { return [{ source: '/api/:path*', destination: `${API}/api/:path*` }]; },
};
export default nextConfig;

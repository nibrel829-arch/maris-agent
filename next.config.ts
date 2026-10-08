import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The App Router dev server accepts proxied preview hosts (https://{port}-{sandbox}.e2b.app).
  // Production domains are configured in Vercel; no host allowlist is enforced here.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Preview hosts embed the app cross-origin. SAMEORIGIN would blank that frame.
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
    ];
  },
};

export default nextConfig;

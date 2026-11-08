import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SellerShield AI - Attack. Discover. Defend. Verify.',
  description: 'Autonomous multi-agent commerce attack and defence intelligence platform for merchants.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-ink">{children}</body>
    </html>
  );
}

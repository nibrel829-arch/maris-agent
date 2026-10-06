import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nibrexo — CEO Operating Cockpit',
  description:
    'Nibrexo’s personal CEO operating cockpit: one central Manager for priorities, research, product, marketing, operations and quality control.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

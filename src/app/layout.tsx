import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nibrexo OS AI — CEO / Manager Agent',
  description:
    'One central autonomous Manager for Nibrexo: strategy, research, product, content, marketing, sales, operations and quality control.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

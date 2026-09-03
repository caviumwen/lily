import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://lilyplan.vip'),
  title: 'LilyPlan · 私人保障方案',
  description: '通过专属访问码安全查看您的保险评估、报价与方案附件。',
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'LilyPlan · 私人保障方案',
    description: '通过专属访问码安全查看您的保险评估、报价与方案附件。',
    type: 'website',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LilyPlan · 私人保障方案',
    description: '通过专属访问码安全查看您的保险评估、报价与方案附件。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

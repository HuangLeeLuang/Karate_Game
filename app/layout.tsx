import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://neon-karate-city-dojo.chwad6.chatgpt.site'),
  title: 'Neon Karate // 城市道場',
  description: '可切換拳腳與限量手槍、一路迎戰普通敵人直到最終 Boss 的現代都市空手道遊戲。',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Neon Karate',
  },
  openGraph: {
    title: 'Neon Karate // 城市道場',
    description: '選擇男女角色，切換拳腳與手槍，一路迎戰普通敵人直到最終 Boss。',
    images: [{ url: '/og.png', alt: 'Neon Karate 城市道場霓虹都市對戰' }],
    locale: 'zh_TW',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Neon Karate // 城市道場',
    description: '選擇男女角色，切換拳腳與手槍，一路迎戰普通敵人直到最終 Boss。',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#020617',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}

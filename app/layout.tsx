import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
    // Resolve deployment settings at request time rather than baking localhost into the image.
    await headers();
    let origin = 'http://localhost:3000';
    try { const configured = new URL(process.env.SITE_ORIGIN || origin); if (['https:', 'http:'].includes(configured.protocol)) origin = configured.origin; } catch {}
    const title = '22nd Drop Regiment | PORTAL';
    const description = 'Portal Management for the 22nd Elysian Drop Regiment.';
    return {
        metadataBase: new URL(origin), title, description,
        openGraph: { type: 'website', locale: 'en_GB', siteName: '22nd Drop Regiment', title, description, images: [{url:'/share-preview.png',width:1200,height:630,alt:'22nd Drop Regiment — ORBAT, regiment ledger and operation archive'}] },
        twitter: { card: 'summary_large_image', title, description, images: ['/share-preview.png'] },
        icons: { icon: '/regiment-logo-transparent.png', shortcut: '/regiment-logo-transparent.png' },
    };
}
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
    return <html lang="en"><body className="antialiased">{children}</body></html>;
}

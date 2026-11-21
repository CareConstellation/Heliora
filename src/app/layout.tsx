import './globals.css';
import { headers } from 'next/headers';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Providers } from '@/context/Providers';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const nonce = headerList.get('x-nonce') || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {nonce && <meta name="csp-nonce" content={nonce} />}
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}

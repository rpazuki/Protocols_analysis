import type { Metadata } from 'next';
import './globals.css';
import { config } from '../server/config.ts';
import { getPrincipalSafe } from '../server/auth/principal.ts';
import { SiteHeader } from '../components/SiteHeader.tsx';

export const metadata: Metadata = {
  title: config.appName,
  description: 'Internal lab app for recording daily protocol variations and outcomes.',
  robots: { index: false, follow: false },
};

// Every page reads the session, so nothing here can be statically rendered.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipalSafe();

  return (
    <html lang="en-GB">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        {config.environmentLabel ? (
          <div className="env-banner" role="status">
            {config.environmentLabel} environment - not the production lab record
          </div>
        ) : null}

        <SiteHeader principal={principal} appName={config.appName} />

        <main id="main">{children}</main>

        <footer className="site-footer">
          <p>
            {config.appName} - internal lab use only. Do not enter patient-identifiable or
            participant-identifiable information.
          </p>
        </footer>
      </body>
    </html>
  );
}

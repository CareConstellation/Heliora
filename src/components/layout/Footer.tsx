import Link from 'next/link';
import { Activity } from 'lucide-react';

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const cols = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'How It Works', href: '/#how-it-works' },
      { label: 'Network', href: '/#stats' },
      { label: 'Security', href: '/security' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'API Reference', href: '/docs/api' },
      { label: 'Smart Contracts', href: '/docs/contracts' },
      { label: 'GitHub', href: 'https://github.com/CareConstellation/Heliora' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Blog', href: '/blog' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

export default function Footer() {
  return (
    <footer
      style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'var(--bg-raised)' }}
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-14">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5 mb-4">
              <div
                className="w-8 h-8 rounded-[9px] flex items-center justify-center"
                style={{
                  background: 'rgba(0,200,150,0.1)',
                  border: '1px solid rgba(0,200,150,0.2)',
                }}
              >
                <Activity className="w-4 h-4" style={{ color: '#00C896' }} />
              </div>
              <span className="font-bold text-text-1">
                Heli<span style={{ color: '#00C896' }}>ora</span>
              </span>
            </Link>
            <p className="text-text-2 text-sm leading-relaxed max-w-[200px]">
              Sovereign health records on the Stellar blockchain. No passwords. No middlemen.
            </p>
            <div className="flex items-center gap-2 mt-5">
              {[
                { icon: GithubIcon, href: 'https://github.com/CareConstellation/Heliora' },
                { icon: TwitterIcon, href: 'https://twitter.com' },
              ].map(({ icon: Icon, href }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-text-3 hover:text-text-1 transition-colors"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {cols.map((col) => (
            <div key={col.title}>
              <p className="text-text-1 text-xs font-semibold tracking-wide uppercase mb-4">
                {col.title}
              </p>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-text-2 hover:text-text-1 transition-colors duration-150"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div
          className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <p className="text-text-3 text-xs">
            © {new Date().getFullYear()} Heliora. All rights reserved.
          </p>
          <div className="flex items-center gap-1.5 text-xs text-text-3">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" />
            Stellar Testnet — 3s finality
          </div>
        </div>
      </div>
    </footer>
  );
}

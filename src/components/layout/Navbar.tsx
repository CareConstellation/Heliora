'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Activity, Menu, X } from 'lucide-react';

const navLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How It Works' },
  { href: '/#stats', label: 'Network' },
  { href: '/docs', label: 'Docs' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-surface-base/80 backdrop-blur-xl" />

      <nav className="relative max-w-7xl mx-auto px-5 sm:px-8 h-[60px] flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div
            className="relative w-8 h-8 rounded-[9px] flex items-center justify-center overflow-hidden"
            style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)' }}
          >
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  'radial-gradient(circle at 50% 50%, rgba(0,200,150,0.2), transparent 70%)',
              }}
            />
            <Activity className="w-4 h-4 relative z-10" style={{ color: '#00C896' }} />
          </div>
          <span className="text-base font-bold tracking-tight text-text-1">
            Heli<span style={{ color: '#00C896' }}>ora</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <ul className="hidden md:flex items-center gap-0.5">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-sm font-medium px-3.5 py-2 rounded-lg text-text-2 hover:text-text-1 transition-colors duration-150 block"
                style={{ '--tw-text-opacity': '1' } as React.CSSProperties}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{
              background: 'rgba(0,200,150,0.08)',
              border: '1px solid rgba(0,200,150,0.15)',
              color: '#00C896',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" />
            Testnet
          </div>
          <Link href="/login" className="btn-primary rounded-[9px] text-sm px-4 py-2 font-semibold">
            Launch App
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="md:hidden p-2 rounded-lg text-text-2 hover:text-text-1 hover:bg-surface-inset transition-colors"
          aria-label="Toggle menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div
          className="md:hidden relative border-t bg-surface-raised"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div className="px-5 py-4 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="nav-item text-sm"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div
            className="px-5 pb-5 pt-2 border-t"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="btn-primary w-full rounded-[9px] text-sm py-2.5 justify-center"
            >
              Launch App
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

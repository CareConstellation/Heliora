'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  User,
  Stethoscope,
  Hospital,
  ChevronRight,
  ShieldCheck,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Wallet,
  AlertCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useWalletStore } from '@/store/useWalletStore';
import { ROLE_DASHBOARD_MAP } from '@/hooks/useRoleRedirect';

type Role = 'PATIENT' | 'DOCTOR' | 'HOSPITAL';

const roles = [
  {
    id: 'PATIENT' as Role,
    icon: User,
    label: 'Patient',
    description: 'Manage your own medical records and control who can access your health data.',
    features: ['View & download records', 'Grant access to doctors', 'Appointment history'],
  },
  {
    id: 'DOCTOR' as Role,
    icon: Stethoscope,
    label: 'Doctor',
    description:
      'Access authorized patient records and update diagnoses with on-chain verification.',
    features: ['Access patient records', 'Add diagnoses & notes', 'Manage appointments'],
  },
  {
    id: 'HOSPITAL' as Role,
    icon: Hospital,
    label: 'Hospital',
    description: 'Manage institutional access, department permissions, and compliance reporting.',
    features: ['Department management', 'Staff credentials', 'Compliance reports'],
  },
];

const wallets = [
  { id: 'freighter', label: 'Freighter', description: 'Official Stellar browser extension' },
  { id: 'xbull', label: 'xBull Wallet', description: 'Feature-rich Stellar wallet' },
  { id: 'lobstr', label: 'LOBSTR', description: 'Mobile & web Stellar wallet' },
];

const trustPoints = [
  'Non-custodial — we never hold your keys',
  'Transactions signed locally in your wallet',
  'Only your public key is read on-chain',
];

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { publicKey, role: walletRole } = useWalletStore();
  const [step, setStep] = useState<'role' | 'wallet'>('role');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [lastWallet, setLastWallet] = useState<string | null>(null);

  useEffect(() => {
    if (publicKey && walletRole) {
      router.replace(ROLE_DASHBOARD_MAP[walletRole] ?? '/dashboard/patient');
    }
  }, [publicKey, walletRole, router]);

  function handleRoleSelect(role: Role) {
    setSelectedRole(role);
    setStep('wallet');
  }

  async function handleWalletConnect(walletId: string) {
    setConnecting(walletId);
    setConnectError(null);
    setLastWallet(walletId);
    try {
      await new Promise((r) => setTimeout(r, 1800));
      router.push(selectedRole === 'DOCTOR' ? '/dashboard/doctor' : '/dashboard/patient');
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Wallet connection rejected. Please try again.';
      toast(message, 'error');
      setConnectError(message);
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2" style={{ background: 'var(--bg-base)' }}>
      {/* ── Left panel — branding ──────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: 'var(--bg-raised)', borderRight: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Glow */}
        <div
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 20% 20%, rgba(0,200,150,0.08) 0%, transparent 60%)',
          }}
        />
        <div className="absolute inset-0 dot-grid opacity-30 pointer-events-none" />

        {/* Logo */}
        <Link href="/" className="relative inline-flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center"
            style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)' }}
          >
            <Activity className="w-5 h-5" style={{ color: '#00C896' }} />
          </div>
          <span className="font-bold text-lg text-text-1">
            Heli<span style={{ color: '#00C896' }}>ora</span>
          </span>
        </Link>

        {/* Center content */}
        <div className="relative">
          <p className="eyebrow mb-4">Decentralized Healthcare</p>
          <h2 className="text-3xl font-bold tracking-tight text-text-1 leading-snug mb-5">
            Your medical records,
            <br />
            <span style={{ color: '#00C896' }}>secured on-chain.</span>
          </h2>
          <p className="text-text-2 text-sm leading-relaxed mb-8 max-w-xs">
            No passwords. No centralized databases. Your Stellar wallet is your identity and the
            blockchain is your medical record vault.
          </p>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { val: '3–5s', label: 'Settlement time' },
              { val: '$0.00001', label: 'Per transaction' },
              { val: '100%', label: 'Data sovereignty' },
              { val: '99.99%', label: 'Network uptime' },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl p-4"
                style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <p className="text-xl font-bold mb-0.5" style={{ color: '#00C896' }}>
                  {s.val}
                </p>
                <p className="text-xs text-text-3">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <p className="relative text-xs text-text-3">Powered by the Stellar blockchain · Testnet</p>
      </div>

      {/* ── Right panel — form ─────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center px-6 py-16 lg:py-10">
        {/* Mobile logo */}
        <Link href="/" className="lg:hidden inline-flex items-center gap-2.5 mb-10">
          <div
            className="w-8 h-8 rounded-[9px] flex items-center justify-center"
            style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)' }}
          >
            <Activity className="w-4 h-4" style={{ color: '#00C896' }} />
          </div>
          <span className="font-bold text-text-1">
            Heli<span style={{ color: '#00C896' }}>ora</span>
          </span>
        </Link>

        <div className="w-full max-w-md">
          {/* Step progress */}
          <div className="flex items-center gap-2 mb-8">
            {['Select Role', 'Connect Wallet'].map((label, i) => {
              const done = i === 0 && step === 'wallet';
              const active = (i === 0 && step === 'role') || (i === 1 && step === 'wallet');
              return (
                <div key={label} className="flex items-center gap-2 flex-1">
                  <div className="flex items-center gap-2 shrink-0">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                      style={{
                        background: done ? '#00C896' : active ? '#00C896' : 'var(--bg-inset)',
                        color: done || active ? '#030D09' : 'var(--text-3)',
                        border: done || active ? 'none' : '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <span
                      className="text-xs font-medium whitespace-nowrap"
                      style={{ color: active ? 'var(--text-1)' : 'var(--text-3)' }}
                    >
                      {label}
                    </span>
                  </div>
                  {i < 1 && (
                    <div
                      className="flex-1 h-px mx-2"
                      style={{
                        background:
                          step === 'wallet' ? 'rgba(0,200,150,0.4)' : 'rgba(255,255,255,0.07)',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h1 className="text-2xl font-bold tracking-tight text-text-1 mb-1.5">
              {step === 'role' ? 'Choose your role' : 'Connect your wallet'}
            </h1>
            <p className="text-sm text-text-2">
              {step === 'role' ? (
                'Select how you will use Heliora to get the right dashboard.'
              ) : (
                <>
                  Connecting as{' '}
                  <span style={{ color: '#00C896' }} className="font-medium">
                    {selectedRole?.toLowerCase()}
                  </span>
                  . No password needed.
                </>
              )}
            </p>
          </div>

          {/* Role selection */}
          {step === 'role' && (
            <div className="space-y-3">
              {roles.map((role) => (
                <button
                  key={role.id}
                  onClick={() => handleRoleSelect(role.id)}
                  aria-label={`Select role: ${role.label}`}
                  className="w-full text-left rounded-[12px] p-4 flex items-start gap-4 transition-all duration-150 group"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,200,150,0.35)';
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-inset)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)';
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: 'rgba(0,200,150,0.1)',
                      border: '1px solid rgba(0,200,150,0.15)',
                    }}
                  >
                    <role.icon className="w-5 h-5" style={{ color: '#00C896' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-text-1">{role.label}</span>
                      <ChevronRight className="w-4 h-4 text-text-3 group-hover:text-green-500 transition-colors" />
                    </div>
                    <p className="text-xs text-text-2 mb-2.5 leading-relaxed">{role.description}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {role.features.map((f) => (
                        <span key={f} className="badge-muted text-2xs">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Wallet selection */}
          {step === 'wallet' && (
            <div>
              <button
                onClick={() => {
                  setStep('role');
                  setSelectedRole(null);
                }}
                aria-label="Back to role selection"
                className="flex items-center gap-1.5 text-sm text-text-2 hover:text-text-1 transition-colors mb-5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              {connectError && (
                <div
                  className="flex items-center justify-between rounded-[10px] p-3 mb-4"
                  style={{
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.2)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                    <p className="text-xs text-red-400">{connectError}</p>
                  </div>
                  <button
                    onClick={() => lastWallet && handleWalletConnect(lastWallet)}
                    aria-label="Retry wallet connection"
                    className="text-xs font-semibold ml-3 shrink-0 transition-colors hover:opacity-80"
                    style={{ color: '#00C896' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              <div className="space-y-2.5 mb-5">
                {wallets.map((wallet) => (
                  <button
                    key={wallet.id}
                    onClick={() => handleWalletConnect(wallet.id)}
                    disabled={!!connecting}
                    aria-label={`Connect with ${wallet.label}`}
                    className="w-full text-left rounded-[12px] p-4 flex items-center justify-between transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid rgba(255,255,255,0.07)',
                    }}
                    onMouseEnter={(e) => {
                      if (!connecting) {
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,200,150,0.35)';
                        (e.currentTarget as HTMLElement).style.background = 'var(--bg-inset)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
                      (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)';
                    }}
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0"
                        style={{
                          background: 'var(--bg-inset)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <Wallet
                          className="w-4.5 h-4.5 text-text-2 group-hover:text-green-500 transition-colors"
                          style={{ width: '18px', height: '18px' }}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-1">{wallet.label}</p>
                        <p className="text-xs text-text-3">{wallet.description}</p>
                      </div>
                    </div>
                    {connecting === wallet.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#00C896' }} />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-text-3 group-hover:text-green-500 transition-colors" />
                    )}
                  </button>
                ))}
              </div>

              {/* Security note */}
              <div
                className="rounded-[10px] p-4"
                style={{
                  background: 'rgba(0,200,150,0.05)',
                  border: '1px solid rgba(0,200,150,0.12)',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#00C896' }} />
                  <div className="space-y-1.5">
                    {trustPoints.map((p) => (
                      <p key={p} className="text-xs text-text-2 leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-text-3 mt-7">
            By connecting you agree to our{' '}
            <Link
              href="/terms"
              className="hover:text-text-1 transition-colors"
              style={{ color: '#00C896' }}
            >
              Terms
            </Link>{' '}
            and{' '}
            <Link
              href="/privacy"
              className="hover:text-text-1 transition-colors"
              style={{ color: '#00C896' }}
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

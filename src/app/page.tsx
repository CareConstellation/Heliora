import { ThemeToggle } from '@/components/ThemeToggle';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <header className="fixed top-0 left-0 right-0 p-4 flex justify-between items-center border-b border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-950/50 backdrop-blur">
        <span className="font-bold">Heliora</span>
        <ThemeToggle />
      </header>
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex mt-12">
        <h1 className="text-4xl font-bold">Instant verification, infinite traceability.</h1>
      </div>
    </main>
  );
}

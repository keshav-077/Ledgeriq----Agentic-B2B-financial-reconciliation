'use client'
import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="bg-surface-elevated text-on-surface font-body-md antialiased overflow-x-hidden min-h-screen">
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-4 md:px-16 h-16 bg-glass-fill backdrop-blur-xl border-b border-border-subtle shadow-sm">
        <span className="font-display text-headline-md text-primary tracking-tight">LedgerIQ</span>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden sm:inline font-body-md text-on-surface-variant hover:text-primary transition-colors px-3 py-1"
          >
            Sign in
          </Link>
          <a href="#talk" className="bg-primary text-on-primary font-label-md text-label-md px-6 py-2 rounded-full hover:bg-surface-tint transition-colors">
            Talk to us
          </a>
        </div>
      </nav>

      <header
        className="relative min-h-[80vh] flex flex-col justify-center items-center text-center px-4 md:px-16 pt-24"
        style={{
          background: 'linear-gradient(to bottom, rgba(10,16,22,0.4), rgba(20,29,38,1) 90%), radial-gradient(ellipse at 50% 20%, rgba(190,200,210,0.18), transparent 55%)',
        }}
      >
        <div className="max-w-4xl z-10 space-y-8 flex flex-col items-center">
          <h1 className="font-display text-display-lg text-primary max-w-3xl leading-tight">
            AI that answers like a person.<br />
            <span className="text-secondary">Resolves millions of discrepancies.</span>
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
            LedgerIQ combines world-class conversational AI with rigorous financial matching engines to protect your revenue and automate complex reconciliations at scale.
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-4">
            <a
              href="#talk"
              className="bg-primary text-on-primary font-label-md text-label-md px-8 py-3 rounded-full hover:scale-105 transition-transform duration-300 shadow-[0_0_20px_rgba(255,255,255,0.05)]"
            >
              Talk to us
            </a>
            <Link
              href="/login"
              className="border border-primary text-primary font-label-md text-label-md px-8 py-3 rounded-full hover:bg-white/5 transition-colors duration-300"
            >
              View Demo
            </Link>
          </div>
        </div>
      </header>

      <section className="py-16 px-4 md:px-16 border-b border-border-subtle bg-surface-base">
        <div className="max-w-container-max mx-auto flex flex-col items-center gap-8">
          <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Trusted by industry leaders</span>
          <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-60">
            <span className="font-display text-headline-md text-primary">Northbeam</span>
            <span className="font-display text-headline-md text-primary">Riviera</span>
            <span className="font-display text-headline-md text-primary">Latticework</span>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 md:px-16 bg-surface-base">
        <div className="max-w-container-max mx-auto space-y-16">
          <div className="text-center space-y-4">
            <h2 className="font-display text-headline-lg text-primary">Precision at Scale</h2>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl mx-auto">
              Our platform leverages advanced machine learning to provide unparalleled accuracy in transaction matching and discrepancy resolution.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-surface-elevated border border-border-subtle rounded-xl p-8 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] transition-shadow group">
              <div className="w-12 h-12 bg-surface-container rounded-lg flex items-center justify-center mb-6 border border-border-subtle group-hover:bg-white/5 transition-colors">
                <span className="material-symbols-outlined text-primary">bolt</span>
              </div>
              <h3 className="font-display text-headline-md text-primary mb-3">Rapid Detection</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Identify anomalies and inconsistencies in real-time across disparate data sets, ensuring immediate visibility into financial health.
              </p>
            </div>
            <div className="bg-surface-elevated border border-border-subtle rounded-xl p-8 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] transition-shadow group md:col-span-2">
              <div className="w-12 h-12 bg-surface-container rounded-lg flex items-center justify-center mb-6 border border-border-subtle group-hover:bg-white/5 transition-colors">
                <span className="material-symbols-outlined text-primary">hub</span>
              </div>
              <h3 className="font-display text-headline-md text-primary mb-3">Contextual Auto-Matching</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant max-w-lg">
                Our AI understands the nuanced context behind transactions, automatically reconciling complex multi-party ledgers with human-like comprehension but machine speed.
              </p>
              <div className="mt-8 h-32 rounded-lg border border-border-subtle bg-surface-container relative overflow-hidden">
                <div className="absolute inset-0 opacity-40" style={{
                  backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.15), transparent 40%), radial-gradient(circle at 80% 40%, rgba(190,200,210,0.2), transparent 45%)',
                }} />
              </div>
            </div>
            <div className="bg-surface-elevated border border-border-subtle rounded-xl p-8 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] transition-shadow group md:col-span-3 flex flex-col md:flex-row items-center gap-8">
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 bg-surface-container rounded-lg flex items-center justify-center border border-border-subtle group-hover:bg-white/5 transition-colors">
                  <span className="material-symbols-outlined text-primary">shield</span>
                </div>
                <h3 className="font-display text-headline-lg text-primary">Revenue Protection</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  Stop leakage before it happens. LedgerIQ proactively guards against unbilled items, duplicate payments, and compliance breaches, securing your bottom line with rigorous automated audits.
                </p>
              </div>
              <div className="flex-1 w-full h-64 rounded-xl border border-border-subtle bg-surface-container relative overflow-hidden">
                <div className="absolute inset-0" style={{
                  backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08), transparent 60%)',
                }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="talk" className="py-20 px-4 md:px-16 bg-surface-elevated border-t border-border-subtle">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h2 className="font-display text-headline-lg text-primary">Talk to us</h2>
          <p className="font-body-md text-on-surface-variant">
            Ready to see LedgerIQ on your ledgers? Sign in to the console or reach out to your account team.
          </p>
          <Link href="/login" className="inline-flex bg-primary text-on-primary font-label-md text-label-md px-8 py-3 rounded-full hover:bg-surface-tint transition-colors">
            Sign in
          </Link>
        </div>
      </section>

      <footer className="py-12 px-4 md:px-16 bg-surface-container-lowest border-t border-border-subtle">
        <div className="max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <span className="font-display text-headline-md text-primary tracking-tight">LedgerIQ</span>
          <div className="flex gap-6 font-label-md text-label-md text-on-surface-variant">
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Security</span>
          </div>
          <div className="font-body-sm text-body-sm text-on-surface-variant/50">
            © {new Date().getFullYear()} LedgerIQ. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}

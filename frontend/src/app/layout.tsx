import type { Metadata } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import dynamic from 'next/dynamic'
import './globals.css'
import { QueryProvider } from '@/components/layout/QueryProvider'
import { AuthProvider } from '@/lib/auth-context'
import { AgentIsland } from '@/components/ui/AgentIsland'
import { MagicLinkIsland } from '@/components/ui/MagicLinkIsland'

const AgentExecutionPanel = dynamic(
  () => import('@/components/ui/AgentExecutionPanel').then(m => ({ default: m.AgentExecutionPanel })),
  { ssr: false }
)
const KeyboardShortcutOverlay = dynamic(
  () => import('@/components/ui/KeyboardShortcutOverlay').then(m => ({ default: m.KeyboardShortcutOverlay })),
  { ssr: false }
)

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
})

export const metadata: Metadata = {
  title: 'LedgerIQ — Agentic Financial Reconciliation',
  description: 'LedgerIQ combines conversational AI with rigorous financial matching to automate complex reconciliations at scale.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${fraunces.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background text-on-surface font-body-md antialiased selection:bg-primary/20 selection:text-on-primary">
        <QueryProvider>
          <AuthProvider>
            {children}
            <AgentIsland />
            <AgentExecutionPanel />
            <KeyboardShortcutOverlay />
            <MagicLinkIsland />
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  )
}

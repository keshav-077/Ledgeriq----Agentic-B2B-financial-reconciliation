import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PREFIXES = [
  '/login',
  '/api/auth',
  '/_next',
  '/favicon.ico',
  '/portal',
]

// These authenticated paths are permitted even without completed onboarding
const ONBOARDING_ALLOWED = ['/onboarding', '/api/auth']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/') return NextResponse.next()

  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const session = request.cookies.get('ledgeriq_session')
  if (!session?.value) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Check if onboarding has been completed
  const onboarded = request.cookies.get('ledgeriq_onboarded')?.value

  // If this is the onboarding page itself, allow through
  if (pathname === '/onboarding') {
    return NextResponse.next()
  }

  // Redirect to onboarding if not yet completed
  if (!onboarded) {
    // Check backend onboarding status via a lightweight fetch
    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const res = await fetch(`${backendUrl}/api/v1/settings/onboarding-status`, {
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) {
        const data = await res.json() as { onboarding_completed: boolean }
        if (!data.onboarding_completed) {
          return NextResponse.redirect(new URL('/onboarding', request.url))
        }
        // Mark as onboarded in cookie so we skip the check next time
        const resp = NextResponse.next()
        resp.cookies.set('ledgeriq_onboarded', '1', {
          httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
        })
        return resp
      }
      // Backend non-OK → settings yok say, onboarding'e gönder
      return NextResponse.redirect(new URL('/onboarding', request.url))
    } catch {
      // Backend unreachable — allow through
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)'],
}

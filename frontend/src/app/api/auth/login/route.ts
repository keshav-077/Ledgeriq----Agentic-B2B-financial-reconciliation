import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { username, password } = body

    // URL'yi hem API_URL hem de NEXT_PUBLIC_API_URL'den okumayı deniyoruz
    const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    
    // Hatamızı düzelttik: Python backend'e Form Data değil, eski sistemdeki gibi JSON atıyoruz!
    const backendRes = await fetch(`${backendUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    // Backend reddettiyse (Yanlış şifre vs.), biz de reddediyoruz
    if (!backendRes.ok) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    const data = await backendRes.json()
    
    // Giriş başarılı! Python bize gerçek JWT Token'ı verdi.
    const response = NextResponse.json({ success: true }, { status: 200 })
    
    // Next.js sayfaları koruması için gerçek zamanlı oturum çerezi
    const secure = process.env.COOKIE_SECURE === 'true'

    response.cookies.set('ledgeriq_session', 'ledgeriq-authenticated-v1', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 gün
    })

    response.cookies.set('ledgeriq_token', data.access_token, {
      httpOnly: false,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    return response
  } catch (error) {
    console.error("Login route error:", error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
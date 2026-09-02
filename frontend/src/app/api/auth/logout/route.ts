import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('ledgeriq_session')
  response.cookies.delete('ledgeriq_token')
  response.cookies.delete('ledgeriq_onboarded')
  return response
}

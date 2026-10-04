'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Role, User } from '@/types'
import { getCurrentUser, getRoles } from '@/lib/api'

interface AuthContextValue {
  user: User | null
  roles: Role[]
  loading: boolean
  hasPermission: (permission: string) => boolean
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  roles: [],
  loading: true,
  hasPermission: () => false,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [me, roleList] = await Promise.all([
          getCurrentUser(),
          getRoles().catch(() => [] as Role[]),
        ])
        if (!cancelled) {
          setUser(me)
          setRoles(roleList)
        }
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const hasPermission = useMemo(() => {
    return (permission: string) => {
      if (!user) return false
      if (user.role === 'System Administrator') return true
      const role = roles.find(r => r.name === user.role)
      return Boolean(role?.permissions?.[permission])
    }
  }, [user, roles])

  return (
    <AuthContext.Provider value={{ user, roles, loading, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

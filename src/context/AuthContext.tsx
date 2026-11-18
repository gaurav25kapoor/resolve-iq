import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiRequest, setAuthToken } from '../lib/api.ts';
import type { AuthUser, DemoPersona } from '../types/index.ts';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  personas: DemoPersona[];
  loginWithPassword: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [personas, setPersonas] = useState<DemoPersona[]>([]);

  useEffect(() => {
    apiRequest<{ personas: DemoPersona[] }>('/api/auth/demo-personas')
      .then((res) => setPersonas(res.personas))
      .catch(() => {
        // ignore if server still starting
      });

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const idToken = await fbUser.getIdToken();
          setAuthToken(idToken);
          const res = await apiRequest<{ user: AuthUser }>('/api/auth/firebase', {
            method: 'POST',
            body: JSON.stringify({ idToken }),
          });
          setUser(res.user);
        } catch {
          setAuthToken(null);
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token);
    setUser(res.user);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    setAuthToken(idToken);
    const res = await apiRequest<{ user: AuthUser }>('/api/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    if (auth.currentUser) {
      await signOut(auth);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, personas, loginWithPassword, loginWithGoogle, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

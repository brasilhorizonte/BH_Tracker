import { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard';
import { getSupabaseClient, hasSupabaseConfig } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';

const AuthView = ({ onSignIn }: { onSignIn: (email: string, password: string) => Promise<void> }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSignIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app auth-shell">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: '16px' }}>
          <div className="brand-mark" />
          <div>
            <div className="brand-title">BH Tracker</div>
            <div className="brand-subtitle">Analytics access</div>
          </div>
        </div>
        <div className="auth-title">Admin sign in</div>
        <div className="auth-subtitle">Use your Supabase credentials to unlock usage metrics.</div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button className="button button-primary" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          {error ? <div className="notice">{error}</div> : null}
        </form>
      </div>
    </div>
  );
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!hasSupabaseConfig || !client) {
      setLoading(false);
      return;
    }

    client.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setLoading(false);
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSignIn = async (email: string, password: string) => {
    const client = getSupabaseClient();
    if (!hasSupabaseConfig || !client) return;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
  };

  const handleSignOut = async () => {
    const client = getSupabaseClient();
    if (!client) return;
    await client.auth.signOut();
  };

  if (!hasSupabaseConfig) {
    return (
      <div className="app auth-shell">
        <div className="auth-card">
          <div className="auth-title">Missing Supabase config</div>
          <div className="auth-subtitle">
            Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app auth-shell">
        <div className="loading">Loading session</div>
      </div>
    );
  }

  if (!session) {
    return <AuthView onSignIn={handleSignIn} />;
  }

  return (
    <div className="app">
      <div className="app-content">
        <div className="container">
          <div className="header">
            <div className="brand">
              <div className="brand-mark" />
              <div>
                <div className="brand-title">BH Tracker</div>
                <div className="brand-subtitle">Usage intelligence</div>
              </div>
            </div>
            <div className="header-actions">
              <span className="badge">{session.user.email || 'signed-in'}</span>
              <button className="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
      <Dashboard />
    </div>
  );
}

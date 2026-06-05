import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogIn, AlertCircle, TrendingUp } from 'lucide-react';

export const AuthPortal: React.FC = () => {
  const { loginWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      await loginWithEmail(email, password);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Invalid email or password');
      } else {
        setError(err.message || 'An error occurred during authentication');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ perspective: '1000px' }}>
      <div 
        className="glass-panel w-full max-w-md p-8 animate-fade-in"
        style={{
          border: '1px solid hsla(172, 85%, 45%, 0.15)',
          boxShadow: 'var(--shadow-lg), 0 0 40px -10px hsla(172, 85%, 45%, 0.1)'
        }}
      >
        {/* Header/Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500 to-indigo-600 flex items-center justify-center mb-3 shadow-lg shadow-teal-500/20"
               style={{ 
                 background: 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)',
                 boxShadow: '0 0 20px -5px var(--primary)'
               }}>
            <TrendingUp className="w-8 h-8 text-black" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mt-2 text-center">
            <span className="gradient-text">AURA</span> Tracker
          </h1>
          <p className="text-sm text-secondary mt-1 text-center">
            Private Portfolio Monitoring for India & Europe
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-950/40 border border-red-500/30 text-red-400 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full mt-6"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                Processing...
              </span>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Sign In
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

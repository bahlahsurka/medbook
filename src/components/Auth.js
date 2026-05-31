import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const handle = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Account created! Check your email to confirm, then log in.' });
        setMode('login');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Password reset email sent.' });
      }
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#f9fafb',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 48, height: 48, borderRadius: 12,
            background: '#2563eb', marginBottom: 14, fontSize: 22, color: '#fff'
          }}>⚕</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>MedBook</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            Your personal USMLE notebook
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb',
          borderRadius: 12, padding: '28px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 20 }}>
            {mode === 'login' ? 'Sign in to your account' : mode === 'signup' ? 'Create an account' : 'Reset your password'}
          </div>

          <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>EMAIL ADDRESS</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required placeholder="your@email.com" style={inputStyle} />
            </div>

            {mode !== 'reset' && (
              <div>
                <label style={labelStyle}>PASSWORD</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required placeholder="••••••••" style={inputStyle} minLength={6} />
              </div>
            )}

            {msg && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, fontSize: 13,
                background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
                color: msg.type === 'ok' ? '#15803d' : '#dc2626',
                border: `1px solid ${msg.type === 'ok' ? '#bbf7d0' : '#fecaca'}`
              }}>{msg.text}</div>
            )}

            <button type="submit" disabled={loading} style={{
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
              padding: '11px', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, marginTop: 4
            }}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Email'}
            </button>
          </form>

          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            {mode === 'login' && (<>
              <span style={linkStyle} onClick={() => { setMode('signup'); setMsg(null); }}>
                Don't have an account? Sign up
              </span>
              <span style={{ ...linkStyle, color: '#9ca3af' }} onClick={() => { setMode('reset'); setMsg(null); }}>
                Forgot password?
              </span>
            </>)}
            {mode !== 'login' && (
              <span style={linkStyle} onClick={() => { setMode('login'); setMsg(null); }}>
                ← Back to sign in
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 11, color: '#6b7280', letterSpacing: 0.5,
  fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase'
};
const inputStyle = {
  width: '100%', background: '#fff', border: '1px solid #d1d5db',
  borderRadius: 8, color: '#111827', padding: '10px 12px',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
const linkStyle = {
  fontSize: 13, color: '#2563eb', cursor: 'pointer',
  textDecoration: 'underline', textUnderlineOffset: 3
};

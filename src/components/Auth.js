import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [mode, setMode] = useState('login'); // login | signup | reset
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
      minHeight: '100vh', background: '#0c0e14', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 20,
      fontFamily: "'Syne', sans-serif"
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #e74c3c, #9b59b6)',
            marginBottom: 16, fontSize: 26
          }}>⚕</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>MedBook</div>
          <div style={{ fontSize: 13, color: '#4a5070', marginTop: 4, fontFamily: "'Literata', serif" }}>
            Your personal medical notebook
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#10121a', border: '1px solid #1c1f2e',
          borderRadius: 16, padding: '32px 28px'
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 24 }}>
            {mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}
          </div>

          <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>EMAIL</label>
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
                background: msg.type === 'ok' ? '#0d2016' : '#2a0d0d',
                color: msg.type === 'ok' ? '#27ae60' : '#e74c3c',
                border: `1px solid ${msg.type === 'ok' ? '#27ae6040' : '#e74c3c40'}`
              }}>{msg.text}</div>
            )}

            <button type="submit" disabled={loading} style={{
              background: 'linear-gradient(135deg, #e74c3c, #9b59b6)',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '13px', fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, marginTop: 4
            }}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Email'}
            </button>
          </form>

          {/* Links */}
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            {mode === 'login' && (<>
              <span style={linkStyle} onClick={() => { setMode('signup'); setMsg(null); }}>
                Don't have an account? Sign up
              </span>
              <span style={{ ...linkStyle, color: '#3a4060' }} onClick={() => { setMode('reset'); setMsg(null); }}>
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
  fontSize: 10, color: '#4a5070', letterSpacing: 1.8,
  fontWeight: 800, display: 'block', marginBottom: 6
};

const inputStyle = {
  width: '100%', background: '#0c0e14', border: '1px solid #1c1f2e',
  borderRadius: 8, color: '#e8e8e8', padding: '11px 14px',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
  fontFamily: "'Syne', sans-serif"
};

const linkStyle = {
  fontSize: 13, color: '#9b59b6', cursor: 'pointer',
  textDecoration: 'underline', textUnderlineOffset: 3
};

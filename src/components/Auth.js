import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

// Google's standard multi-colour "G" mark. Google's branding guidelines
// permit this exact icon for "Sign in with Google" buttons.
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink:0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}

export default function Auth() {
  const { t } = useTheme();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  // ---- Password recovery flow --------------------------------------------
  // When someone clicks the reset-password link in their email, Supabase
  // redirects them back here with `#...&type=recovery` in the URL and signs
  // them into a temporary session. We check the URL directly rather than
  // relying only on the onAuthStateChange 'PASSWORD_RECOVERY' event, because
  // that event fires once at detection time and can be missed if this
  // component subscribes even slightly late — reading the URL on mount is
  // the more reliable signal and doesn't depend on subscription timing.
  const [isRecovery] = useState(() =>
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery')
  );
  const [newPassword, setNewPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setMsg({ ok:false, text:'Password must be at least 6 characters.' });
      return;
    }
    setPwSaving(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) { setMsg({ ok:false, text:error.message }); return; }
    // Clear the recovery params so refreshing this page doesn't re-trigger
    // recovery mode indefinitely.
    window.history.replaceState(null, '', window.location.pathname);
    setMsg({ ok:true, text:'Password updated — you are signed in.' });
  };

  const handle = async (e) => {
    e.preventDefault();
    setLoading(true); setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg({ ok: true, text: 'Account created! Check your email to confirm, then sign in.' });
        setMode('login');
      } else {
        // FIX: redirectTo was previously missing. Without it, the reset email
        // sends a link that lands on Supabase's own default page instead of
        // back in MedBook — so the "set a new password" step above could
        // never actually be reached. This is also required for isRecovery
        // (above) to ever have a URL to detect.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMsg({ ok: true, text: 'Password reset email sent.' });
      }
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setMsg(null); setGoogleLoading(true);
    // Supabase automatically links a Google sign-in to an existing
    // email/password account when the emails match (this is Supabase's
    // default behaviour, not something this app needs to implement) — so a
    // returning user who originally signed up with a password just signs
    // straight into their existing account here, and a brand-new user gets
    // one created automatically. No separate "account already exists"
    // handling is needed for either case.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // On success the page navigates away to Google, so there's nothing further
    // to do here. Only a synchronous failure (e.g. provider not configured)
    // returns before that redirect happens.
    if (error) { setMsg({ ok:false, text:error.message }); setGoogleLoading(false); }
  };

  const lbl = { fontSize:11, color:t.text3, letterSpacing:.5, fontWeight:600, display:'block', marginBottom:6, textTransform:'uppercase' };
  const inp = { width:'100%', background:t.surface2, border:`1px solid ${t.borderStrong}`, borderRadius:8, color:t.text, padding:'10px 12px', fontSize:14, outline:'none', boxSizing:'border-box' };
  const link = { fontSize:13, color:t.accent, cursor:'pointer', textDecoration:'underline', textUnderlineOffset:3 };

  const shell = (children) => (
    <div style={{ minHeight:'100vh', background:t.appBg, display:'flex',
      alignItems:'center', justifyContent:'center', padding:20, fontFamily:'Inter,sans-serif' }}>
      <div style={{ width:'100%', maxWidth:400 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center',
            width:48, height:48, borderRadius:12, background:t.accent,
            marginBottom:14, fontSize:22, color:'#fff' }}>⚕</div>
          <div style={{ fontSize:22, fontWeight:700, color:t.text }}>MedBook</div>
          <div style={{ fontSize:13, color:t.text3, marginTop:4 }}>Your personal USMLE notebook</div>
        </div>
        <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:12,
          padding:'28px 24px', boxShadow:`0 1px 3px ${t.shadow}` }}>
          {children}
        </div>
      </div>
    </div>
  );

  // ---- Recovery screen: set a new password -------------------------------
  if (isRecovery) return shell(
    <>
      <div style={{ fontSize:15, fontWeight:600, color:t.text, marginBottom:20 }}>
        Set a new password
      </div>
      <form onSubmit={handleSetNewPassword} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label style={lbl}>NEW PASSWORD</label>
          <input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}
            required placeholder="••••••••" style={inp} minLength={6} autoFocus />
        </div>
        {msg && <div style={{ padding:'10px 14px', borderRadius:8, fontSize:13,
          background:msg.ok?t.okBg:t.dangerBg, color:msg.ok?t.ok:t.danger,
          border:`1px solid ${msg.ok?t.okBorder:t.dangerBorder}` }}>{msg.text}</div>}
        <button type="submit" disabled={pwSaving} style={{ background:t.accent, color:'#fff',
          border:'none', borderRadius:8, padding:11, fontSize:14, fontWeight:600,
          cursor:pwSaving?'not-allowed':'pointer', opacity:pwSaving?.7:1, marginTop:4 }}>
          {pwSaving ? 'Saving…' : 'Set New Password'}
        </button>
      </form>
    </>
  );

  return shell(
    <>
      <div style={{ fontSize:15, fontWeight:600, color:t.text, marginBottom:20 }}>
        {mode==='login'?'Sign in':mode==='signup'?'Create account':'Reset password'}
      </div>
      <form onSubmit={handle} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label style={lbl}>EMAIL</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            required placeholder="your@email.com" style={inp} />
        </div>
        {mode!=='reset' && (
          <div>
            <label style={lbl}>PASSWORD</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              required placeholder="••••••••" style={inp} minLength={6} />
          </div>
        )}
        {msg && <div style={{ padding:'10px 14px', borderRadius:8, fontSize:13,
          background:msg.ok?t.okBg:t.dangerBg,
          color:msg.ok?t.ok:t.danger,
          border:`1px solid ${msg.ok?t.okBorder:t.dangerBorder}` }}>{msg.text}</div>}

        {/* Sign In + Google: stacked on mobile, side-by-side on desktop. */}
        <style>{`
          .medbook-auth-actions { display:flex; flex-direction:column; gap:10px; margin-top:4px; }
          @media (min-width:640px) {
            .medbook-auth-actions { flex-direction:row; }
            .medbook-auth-actions > button { flex:1; }
          }
        `}</style>
        <div className="medbook-auth-actions">
          <button type="submit" disabled={loading} style={{ background:t.accent, color:'#fff',
            border:'none', borderRadius:8, padding:11, fontSize:14, fontWeight:600,
            cursor:loading?'not-allowed':'pointer', opacity:loading?.7:1 }}>
            {loading?'Please wait…':mode==='login'?'Sign In':mode==='signup'?'Create Account':'Send Reset Email'}
          </button>

          {mode!=='reset' && (
            <button type="button" onClick={handleGoogle} disabled={googleLoading} style={{
              display:'flex', alignItems:'center', justifyContent:'center', gap:10,
              background:t.surface2, color:t.text, border:`1px solid ${t.borderStrong}`,
              borderRadius:8, padding:11, fontSize:14, fontWeight:600,
              cursor:googleLoading?'not-allowed':'pointer', opacity:googleLoading?.7:1,
              fontFamily:'Inter,sans-serif' }}>
              <GoogleIcon />
              {googleLoading ? 'Redirecting…' : (mode==='login' ? 'Continue with Google' : 'Sign up with Google')}
            </button>
          )}
        </div>
      </form>
      <div style={{ marginTop:18, display:'flex', flexDirection:'column', gap:8, alignItems:'center' }}>
        {mode==='login' && <>
          <span style={link} onClick={()=>{setMode('signup');setMsg(null);}}>Don't have an account? Sign up</span>
          <span style={{...link,color:t.text4}} onClick={()=>{setMode('reset');setMsg(null);}}>Forgot password?</span>
        </>}
        {mode!=='login' && <span style={link} onClick={()=>{setMode('login');setMsg(null);}}>← Back to sign in</span>}
      </div>
    </>
  );
}

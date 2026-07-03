import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

export default function Auth() {
  const { t } = useTheme();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

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
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMsg({ ok: true, text: 'Password reset email sent.' });
      }
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    setLoading(false);
  };

  const lbl = { fontSize:11, color:t.text3, letterSpacing:.5, fontWeight:600, display:'block', marginBottom:6, textTransform:'uppercase' };
  const inp = { width:'100%', background:t.surface2, border:`1px solid ${t.borderStrong}`, borderRadius:8, color:t.text, padding:'10px 12px', fontSize:14, outline:'none', boxSizing:'border-box' };
  const link = { fontSize:13, color:t.accent, cursor:'pointer', textDecoration:'underline', textUnderlineOffset:3 };

  return (
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
            <button type="submit" disabled={loading} style={{ background:t.accent, color:'#fff',
              border:'none', borderRadius:8, padding:11, fontSize:14, fontWeight:600,
              cursor:loading?'not-allowed':'pointer', opacity:loading?.7:1, marginTop:4 }}>
              {loading?'Please wait…':mode==='login'?'Sign In':mode==='signup'?'Create Account':'Send Reset Email'}
            </button>
          </form>
          <div style={{ marginTop:18, display:'flex', flexDirection:'column', gap:8, alignItems:'center' }}>
            {mode==='login' && <>
              <span style={link} onClick={()=>{setMode('signup');setMsg(null);}}>Don't have an account? Sign up</span>
              <span style={{...link,color:t.text4}} onClick={()=>{setMode('reset');setMsg(null);}}>Forgot password?</span>
            </>}
            {mode!=='login' && <span style={link} onClick={()=>{setMode('login');setMsg(null);}}>← Back to sign in</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

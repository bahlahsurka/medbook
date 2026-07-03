import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'medbook_theme';

// Every colour the app's "chrome" uses is expressed as a token here.
// System accent colours (per-system, difficulty) intentionally stay literal —
// they carry meaning and read fine on either background.
export const LIGHT = {
  name:'light',
  bg:'#f3f4f6',            // app shell
  appBg:'#f9fafb',         // scroll/content area + body
  surface:'#ffffff',       // cards, header, sidebar, modals
  surface2:'#f9fafb',      // insets, subtle inputs, hover
  surface3:'#f3f4f6',      // muted buttons
  border:'#e5e7eb',
  borderStrong:'#d1d5db',
  text:'#111827',
  text2:'#374151',
  text3:'#6b7280',
  text4:'#9ca3af',
  accent:'#2563eb',
  navActiveBg:'#eff6ff',
  navActiveText:'#2563eb',
  navActiveBorder:'#bfdbfe',
  dangerBg:'#fef2f2',
  dangerBorder:'#fecaca',
  danger:'#dc2626',
  okBg:'#f0fdf4',
  okBorder:'#bbf7d0',
  ok:'#16a34a',
  warnBg:'#fffbeb',
  warnBorder:'#fde68a',
  warn:'#d97706',
  hlBtnBg:'#fef9c3',
  hlBtnBorder:'#fde68a',
  hlBtnText:'#92400e',
  overlay:'rgba(0,0,0,0.4)',
  shadow:'rgba(0,0,0,.06)',
  shadowStrong:'rgba(0,0,0,.18)',
  spinnerTrack:'#e5e7eb',
};

export const DARK = {
  name:'dark',
  bg:'#0d0f13',
  appBg:'#0d0f13',
  surface:'#181b21',
  surface2:'#22262e',
  surface3:'#2a2f38',
  border:'#2c313a',
  borderStrong:'#3a404b',
  text:'#f1f3f5',
  text2:'#c7ccd4',
  text3:'#9aa2ad',
  text4:'#6b7280',
  accent:'#3b82f6',
  navActiveBg:'rgba(59,130,246,0.16)',
  navActiveText:'#60a5fa',
  navActiveBorder:'rgba(59,130,246,0.4)',
  dangerBg:'rgba(220,38,38,0.14)',
  dangerBorder:'rgba(220,38,38,0.38)',
  danger:'#f87171',
  okBg:'rgba(22,163,74,0.14)',
  okBorder:'rgba(22,163,74,0.38)',
  ok:'#4ade80',
  warnBg:'rgba(217,119,6,0.14)',
  warnBorder:'rgba(217,119,6,0.4)',
  warn:'#fbbf24',
  hlBtnBg:'rgba(217,119,6,0.18)',
  hlBtnBorder:'rgba(217,119,6,0.4)',
  hlBtnText:'#fbbf24',
  overlay:'rgba(0,0,0,0.62)',
  shadow:'rgba(0,0,0,.5)',
  shadowStrong:'rgba(0,0,0,.6)',
  spinnerTrack:'#2c313a',
};

const ThemeContext = createContext({ t: LIGHT, theme:'light', toggle:()=>{}, isDark:false });

function readInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return 'light';
}

// Keeps the <body> (outside React's root) in sync so there are no white
// gutters behind the app in dark mode.
function applyBodyTheme(pal) {
  try {
    document.body.style.background = pal.appBg;
    document.body.style.color = pal.text;
    if (pal.name === 'dark') document.body.classList.add('medbook-dark');
    else document.body.classList.remove('medbook-dark');
  } catch {}
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitial);
  const t = theme === 'dark' ? DARK : LIGHT;

  useEffect(() => {
    applyBodyTheme(t);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme, t]);

  const toggle = useCallback(() => setTheme(p => p === 'dark' ? 'light' : 'dark'), []);

  return (
    <ThemeContext.Provider value={{ t, theme, toggle, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

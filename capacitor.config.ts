import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.medbook.app',
  appName: 'MedBook',
  // `build/` is still populated by `npm run build` (see the android-apk CI
  // workflow) so Capacitor has a valid local fallback shell to embed, but at
  // runtime the WebView loads `server.url` below instead of these bundled
  // files — see the "Remote URL" decision in the PR description for why:
  // web updates (Vercel deploys) show up instantly with no APK rebuild: only
  // native config/permission changes need a new build.
  webDir: 'build',
  server: {
    // The live production deployment. Update this if the production domain
    // ever changes; nothing else in this file needs to.
    url: 'https://medbook-six.vercel.app',
    // Required for a non-bundled https:// server.url; Capacitor treats
    // `androidScheme` as the *local* asset scheme (still `https`, correct
    // default), unrelated to this being an http vs https remote origin.
    cleartext: false,
  },
  android: {
    // The remote origin is already https, and matches the Content-Security
    // defaults Capacitor's WebView applies — no extra allowNavigation entries
    // needed unless the app starts linking out to a *different* origin.
    allowMixedContent: false,
  },
};

export default config;

// Application mobile (Android) : l'application Angular, emballee par Capacitor.
//
// Un seul code pour le web et le mobile : une correction faite sur un ecran
// profite aux deux. Le projet Android genere vit dans apps/web/android ; on
// l'ouvre dans Android Studio pour compiler et lancer l'APK.
//
// Deux modes :
//
// - Developpement (aujourd'hui) : l'application charge le site servi par
//   `ng serve` sur le poste du developpeur (variable CAP_SERVER_URL, posee par
//   scripts/mobile.mjs). Le site et l'API sont alors sur la meme machine :
//   les cookies de session (SameSite=strict) fonctionnent tels quels, et une
//   modification du code s'affiche sans recompiler l'APK.
//
// - Production (a decider) : soit l'application charge le site en ligne
//   (meme principe), soit elle embarque ses fichiers (webDir) — il faudra
//   alors adapter l'authentification, car l'API ne serait plus sur la meme
//   origine que l'application.
import type { CapacitorConfig } from '@capacitor/cli';

/** Ex. http://10.0.2.2:4200 (emulateur) ou http://192.168.1.20:4200 (telephone sur le wifi). */
const serveurDeDeveloppement = process.env['CAP_SERVER_URL'];

const config: CapacitorConfig = {
  // Identifiant definitif sur le Play Store : ne plus le changer apres publication.
  appId: 'gn.leadhealth.app',
  // Nom sous l'icone du telephone (le nom affiche dans l'application vient de
  // l'API, reglable par le super admin).
  appName: 'Lead Health',
  webDir: 'dist/baobaoheath-web/browser',
  ...(serveurDeDeveloppement
    ? { server: { url: serveurDeDeveloppement, cleartext: true } }
    : {}),
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0B2618',
      showSpinner: false,
    },
  },
};

export default config;

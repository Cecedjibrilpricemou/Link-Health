// Prepare le projet Android pour le developpement.
//
//   npm run mobile:emulateur            -> l'emulateur charge http://10.0.2.2:4200
//   npm run mobile:telephone -- 192.168.1.20
//                                       -> un vrai telephone (meme wifi) charge http://192.168.1.20:4200
//   npm run mobile:usb                  -> un telephone branche en USB charge http://localhost:4200
//                                          (ports 4200 et 3000 relayes par adb reverse)
//
// 10.0.2.2 est l'adresse par laquelle l'emulateur Android voit le PC.
// Ensuite : `npm run start:lan` (site accessible depuis le reseau) et, dans
// Android Studio, Run sur l'emulateur ou le telephone.
import { spawnSync } from 'node:child_process';

const [mode, ip] = process.argv.slice(2);
let url;
if (mode === 'emulateur') url = 'http://10.0.2.2:4200';
else if (mode === 'telephone') {
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    console.error("Indiquez l'adresse IP du PC sur le wifi : npm run mobile:telephone -- 192.168.1.20");
    process.exit(1);
  }
  url = `http://${ip}:4200`;
} else if (mode === 'usb') {
  // Telephone branche en USB : ses ports 4200 (site) et 3000 (API) sont
  // relayes vers le PC. Il voit alors tout sur « localhost », que l'API
  // accepte deja, sans dependre du wifi.
  const adb = process.env.ANDROID_HOME
    ? `${process.env.ANDROID_HOME}/platform-tools/adb`
    : process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb` : 'adb';
  for (const port of ['4200', '3000']) {
    const relais = spawnSync(`"${adb}"`, ['reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'inherit', shell: true });
    if (relais.status !== 0) {
      console.error('Telephone introuvable : branchez-le et autorisez le debogage USB.');
      process.exit(1);
    }
  }
  url = 'http://localhost:4200';
} else {
  console.error('Usage : node scripts/mobile.mjs emulateur | telephone <ip> | usb');
  process.exit(1);
}

console.log(`L'application chargera ${url}`);
if (mode !== 'usb') console.log(`Pensez a ajouter ${url} a ALLOWED_ORIGINS dans le .env de l'API.`);
// `ng serve` seul n'ecoute que sur localhost (souvent ::1, en IPv6) :
// l'emulateur et le telephone arrivent en IPv4 et sont refuses
// (net::ERR_CONNECTION_REFUSED dans l'application).
console.log('Lancez le site avec : npm run start:lan (et non npm start).');
const r = spawnSync('npx', ['cap', 'sync', 'android'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CAP_SERVER_URL: url },
});
process.exit(r.status ?? 1);

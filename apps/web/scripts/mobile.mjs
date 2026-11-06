// Prepare le projet Android pour le developpement.
//
//   npm run mobile:emulateur            -> l'emulateur charge http://10.0.2.2:4200
//   npm run mobile:telephone -- 192.168.1.20
//                                       -> un vrai telephone (meme wifi) charge http://192.168.1.20:4200
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
} else {
  console.error('Usage : node scripts/mobile.mjs emulateur | telephone <ip>');
  process.exit(1);
}

console.log(`L'application chargera ${url}`);
console.log(`Pensez a ajouter ${url} a ALLOWED_ORIGINS dans le .env de l'API.`);
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

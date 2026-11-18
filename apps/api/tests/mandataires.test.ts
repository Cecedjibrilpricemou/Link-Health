// Constate au premier deploiement reel, le 2026-11-18 : derriere le proxy du
// serveur et le nginx du site, l'API ecrivait dans ses journaux l'adresse du
// mandataire au lieu de celle du client, et `express-rate-limit` refusait de
// compter — « the 'X-Forwarded-For' header is set but the Express 'trust
// proxy' setting is false ».
//
// Trois effets, tous invisibles en developpement, ou l'API est jointe
// directement : une limite de debit commune a tous les visiteurs, un journal
// d'acces aux dossiers sans adresse reelle, et un filtrage USSD par adresse
// qui compare la mauvaise.
//
// Ce test monte l'application comme en production et interroge `req.ip` :
// c'est le cablage qui compte, pas la valeur de la variable.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

import type { AddressInfo } from 'node:net';

import express from 'express';

import { envSchema } from '../src/config/env';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/test',
  JWT_SECRET: 'secret-de-test-au-moins-32-caracteres',
  JWT_REFRESH_SECRET: 'autre-secret-de-test-au-moins-32-car',
  DB_ENCRYPTION_KEY: '0'.repeat(64),
};

/**
 * La meme application qu'en production, reduite a ce qui nous interesse :
 * le reglage des mandataires et une route qui rend l'adresse vue.
 */
function appAvec(mandataires: number) {
  const app = express();
  app.set('trust proxy', mandataires);
  app.get('/vu', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

/**
 * Demarre l'application sur un port libre, envoie une requete avec l'en-tete
 * donne, et rend l'adresse que l'application a retenue. Un vrai aller-retour
 * HTTP : c'est la seule facon de voir ce que `req.ip` vaut reellement.
 */
async function adresseVue(
  app: ReturnType<typeof express>,
  enTete: string,
): Promise<string | undefined> {
  const serveur = app.listen(0);
  try {
    await new Promise<void>((resoudre) => serveur.once('listening', () => resoudre()));
    const { port } = serveur.address() as AddressInfo;
    const reponse = await fetch(`http://127.0.0.1:${port}/vu`, {
      headers: { 'X-Forwarded-For': enTete },
    });
    const corps = (await reponse.json()) as { ip?: string };
    return corps.ip;
  } finally {
    await new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  }
}

describe('env : TRUST_PROXY', () => {
  it('vaut zero par defaut : en developpement, l en-tete est ignore', () => {
    expect(envSchema.parse(BASE).TRUST_PROXY).toBe(0);
  });

  it('lit la valeur posee en production', () => {
    expect(envSchema.parse({ ...BASE, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  // Une ligne `TRUST_PROXY=` laissee vide — le cas d'un .env recopie — ne
  // doit pas empecher l'API de demarrer.
  //
  // Ce test ne distingue pas `videCommeAbsent` d'une conversion directe :
  // `Number('')` vaut zero, soit justement le defaut. Il verifie donc le
  // resultat attendu, pas le chemin emprunte.
  it('ne refuse pas une ligne laissee vide', () => {
    expect(() => envSchema.parse({ ...BASE, TRUST_PROXY: '' })).not.toThrow();
    expect(envSchema.parse({ ...BASE, TRUST_PROXY: '' }).TRUST_PROXY).toBe(0);
  });

  it('refuse une valeur negative ou absurde', () => {
    expect(() => envSchema.parse({ ...BASE, TRUST_PROXY: '-1' })).toThrow();
    expect(() => envSchema.parse({ ...BASE, TRUST_PROXY: '99' })).toThrow();
  });
});

describe('adresse du client derriere des mandataires', () => {
  const CLIENT = '41.223.51.165';
  const NGINX = '172.16.2.9';
  const PROXY = '10.0.1.7';

  it("sans mandataire declare, l en-tete n'est pas suivi", async () => {
    expect(await adresseVue(appAvec(0), CLIENT)).not.toBe(CLIENT);
  });

  // Le cas de la production : le proxy du serveur ajoute l'adresse du
  // client, puis le nginx du site ajoute celle du proxy.
  it('avec deux mandataires, rend l adresse du client', async () => {
    expect(await adresseVue(appAvec(2), `${CLIENT}, ${PROXY}`)).toBe(CLIENT);
  });

  // Le point de securite : un client qui fabrique son propre en-tete place
  // une adresse AVANT celles des mandataires. En remontant un nombre fixe
  // d'entrees, elle n'est jamais retenue.
  it('ne retient pas une adresse ajoutee par le client lui-meme', async () => {
    const vue = await adresseVue(appAvec(2), `1.2.3.4, ${CLIENT}, ${PROXY}`);
    expect(vue).toBe(CLIENT);
    expect(vue).not.toBe('1.2.3.4');
  });

  // `true` ferait confiance a la premiere entree, celle que le client
  // controle : c'est pourquoi la configuration impose un nombre.
  it('montre pourquoi un nombre vaut mieux que « true »', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.get('/vu', (req, res) => {
      res.json({ ip: req.ip });
    });

    expect(await adresseVue(app, `1.2.3.4, ${CLIENT}, ${NGINX}`)).toBe('1.2.3.4');
  });
});

import { expect, test } from '@playwright/test';
import { E2E, login } from './helpers';

const API = process.env['E2E_API_URL'] ?? 'http://localhost:3000/api/v1';

async function csrfHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies(API)).find((cookie) => cookie.name === 'bb_csrf')?.value;
  if (!csrf) throw new Error('Cookie CSRF missing after authentication');
  return { 'x-csrf-token': csrf };
}

test('Pharmacie — catalogue, stock, vente, agents et cloisonnement entre officines', async ({ page, browser }) => {
  await login(page, E2E.pharmacien.email);
  const suffixe = Date.now().toString().slice(-8);
  const libelleProduit = `Produit acceptance ${suffixe}`;
  const emailAgent = `agent.${suffixe}@baobao.test`;

  await page.goto('/pharmacien/caisse');
  await page.locator('#caisse-fond').fill('50000');
  const ouvertureCaisse = page.waitForResponse((response) =>
    response.url().endsWith('/pharmacien/caisse/sessions') &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  expect((await ouvertureCaisse).status()).toBe(201);

  await page.goto('/pharmacien/stocks');
  await page.getByRole('button', { name: 'Produits de mon officine' }).click();
  await page.getByRole('button', { name: 'Créer un produit' }).click();
  await page.locator('#produit-libelle').fill(libelleProduit);
  await page.locator('#produit-categorie').selectOption('HYGIENE');
  await page.locator('#produit-prix').fill('12345');
  await page.locator('#produit-seuil').fill('3');
  await page.locator('#produit-unite').fill('flacon');
  const creerProduit = page.waitForResponse((response) =>
    response.url().includes('/pharmacien/catalogue-local') &&
    response.request().method() === 'POST',
  );
  await page.locator('.bb-ph-stocks__form-actions .bb-ph-stocks__save-btn').last().click();
  const reponseProduit = await creerProduit;
  expect(reponseProduit.status()).toBe(201);
  const produitResponse = await reponseProduit.json();
  const produitId = produitResponse.data.id as string;
  expect(produitResponse.data.estPropreOfficine).toBe(true);

  const catalogue = await page.request.get(`${API}/pharmacien/medicaments`);
  expect(catalogue.ok()).toBeTruthy();
  expect((await catalogue.json()).data.some((item: { id: string }) => item.id === produitId)).toBe(true);

  const reappro = await page.request.post(`${API}/pharmacien/stocks/reapprovisionner`, {
    headers: await csrfHeaders(page),
    data: {
      idMedicament: produitId,
      quantiteAjoutee: 8,
      datePeremption: '2028-12-31',
      margeGnf: 9000,
    },
  });
  expect(reappro.ok()).toBeTruthy();

  const venteResponse = await page.request.post(`${API}/pharmacien/ventes`, {
    headers: await csrfHeaders(page),
    data: { lignes: [{ idMedicament: produitId, quantite: 2 }], modePaiement: 'ESPECES' },
  });
  expect(venteResponse.ok()).toBeTruthy();
  const vente = (await venteResponse.json()).data;
  expect(vente.montantNetGnf).toBe(24690);
  expect(vente.statut).toBe('PAYEE');

  const stocks = await page.request.get(`${API}/pharmacien/stocks`);
  const stockLocal = (await stocks.json()).data.find(
    (stock: { medicament: { id: string } }) => stock.medicament.id === produitId,
  );
  expect(stockLocal.quantite).toBe(6);
  expect(stockLocal.seuilAlerte).toBe(3);
  expect(stockLocal.unite).toBe('flacon');
  expect(stockLocal.margeGnf).toBe(0);

  const lotsResponse = await page.request.get(`${API}/pharmacien/medicaments/${produitId}/lots`);
  expect(lotsResponse.ok()).toBeTruthy();
  const lot = (await lotsResponse.json()).data[0] as { id: string; quantite: number };
  expect(lot.quantite).toBe(6);
  const ajustement = await page.request.post(`${API}/pharmacien/stocks/lots/${lot.id}/ajuster`, {
    headers: await csrfHeaders(page),
    data: { quantiteComptee: 5, motif: 'Comptage physique acceptance' },
  });
  expect(ajustement.ok()).toBeTruthy();
  expect((await ajustement.json()).data.variation).toBe(-1);

  const mouvements = await page.request.get(`${API}/pharmacien/stocks/mouvements`);
  expect(mouvements.ok()).toBeTruthy();
  const historique = (await mouvements.json()).data as Array<{
    type: string; quantite: number; medicament: { id: string } | null;
  }>;
  expect(historique.some((m) => m.type === 'AJUSTEMENT' && m.quantite === -1 &&
    m.medicament?.id === produitId)).toBe(true);

  await page.goto('/pharmacien/stocks');
  await expect(page.getByRole('heading', { name: 'Historique des mouvements' })).toBeVisible();
  await expect(page.locator('.bb-ph-stocks__movement-row')
    .filter({ hasText: libelleProduit })
    .filter({ hasText: 'Comptage physique acceptance' })).toBeVisible();
  await page.getByRole('button', { name: "Faire l'inventaire des lots" }).first().click();
  await expect(page.getByRole('heading', { name: /Inventaire par lot/ })).toBeVisible();

  await page.goto('/pharmacien/caisse');
  await page.locator('#c-med-0').selectOption(produitId);
  await page.locator('#c-qte-0').fill('1');
  const venteDepuisCaisse = page.waitForResponse((response) =>
    response.url().endsWith('/pharmacien/ventes') &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Encaisser', exact: true }).click();
  const reponseVenteCaisse = await venteDepuisCaisse;
  expect(reponseVenteCaisse.status()).toBe(201);
  expect((await reponseVenteCaisse.json()).data.montantNetGnf).toBe(12345);

  await page.locator('#caisse-compte').fill('87035');
  const clotureCaisse = page.waitForResponse((response) =>
    response.url().includes('/pharmacien/caisse/sessions/') &&
    response.url().endsWith('/cloturer') &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Clôturer la caisse' }).click();
  const reponseCloture = await clotureCaisse;
  expect(reponseCloture.ok()).toBeTruthy();
  expect((await reponseCloture.json()).data.montantTheoriqueGnf).toBe(87035);

  await page.goto('/pharmacien/approvisionnements');
  await page.getByRole('button', { name: 'Saisir une facture' }).click();
  await page.locator('#ap-fournisseur').fill('Grossiste acceptance');
  await page.locator('#ap-numero').fill(`FAC-${suffixe}`);
  await page.locator('#l-med-0').selectOption(produitId);
  await page.locator('#l-qte-0').fill('4');
  await page.locator('#l-lot-0').fill(`LOT-${suffixe}`);
  await page.locator('#l-per-0').fill('2028-12-31');
  await page.locator('#l-prix-0').fill('7000');
  const approvisionnement = page.waitForResponse((response) =>
    response.url().endsWith('/pharmacien/approvisionnements') &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: "Enregistrer l'entrée en stock" }).click();
  const reponseAppro = await approvisionnement;
  expect(reponseAppro.status()).toBe(201);
  expect((await reponseAppro.json()).data.fournisseur).toBe('Grossiste acceptance');
  await expect(page.locator('.bb-appro__entree').filter({ hasText: `FAC-${suffixe}` }))
    .toContainText('Grossiste acceptance');

  const creerAgent = await page.request.post(`${API}/pharmacien/agents`, {
    headers: await csrfHeaders(page),
    data: {
      telephone: `+2246${suffixe}`,
      email: emailAgent,
      motDePasse: 'Agent-E2e-123',
      prenom: 'Agent',
      nom: 'Test',
    },
  });
  expect(creerAgent.ok()).toBeTruthy();
  const agentId = (await creerAgent.json()).data.agent.id as string;
  const suspendreAgent = await page.request.patch(`${API}/pharmacien/agents/${agentId}/statut`, {
    headers: await csrfHeaders(page),
    data: { estActif: false },
  });
  expect(suspendreAgent.ok()).toBeTruthy();
  expect((await suspendreAgent.json()).data.estActif).toBe(false);

  const connexionAgentSuspendu = await page.request.post(`${API}/auth/login`, {
    data: { identifiant: emailAgent, motDePasse: 'Agent-E2e-123' },
  });
  expect(connexionAgentSuspendu.status()).toBe(401);

  const journal = await page.request.get(`${API}/pharmacien/connexions`);
  const evenements = (await journal.json()).data.items;
  expect(evenements).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'ECHEC_AUTHENTIFICATION',
      utilisateur: expect.objectContaining({ email: emailAgent }),
    }),
  ]));

  const autreContexte = await browser.newContext({ locale: 'fr-FR' });
  try {
    const autrePage = await autreContexte.newPage();
    await login(autrePage, E2E.titulaireAutre.email);
    const autreCatalogue = await autrePage.request.get(`${API}/pharmacien/medicaments`);
    const autresProduits = (await autreCatalogue.json()).data as { id: string }[];
    expect(autresProduits.some((item) => item.id === produitId)).toBe(false);

    const autresStocks = await autrePage.request.get(`${API}/pharmacien/stocks`);
    expect((await autresStocks.json()).data.some(
      (stock: { medicament: { id: string } }) => stock.medicament.id === produitId,
    )).toBe(false);

    const autresVentes = await autrePage.request.get(`${API}/pharmacien/ventes`);
    expect((await autresVentes.json()).data.some(
      (item: { id: string }) => item.id === vente.id,
    )).toBe(false);
  } finally {
    await autreContexte.close();
  }

  await page.goto('/pharmacien/stocks');
  await expect(page.locator('.bb-page-head__title')).toBeVisible();
  await expect(page.locator('.bb-ph-stocks__produit-nom', { hasText: libelleProduit })).toBeVisible();

  await page.goto('/pharmacien/caisse');
  await expect(page.locator('.bb-page-head__title')).toBeVisible();
  await expect(page.locator('select#c-med-0 option', { hasText: libelleProduit })).toHaveCount(1);

  await page.goto('/pharmacien/agents');
  await expect(page.locator('.bb-page-head__title')).toBeVisible();
  await expect(page.locator('.bb-agents__list')).toContainText(emailAgent);

  await page.goto('/pharmacien/connexions');
  await expect(page.locator('.bb-page-head__title')).toBeVisible();
  await expect(page.locator('.bb-connexions__table')).toContainText(emailAgent);

  await page.goto('/pharmacien/tableau-de-bord');
  await expect(page.locator('.bb-page-head__title')).toBeVisible();
  await expect(page.locator('.bb-tdb__rapport-session').first()).toContainText('Clôturée');

  const autresPages = [
    { route: '/pharmacien/ordonnances', endpoint: '/pharmacien/ordonnances' },
    { route: '/pharmacien/commandes', endpoint: '/commandes/pharmacie' },
    { route: '/pharmacien/peremptions', endpoint: '/pharmacien/peremptions' },
  ];
  for (const item of autresPages) {
    const chargement = page.waitForResponse((response) =>
      response.url().includes(item.endpoint) &&
      response.request().method() === 'GET',
    );
    await page.goto(item.route);
    await expect(page.locator('.bb-page-head__title')).toBeVisible();
    expect((await chargement).status()).toBe(200);
  }
});

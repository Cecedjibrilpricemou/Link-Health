import { expect, type Locator, type Page } from '@playwright/test';

/** Comptes et donnees crees par apps/api/prisma/seed-e2e.ts. */
export const E2E = {
  motDePasse: 'E2e-Password-123',
  asc: { email: 'asc.e2e@baobao.test' },
  medecin: { email: 'medecin.e2e@baobao.test' },
  pharmacien: { email: 'pharma.e2e@baobao.test' },
  titulaireAutre: { email: 'titulaire.autre.e2e@baobao.test' },
  adminStructure: { email: 'admin.centre.e2e@baobao.test' },
  patient: { telephone: '690000010', prenom: 'Awa', nom: 'Diallo', qrCode: 'E2E-QR-AWA-0001' },
  centre: 'Centre de sante e2e',
  /** Nom commercial (liste pharmacie) et DCI (select d'ordonnance : « Paracetamol · 500mg · comprime »). */
  medicament: 'Doliprane e2e',
  medicamentDci: 'Paracetamol',
  /** Molecule a laquelle la patiente est allergique (EF-05-05). */
  allergene: 'Amoxicilline',
  /** Produit a circuit reglemente (EF-05-12). */
  reglemente: 'Morphine',
} as const;

/**
 * Connexion par le formulaire. Les comptes professionnels passent par l'OTP :
 * sans Gmail configure, l'API renvoie le code en developpement et la page
 * l'affiche — on le recopie dans les six cases, comme le ferait un testeur.
 */
export async function login(page: Page, identifiant: string, motDePasse = E2E.motDePasse) {
  await page.goto('/auth/login');
  await desactiverTransitions(page);
  await page.locator('#identifiant').fill(identifiant);
  await page.locator('#motDePasse').fill(motDePasse);
  await page.locator('form button[type="submit"]').click();

  const codeDev = page.locator('.otp-dev-code strong');
  const espace = page.getByRole('navigation').or(page.locator('mat-sidenav'));
  await expect(codeDev.or(espace).first()).toBeVisible({ timeout: 20_000 });

  if (await codeDev.isVisible()) {
    const code = (await codeDev.textContent())?.trim() ?? '';
    expect(code).toMatch(/^\d{6}$/);
    // Saisie au clavier : chaque chiffre fait avancer le focus, et le sixieme
    // lance la verification tout seul — pas de bouton a cliquer.
    await page.locator('.otp-digit-input').first().focus();
    await page.keyboard.type(code, { delay: 30 });
  }

  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 20_000 });
}

/**
 * Les boutons bougent au survol (translateY + transition) : Playwright clique
 * sur un element en mouvement et rate parfois la cible. Sans transitions,
 * les clics sont deterministes — l'application est une SPA, une injection
 * par session suffit.
 */
export async function desactiverTransitions(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }',
  });
}

/**
 * Clic robuste pour les boutons de formulaire des fiches (bb-detail__submit-btn).
 * Juste apres la saisie, le test de cible de Playwright attribue parfois le
 * point de clic a l'element hote du composant et boucle ; apres defilement
 * et un court delai, le meme clic passe. En dernier recours, clic souris aux
 * coordonnees du bouton — c'est toujours un vrai clic, pas un dispatchEvent.
 */
export async function cliquer(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  try {
    await el.click({ timeout: 5_000 });
  } catch {
    const box = await el.boundingBox();
    if (!box) throw new Error('cliquer : element sans boite');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

/** Ouvre un mat-select (overlay Material) et choisit l'option dont le libelle contient `texte`. */
export async function choisirOption(page: Page, selectId: string, texte: string) {
  await page.locator(`#${selectId}`).click();
  await page.getByRole('option', { name: new RegExp(texte, 'i') }).first().click();
}

/** Ferme un mat-select multiple encore ouvert. */
export async function fermerOverlay(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.cdk-overlay-pane mat-option').first()).toBeHidden();
}

/**
 * Liste avec recherche : tape le texte puis choisit l'option qui le contient.
 * Le texte est cherche tel quel (pas d'expression reguliere).
 */
export async function choisirDansListe(page: Page, id: string, texte: string) {
  const champ = page.locator(`#${id}`);
  await champ.click();
  await champ.fill(texte);
  await page.locator(`#${id}-liste [role="option"]`, { hasText: texte }).first().click();
}

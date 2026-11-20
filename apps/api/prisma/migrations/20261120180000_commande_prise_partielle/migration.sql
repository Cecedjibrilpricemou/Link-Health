-- La prise partielle d'une commande (stock verifie a l'arrivee).
--
-- Une pharmacie qui ne detient qu'une partie des produits peut le proposer ;
-- le patient choisit d'accepter et de relancer le manquant, d'accepter seul,
-- ou de refuser. Le manquant relance devient une seconde commande - un
-- reliquat - sur la meme ordonnance : `idOrdonnance` n'est donc plus unique.
--
-- Pas de `DROP INDEX "medicaments_recherche_trgm"` ici, bien que
-- `prisma migrate diff` le propose : cet index est cree en SQL brut par
-- `20261112200000_recherche_catalogue`, et le supprimer casserait la
-- recherche des medicaments.

-- CreateEnum
CREATE TYPE "ChoixPatientPartiel" AS ENUM ('ACCEPTE_ET_RELANCE', 'ACCEPTE_SEUL', 'REFUSE', 'EXPIRE');

-- AlterEnum : place dans l'ordre du schema.
ALTER TYPE "StatutCommande" ADD VALUE 'ATTENTE_ACCORD_PATIENT' AFTER 'PRISE_EN_CHARGE';

-- DropIndex
DROP INDEX "commandes_idOrdonnance_key";

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "choixPartiel" "ChoixPatientPartiel",
ADD COLUMN     "choixPartielLe" TIMESTAMP(3),
ADD COLUMN     "idCommandeOrigine" TEXT,
ADD COLUMN     "lignesOrdonnance" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lignesProposees" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "propositionPartielleLe" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "commandes_idOrdonnance_idx" ON "commandes"("idOrdonnance");

-- CreateIndex
CREATE INDEX "commandes_idCommandeOrigine_idx" ON "commandes"("idCommandeOrigine");

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_idCommandeOrigine_fkey" FOREIGN KEY ("idCommandeOrigine") REFERENCES "commandes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- **Une seule commande d'origine par ordonnance**, comme le garantissait
-- l'index unique supprime plus haut : seuls les reliquats s'y ajoutent. Sans
-- lui, deux lancements simultanes feraient deux commandes completes pour la
-- meme ordonnance. Index partiel, donc en SQL brut : Prisma ne le connait pas,
-- et `migrate diff` proposera de le supprimer - comme l'index trigramme, ne
-- pas le suivre (voir docs/PASSATION.md).
CREATE UNIQUE INDEX "commandes_origine_par_ordonnance" ON "commandes"("idOrdonnance") WHERE "idCommandeOrigine" IS NULL;

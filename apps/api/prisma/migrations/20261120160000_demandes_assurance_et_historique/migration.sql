-- Les compagnies d'assurance deposent desormais leur demande en ligne, comme
-- les etablissements de sante, et chaque action de l'administration sur une
-- demande porte un motif envoye au candidat.
--
-- Pas de `DROP INDEX "medicaments_recherche_trgm"` ici, bien que
-- `prisma migrate diff` le propose : cet index est cree en SQL brut par
-- `20261112200000_recherche_catalogue`, Prisma ne le connait pas, et le
-- supprimer casserait la recherche des medicaments.

-- CreateEnum
CREATE TYPE "ActionDemandeAgrement" AS ENUM ('MISE_EN_VERIFICATION', 'VALIDATION', 'REFUS');

-- AlterTable
ALTER TABLE "demandes_agrement" ADD COLUMN     "codeAssureur" TEXT,
ADD COLUMN     "modeEchange" "ModeEchangeAssureur";

-- CreateTable
CREATE TABLE "evenements_demande_agrement" (
    "id" TEXT NOT NULL,
    "idDemande" TEXT NOT NULL,
    "action" "ActionDemandeAgrement" NOT NULL,
    "motif" TEXT NOT NULL,
    "emailEnvoye" BOOLEAN NOT NULL DEFAULT false,
    "idAuteur" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evenements_demande_agrement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evenements_demande_agrement_idDemande_creeLe_idx" ON "evenements_demande_agrement"("idDemande", "creeLe");

-- AddForeignKey
ALTER TABLE "evenements_demande_agrement" ADD CONSTRAINT "evenements_demande_agrement_idDemande_fkey" FOREIGN KEY ("idDemande") REFERENCES "demandes_agrement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evenements_demande_agrement" ADD CONSTRAINT "evenements_demande_agrement_idAuteur_fkey" FOREIGN KEY ("idAuteur") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

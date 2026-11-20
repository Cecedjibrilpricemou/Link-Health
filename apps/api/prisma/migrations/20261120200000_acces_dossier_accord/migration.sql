-- L'accord du patient pour que le medecin d'un rendez-vous lise son
-- historique (consultations, resultats, ordonnances, vaccinations). La visite
-- en cours reste ouverte sans accord ; l'autorisation vaut jusqu'a la
-- cloture de l'episode plus trente jours, et se retire a tout moment.
--
-- Pas de `DROP INDEX "medicaments_recherche_trgm"` ici, bien que
-- `prisma migrate diff` le propose : voir docs/PASSATION.md, section 5.

-- CreateEnum
CREATE TYPE "StatutAutorisationAcces" AS ENUM ('DEMANDEE', 'ACCORDEE', 'REFUSEE', 'RETIREE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TypeNotification" ADD VALUE 'ACCES_DOSSIER_DEMANDE';
ALTER TYPE "TypeNotification" ADD VALUE 'ACCES_DOSSIER_ACCORDE';

-- CreateTable
CREATE TABLE "autorisations_acces_dossier" (
    "id" TEXT NOT NULL,
    "idPatient" TEXT NOT NULL,
    "idMedecin" TEXT NOT NULL,
    "idEpisode" TEXT,
    "idRendezVous" TEXT,
    "statut" "StatutAutorisationAcces" NOT NULL DEFAULT 'DEMANDEE',
    "demandeeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relanceeLe" TIMESTAMP(3),
    "decideeLe" TIMESTAMP(3),
    "retireeLe" TIMESTAMP(3),

    CONSTRAINT "autorisations_acces_dossier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "autorisations_acces_dossier_idMedecin_statut_idx" ON "autorisations_acces_dossier"("idMedecin", "statut");

-- CreateIndex
CREATE INDEX "autorisations_acces_dossier_idPatient_statut_idx" ON "autorisations_acces_dossier"("idPatient", "statut");

-- CreateIndex
CREATE UNIQUE INDEX "autorisations_acces_dossier_idPatient_idMedecin_idEpisode_key" ON "autorisations_acces_dossier"("idPatient", "idMedecin", "idEpisode");

-- AddForeignKey
ALTER TABLE "autorisations_acces_dossier" ADD CONSTRAINT "autorisations_acces_dossier_idPatient_fkey" FOREIGN KEY ("idPatient") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorisations_acces_dossier" ADD CONSTRAINT "autorisations_acces_dossier_idMedecin_fkey" FOREIGN KEY ("idMedecin") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorisations_acces_dossier" ADD CONSTRAINT "autorisations_acces_dossier_idEpisode_fkey" FOREIGN KEY ("idEpisode") REFERENCES "episodes_soins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorisations_acces_dossier" ADD CONSTRAINT "autorisations_acces_dossier_idRendezVous_fkey" FOREIGN KEY ("idRendezVous") REFERENCES "rendez_vous"("id") ON DELETE SET NULL ON UPDATE CASCADE;


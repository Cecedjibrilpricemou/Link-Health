-- CreateEnum
CREATE TYPE "StatutDemandeAgrement" AS ENUM ('RECUE', 'EN_ANALYSE', 'VALIDEE', 'REFUSEE');

-- AlterTable
ALTER TABLE "pieces_agrement" ADD COLUMN     "idDemande" TEXT,
ALTER COLUMN "idStructure" DROP NOT NULL;

-- CreateTable
CREATE TABLE "demandes_agrement" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "statut" "StatutDemandeAgrement" NOT NULL DEFAULT 'RECUE',
    "type" "TypeStructure" NOT NULL,
    "nom" TEXT NOT NULL,
    "prefecture" TEXT NOT NULL,
    "commune" TEXT,
    "quartier" TEXT,
    "adresse" TEXT,
    "telephone" TEXT NOT NULL,
    "rccm" TEXT,
    "numeroAgrementCreation" TEXT,
    "numeroAgrementExploitation" TEXT,
    "lieuAutorise" TEXT,
    "responsablePrenom" TEXT NOT NULL,
    "responsableNom" TEXT NOT NULL,
    "responsableTelephone" TEXT NOT NULL,
    "responsableEmail" TEXT NOT NULL,
    "idStructureCreee" TEXT,
    "motifRefus" TEXT,
    "idExaminePar" TEXT,
    "examineLe" TIMESTAMP(3),
    "deposeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demandes_agrement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demandes_agrement_numero_key" ON "demandes_agrement"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "demandes_agrement_idStructureCreee_key" ON "demandes_agrement"("idStructureCreee");

-- CreateIndex
CREATE INDEX "demandes_agrement_statut_deposeLe_idx" ON "demandes_agrement"("statut", "deposeLe");

-- CreateIndex
CREATE INDEX "pieces_agrement_idDemande_type_idx" ON "pieces_agrement"("idDemande", "type");

-- AddForeignKey
ALTER TABLE "pieces_agrement" ADD CONSTRAINT "pieces_agrement_idDemande_fkey" FOREIGN KEY ("idDemande") REFERENCES "demandes_agrement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_agrement" ADD CONSTRAINT "demandes_agrement_idStructureCreee_fkey" FOREIGN KEY ("idStructureCreee") REFERENCES "structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_agrement" ADD CONSTRAINT "demandes_agrement_idExaminePar_fkey" FOREIGN KEY ("idExaminePar") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Une piece appartient a une structure ou a une demande, jamais a rien.
--
-- `idStructure` etait obligatoire avant cette migration ; en la rendant
-- facultative pour accueillir les pieces d'une demande, on ouvrait la porte a
-- des pieces orphelines, invisibles des deux cotes et jamais nettoyees. Le
-- schema Prisma ne sait pas exprimer « au moins l'un des deux », la base si.
ALTER TABLE "pieces_agrement" ADD CONSTRAINT "pieces_agrement_un_proprietaire"
  CHECK ("idStructure" IS NOT NULL OR "idDemande" IS NOT NULL);

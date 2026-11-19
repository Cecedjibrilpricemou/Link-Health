-- CreateEnum
CREATE TYPE "StatutCandidatureLivreur" AS ENUM ('RECUE', 'EN_ANALYSE', 'VALIDEE', 'REFUSEE');

-- CreateEnum
CREATE TYPE "TypePieceLivreur" AS ENUM ('CNI_RECTO', 'CNI_VERSO', 'PERMIS_CONDUIRE', 'CARTE_GRISE', 'ASSURANCE', 'CERTIFICAT_RESIDENCE');

-- CreateTable
CREATE TABLE "candidatures_livreur" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "statut" "StatutCandidatureLivreur" NOT NULL DEFAULT 'RECUE',
    "deposeParAdministration" BOOLEAN NOT NULL DEFAULT false,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "dateNaissance" DATE NOT NULL,
    "sexe" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "email" TEXT,
    "prefecture" TEXT NOT NULL,
    "commune" TEXT,
    "quartier" TEXT NOT NULL,
    "idLivreurCree" TEXT,
    "motifRefus" TEXT,
    "idExaminePar" TEXT,
    "examineLe" TIMESTAMP(3),
    "deposeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidatures_livreur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieces_candidature_livreur" (
    "id" TEXT NOT NULL,
    "type" "TypePieceLivreur" NOT NULL,
    "fichier" TEXT NOT NULL,
    "typeMime" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "idCandidature" TEXT NOT NULL,
    "deposeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pieces_candidature_livreur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candidatures_livreur_numero_key" ON "candidatures_livreur"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "candidatures_livreur_idLivreurCree_key" ON "candidatures_livreur"("idLivreurCree");

-- CreateIndex
CREATE INDEX "candidatures_livreur_statut_deposeLe_idx" ON "candidatures_livreur"("statut", "deposeLe");

-- CreateIndex
CREATE INDEX "candidatures_livreur_telephone_statut_idx" ON "candidatures_livreur"("telephone", "statut");

-- CreateIndex
CREATE UNIQUE INDEX "pieces_candidature_livreur_idCandidature_type_key" ON "pieces_candidature_livreur"("idCandidature", "type");

-- AddForeignKey
ALTER TABLE "candidatures_livreur" ADD CONSTRAINT "candidatures_livreur_idLivreurCree_fkey" FOREIGN KEY ("idLivreurCree") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidatures_livreur" ADD CONSTRAINT "candidatures_livreur_idExaminePar_fkey" FOREIGN KEY ("idExaminePar") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces_candidature_livreur" ADD CONSTRAINT "pieces_candidature_livreur_idCandidature_fkey" FOREIGN KEY ("idCandidature") REFERENCES "candidatures_livreur"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ce que le schema Prisma ne sait pas dire, la base le tient.
--
-- Le sexe est `M` ou `F`, comme le profil patient : une autre valeur viendrait
-- d'un client qui a contourne le formulaire.
ALTER TABLE "candidatures_livreur" ADD CONSTRAINT "candidatures_livreur_sexe_connu"
  CHECK ("sexe" IN ('M', 'F'));

-- Un refus sans motif laisse le candidat redeposer le meme dossier : l'API
-- l'exige, la base le garantit meme si une ecriture la contourne.
ALTER TABLE "candidatures_livreur" ADD CONSTRAINT "candidatures_livreur_refus_motive"
  CHECK ("statut" <> 'REFUSEE' OR "motifRefus" IS NOT NULL);

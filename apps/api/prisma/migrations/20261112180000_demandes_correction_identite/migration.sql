-- R15 : le patient demande la correction de son identite ; l'accueil decide.
ALTER TYPE "TypeNotification" ADD VALUE IF NOT EXISTS 'IDENTITE_DEMANDE_TRAITEE';

CREATE TYPE "StatutDemandeCorrection" AS ENUM ('EN_ATTENTE', 'ACCEPTEE', 'REFUSEE');

CREATE TABLE "demandes_correction_identite" (
    "id" TEXT NOT NULL,
    "prenom" TEXT,
    "nom" TEXT,
    "sexe" TEXT,
    "dateNaissance" TEXT,
    "justification" TEXT NOT NULL,
    "statut" "StatutDemandeCorrection" NOT NULL DEFAULT 'EN_ATTENTE',
    "reponse" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traiteeLe" TIMESTAMP(3),
    "idPatient" TEXT NOT NULL,
    "idTraitePar" TEXT,

    CONSTRAINT "demandes_correction_identite_pkey" PRIMARY KEY ("id"),
    -- Une demande dit au moins ce qui est faux, et pourquoi.
    CONSTRAINT "demandes_correction_un_trait_au_moins"
        CHECK ("prenom" IS NOT NULL OR "nom" IS NOT NULL OR "sexe" IS NOT NULL OR "dateNaissance" IS NOT NULL),
    CONSTRAINT "demandes_correction_justifiee" CHECK (char_length(btrim("justification")) >= 10),
    -- Un refus se motive : le patient doit savoir quoi faire ensuite.
    CONSTRAINT "demandes_correction_refus_motive"
        CHECK ("statut" <> 'REFUSEE' OR char_length(btrim(coalesce("reponse", ''))) >= 10)
);

CREATE INDEX "demandes_correction_identite_statut_creeLe_idx" ON "demandes_correction_identite"("statut", "creeLe");
CREATE INDEX "demandes_correction_identite_idPatient_creeLe_idx" ON "demandes_correction_identite"("idPatient", "creeLe");

ALTER TABLE "demandes_correction_identite" ADD CONSTRAINT "demandes_correction_identite_idPatient_fkey" FOREIGN KEY ("idPatient") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "demandes_correction_identite" ADD CONSTRAINT "demandes_correction_identite_idTraitePar_fkey" FOREIGN KEY ("idTraitePar") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

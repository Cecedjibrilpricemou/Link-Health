-- R15 : correction tracee d'un trait d'identite, avec l'ancienne valeur.
CREATE TABLE "corrections_identite" (
    "id" TEXT NOT NULL,
    "champ" TEXT NOT NULL,
    "ancienneValeur" TEXT NOT NULL,
    "nouvelleValeur" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idPatient" TEXT NOT NULL,
    "idAuteur" TEXT,

    CONSTRAINT "corrections_identite_pkey" PRIMARY KEY ("id"),
    -- Les seuls traits corrigeables par ce chemin.
    CONSTRAINT "corrections_identite_champ_connu" CHECK ("champ" IN ('prenom', 'nom', 'sexe', 'dateNaissance')),
    -- Meme exigence que la fusion : une correction sans motif n'est pas contestable.
    CONSTRAINT "corrections_identite_motif_dit_quelque_chose" CHECK (char_length(btrim("motif")) >= 10)
);

CREATE INDEX "corrections_identite_idPatient_creeLe_idx" ON "corrections_identite"("idPatient", "creeLe");

ALTER TABLE "corrections_identite" ADD CONSTRAINT "corrections_identite_idPatient_fkey" FOREIGN KEY ("idPatient") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrections_identite" ADD CONSTRAINT "corrections_identite_idAuteur_fkey" FOREIGN KEY ("idAuteur") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

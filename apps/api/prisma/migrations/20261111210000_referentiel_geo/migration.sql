-- M1 : referentiel geographique generique (un arbre de lieux par installation).
-- Les niveaux administratifs du pays sont declares dans les parametres ;
-- aucune donnee n'est chargee ici : le jeu de depart d'un pays se charge a la
-- demande de l'administrateur.

CREATE TABLE "geo_lieux" (
    "id" TEXT NOT NULL,
    "niveau" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "idParent" TEXT,
    "voisins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aValider" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_lieux_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "geo_lieux_niveau_idx" ON "geo_lieux"("niveau");
CREATE INDEX "geo_lieux_idParent_idx" ON "geo_lieux"("idParent");

ALTER TABLE "geo_lieux" ADD CONSTRAINT "geo_lieux_idParent_fkey" FOREIGN KEY ("idParent") REFERENCES "geo_lieux"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

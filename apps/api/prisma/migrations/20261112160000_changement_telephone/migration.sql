-- Changement de numero de telephone : mot de passe, puis code au nouveau numero.
CREATE TABLE "changements_telephone" (
    "id" TEXT NOT NULL,
    "nouveauTelephone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "maxTentatives" INTEGER NOT NULL DEFAULT 5,
    "utiliseLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idUtilisateur" TEXT NOT NULL,

    CONSTRAINT "changements_telephone_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "changements_telephone_idUtilisateur_creeLe_idx" ON "changements_telephone"("idUtilisateur", "creeLe");

ALTER TABLE "changements_telephone" ADD CONSTRAINT "changements_telephone_idUtilisateur_fkey" FOREIGN KEY ("idUtilisateur") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

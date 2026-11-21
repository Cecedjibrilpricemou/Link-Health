-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INFIRMIER';

-- CreateTable
CREATE TABLE "soins_infirmiers" (
    "id" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "tensionSystolique" INTEGER,
    "tensionDiastolique" INTEGER,
    "frequenceCardiaque" INTEGER,
    "frequenceRespiratoire" INTEGER,
    "spo2" DOUBLE PRECISION,
    "poidsKg" DOUBLE PRECISION,
    "glycemie" DOUBLE PRECISION,
    "note" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idEpisode" TEXT NOT NULL,
    "idAuteur" TEXT NOT NULL,

    CONSTRAINT "soins_infirmiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soins_infirmiers_idEpisode_creeLe_idx" ON "soins_infirmiers"("idEpisode", "creeLe" DESC);

-- AddForeignKey
ALTER TABLE "soins_infirmiers" ADD CONSTRAINT "soins_infirmiers_idEpisode_fkey" FOREIGN KEY ("idEpisode") REFERENCES "episodes_soins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soins_infirmiers" ADD CONSTRAINT "soins_infirmiers_idAuteur_fkey" FOREIGN KEY ("idAuteur") REFERENCES "utilisateurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


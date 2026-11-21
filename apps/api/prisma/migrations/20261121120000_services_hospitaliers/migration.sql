
-- AlterTable
ALTER TABLE "profils_medecin" ADD COLUMN     "idService" TEXT;

-- CreateTable
CREATE TABLE "services_hospitaliers" (
    "id" TEXT NOT NULL,
    "idStructure" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_hospitaliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_hospitaliers_idStructure_actif_idx" ON "services_hospitaliers"("idStructure", "actif");

-- CreateIndex
CREATE UNIQUE INDEX "services_hospitaliers_idStructure_nom_key" ON "services_hospitaliers"("idStructure", "nom");

-- AddForeignKey
ALTER TABLE "profils_medecin" ADD CONSTRAINT "profils_medecin_idService_fkey" FOREIGN KEY ("idService") REFERENCES "services_hospitaliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services_hospitaliers" ADD CONSTRAINT "services_hospitaliers_idStructure_fkey" FOREIGN KEY ("idStructure") REFERENCES "structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;


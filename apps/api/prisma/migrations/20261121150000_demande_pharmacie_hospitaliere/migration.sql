-- AlterTable
ALTER TABLE "demandes_agrement" ADD COLUMN     "idDeposePar" TEXT,
ADD COLUMN     "idStructureParente" TEXT;

-- CreateIndex
CREATE INDEX "demandes_agrement_idStructureParente_statut_idx" ON "demandes_agrement"("idStructureParente", "statut");

-- AddForeignKey
ALTER TABLE "demandes_agrement" ADD CONSTRAINT "demandes_agrement_idStructureParente_fkey" FOREIGN KEY ("idStructureParente") REFERENCES "structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demandes_agrement" ADD CONSTRAINT "demandes_agrement_idDeposePar_fkey" FOREIGN KEY ("idDeposePar") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


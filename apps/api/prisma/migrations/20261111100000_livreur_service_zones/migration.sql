-- M4 : zone de travail du motard et disponibilite.
ALTER TABLE "profils_livreur" ADD COLUMN "communesDesservies" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "profils_livreur" ADD COLUMN "enService" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profils_livreur" ADD COLUMN "enServiceDepuis" TIMESTAMP(3);

-- Les motards deja actifs restent prevenus comme avant : ils sont mis en
-- service. Les nouveaux comptes commencent hors service.
UPDATE "profils_livreur" SET "enService" = true, "enServiceDepuis" = CURRENT_TIMESTAMP WHERE "estActif" = true;

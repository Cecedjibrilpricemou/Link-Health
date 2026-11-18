-- La zone d'une ordonnance ou d'une course devient la commune, dans sa
-- prefecture, au lieu du seul quartier (voir apps/api/src/utils/zone.ts).
--
-- Colonnes facultatives, rien n'est supprime ni reecrit : une commande, une
-- course ou un livreur sans commune garde l'ancienne maille du quartier.

-- Commande : la zone figee a la creation de l'appel.
ALTER TABLE "commandes" ADD COLUMN "prefectureRecherche" TEXT;
ALTER TABLE "commandes" ADD COLUMN "communeRecherche" TEXT;

-- Course : la commune des motards prevenus.
ALTER TABLE "courses" ADD COLUMN "commune" TEXT;
CREATE INDEX "courses_prefecture_commune_statut_idx" ON "courses"("prefecture", "commune", "statut");

-- Livreur : sa commune de travail.
ALTER TABLE "profils_livreur" ADD COLUMN "commune" TEXT;
CREATE INDEX "profils_livreur_prefecture_commune_estActif_idx" ON "profils_livreur"("prefecture", "commune", "estActif");

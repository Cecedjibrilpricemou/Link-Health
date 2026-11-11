-- M1-C : etape d'elargissement vers les communes voisines du referentiel.
ALTER TABLE "commandes" ADD COLUMN "voisinesLe" TIMESTAMP(3);
ALTER TABLE "commandes" ADD COLUMN "communesVoisines" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "courses" ADD COLUMN "voisinesLe" TIMESTAMP(3);
ALTER TABLE "courses" ADD COLUMN "communesVoisines" TEXT[] DEFAULT ARRAY[]::TEXT[];

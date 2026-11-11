-- M3 : point de repere et date de la position donnee par le patient.
ALTER TABLE "patients" ADD COLUMN "pointRepere" TEXT;
ALTER TABLE "patients" ADD COLUMN "positionLe" TIMESTAMP(3);

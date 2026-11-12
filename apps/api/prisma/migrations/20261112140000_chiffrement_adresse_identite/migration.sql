-- R4 : position, point de repere, lieu de naissance et nom de la mere chiffres.
--
-- Le chiffrement se fait dans l'application (la cle n'est pas dans la base) :
-- cette migration ne fait que preparer les colonnes. Les valeurs existantes,
-- encore en clair, sont lues telles quelles jusqu'au passage de
-- `npm run prisma:backfill-encryption -- --apply`, qui les chiffre et pose les
-- empreintes manquantes.

-- La position devient une chaine « latitude,longitude » : le chiffrement de
-- champ ne porte que sur du texte. Les positions deja donnees sont reprises.
ALTER TABLE "patients" ADD COLUMN "position" TEXT;
UPDATE "patients"
   SET "position" = "latitude"::text || ',' || "longitude"::text
 WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
ALTER TABLE "patients" DROP COLUMN "latitude";
ALTER TABLE "patients" DROP COLUMN "longitude";

-- Empreinte de recherche du nom de la mere, pour la detection de doublons.
ALTER TABLE "patients" ADD COLUMN "nomMereEmpreinte" TEXT;
CREATE INDEX "patients_nomMereEmpreinte_idx" ON "patients"("nomMereEmpreinte");

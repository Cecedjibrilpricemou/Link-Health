-- R1 : un appel sans preneur s'arrete apres un delai final au lieu d'attendre sans fin.
ALTER TYPE "TypeNotification" ADD VALUE IF NOT EXISTS 'COURSE_SANS_MOTARD';

-- Debut de l'appel en cours ; une relance par le patient le remet a l'heure.
ALTER TABLE "courses" ADD COLUMN "ouverteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "courses" SET "ouverteLe" = "creeeLe";

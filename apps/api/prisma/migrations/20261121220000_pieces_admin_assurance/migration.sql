-- Les pieces de l'administrateur d'une assurance (decision du 2026-11-21) :
-- statuts de la societe, passeport (a part de la carte d'identite), casier
-- judiciaire, mandat de la compagnie, photo d'identite.
-- AlterEnum
ALTER TYPE "TypePieceAgrement" ADD VALUE 'STATUTS_SOCIETE';
ALTER TYPE "TypePieceAgrement" ADD VALUE 'PASSEPORT_RESPONSABLE';
ALTER TYPE "TypePieceAgrement" ADD VALUE 'CASIER_JUDICIAIRE_RESPONSABLE';
ALTER TYPE "TypePieceAgrement" ADD VALUE 'MANDAT_RESPONSABLE';
ALTER TYPE "TypePieceAgrement" ADD VALUE 'PHOTO_RESPONSABLE';

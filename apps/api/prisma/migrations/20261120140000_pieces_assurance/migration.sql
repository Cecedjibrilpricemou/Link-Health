-- Le dossier d'une compagnie d'assurance ne tenait qu'en une piece :
-- l'agrement de la Banque Centrale. Il exige desormais aussi l'extrait RCCM
-- de la compagnie, et l'identite et la residence de son responsable.
--
-- `BEFORE 'AUTRE'` garde l'ordre de l'enum identique a celui du schema.

ALTER TYPE "TypePieceAgrement" ADD VALUE 'EXTRAIT_RCCM' BEFORE 'AUTRE';
ALTER TYPE "TypePieceAgrement" ADD VALUE 'PIECE_IDENTITE_RESPONSABLE' BEFORE 'AUTRE';
ALTER TYPE "TypePieceAgrement" ADD VALUE 'CERTIFICAT_RESIDENCE_RESPONSABLE' BEFORE 'AUTRE';

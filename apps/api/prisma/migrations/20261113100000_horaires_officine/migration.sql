-- Les horaires d'ouverture d'une officine.
--
-- Le visiteur qui trouve son produit se deplace : savoir si c'est ouvert lui
-- evite de traverser la ville pour trouver porte close.
--
-- Du JSON plutot qu'une table de sept lignes par structure : c'est une donnee
-- qu'on lit toujours en entier, qu'on n'interroge jamais ligne a ligne, et le
-- format accepte un second creneau quotidien plus tard sans migration.
--
-- Nul tant que l'officine n'a rien saisi — et ce n'est pas « ferme » : un
-- etablissement qui n'a pas rempli ses horaires ne doit pas apparaitre clos.

ALTER TABLE "structures" ADD COLUMN "horaires" JSONB;

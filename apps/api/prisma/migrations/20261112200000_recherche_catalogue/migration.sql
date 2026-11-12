-- A1 : la recherche publique de produits.
--
-- Un visiteur tape « paracetamol », sans accent et en minuscules, et attend
-- Doliprane. La comparaison insensible a la casse de Prisma ne rapproche pas
-- les accents : « Paracétamol » lui echappe. On stocke donc, a cote du
-- catalogue, le texte deja normalise sur lequel la recherche porte.
--
-- Meme procede que `nomMereEmpreinte` pour les doublons, a une difference
-- pres : ce texte n'est pas chiffre, parce qu'il faut pouvoir y chercher un
-- fragment et non seulement une egalite.

ALTER TABLE "medicaments" ADD COLUMN "rechercheTexte" TEXT;

-- Les lignes deja en base. La transformation reproduit
-- `normaliserPourEmpreinte` : minuscules, accents retires, espaces reduits.
-- `Ø` n'est pas traite ici parce que la fonction TypeScript ne le decompose
-- pas non plus : les deux doivent dire la meme chose, sinon un produit entre
-- par l'API et un produit repris a la migration ne se chercheraient pas
-- pareil.
UPDATE "medicaments"
SET "rechercheTexte" = btrim(regexp_replace(
  lower(translate(
    concat_ws(' ', "libelle", "nomCommercial", "dci", "classeTherapeutique"),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñŸÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYy'
  )),
  '\s+', ' ', 'g'));

-- L'index. Une recherche par fragment (`LIKE '%para%'`) ne tire rien d'un
-- index B-tree ordinaire : il faut un index trigramme. `pg_trgm` est une
-- extension standard, mais tous les hebergements ne l'autorisent pas, et une
-- migration qui echoue a l'installation bloquerait tout le deploiement.
-- On la tente, et a defaut on pose l'index simple : la recherche reste juste,
-- seulement plus lente quand le catalogue grossit.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX "medicaments_recherche_trgm"
    ON "medicaments" USING gin ("rechercheTexte" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  CREATE INDEX IF NOT EXISTS "medicaments_recherche_idx"
    ON "medicaments" ("rechercheTexte");
END $$;

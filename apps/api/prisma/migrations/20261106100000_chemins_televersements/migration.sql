-- Les fichiers televerses (avatars, logo) s'enregistrent desormais par leur
-- chemin, /uploads/<dossier>/<fichier>, et non plus avec l'hote qui les a
-- recus (voir apps/api/src/utils/chemin-media.ts).
--
-- Les adresses deja enregistrees portent l'hote du moment, souvent
-- http://localhost:3000 : elles sont ramenees a leur chemin. Seules les
-- adresses d'un fichier televerse sont touchees ; une adresse externe reste
-- telle quelle. Migration de donnees seulement, aucune colonne ne change.

UPDATE "utilisateurs"
SET "photoUrl" = regexp_replace("photoUrl", '^https?://[^/]+(/uploads/(avatars|logos)/[^/?#]+)$', '\1')
WHERE "photoUrl" ~ '^https?://[^/]+/uploads/(avatars|logos)/[^/?#]+$';

UPDATE "parametres_systeme"
SET "valeurs" = jsonb_set(
  "valeurs"::jsonb,
  '{identite,logoUrl}',
  to_jsonb(regexp_replace("valeurs"::jsonb #>> '{identite,logoUrl}', '^https?://[^/]+(/uploads/(avatars|logos)/[^/?#]+)$', '\1'))
)
WHERE "valeurs"::jsonb #>> '{identite,logoUrl}' ~ '^https?://[^/]+/uploads/(avatars|logos)/[^/?#]+$';

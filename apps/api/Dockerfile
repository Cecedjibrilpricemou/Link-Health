# Build context is the monorepo root (see docker/docker-compose.yml).
# npm workspaces need the root manifest + every workspace's package.json
# present to resolve correctly, even though this image only ships apps/api.

FROM node:24-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types

# `prisma generate` ne lit que le schema : il n'ouvre aucune connexion. Mais
# prisma.config.ts resout `env('DATABASE_URL')` des son chargement, et echoue
# si la variable manque — ce qui est toujours le cas pendant un build, ou
# l'environnement d'execution n'existe pas encore. Une adresse de facade
# suffit donc ici.
#
# C'est un ARG et non un ENV : il vaut pour les instructions de cette etape
# et ne subsiste pas dans l'image. L'adresse reelle est fournie a l'execution
# par docker-compose, y compris pour le service `migrate`, qui part de cette
# meme etape.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run prisma:generate --workspace=apps/api

# `@baobaoheath/shared-types` declare `main: src/index.ts`, ce qui convient au
# developpement — tsx charge le TypeScript a la volee — mais pas a une image
# ou l'API tourne en JavaScript compile. Il faut donc le compiler aussi.
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=apps/api

# Dependances de production seules. La CLI prisma et ce qu'elle tire —
# mysql2, deepmerge-ts, @prisma/config — restent hors de l'image : les
# migrations sont jouees par le job Deploy depuis le runner CI, jamais depuis
# le conteneur. Moins de surface, et les avis npm qui ne concernent que la
# CLI (voir scripts/audit-gate.mjs) ne s'appliquent plus a ce qui tourne.
#
# `--omit=dev` ne suffit pas : @prisma/client declare la CLI en peer
# optionnel, npm la reinstalle donc (flag devOptional du lock). Et
# `--omit=optional` casserait sharp, dont les binaires sont optionnels. D'ou
# le retrait explicite, --no-save pour ne toucher ni manifest ni lock.
# Valide le 13/09/2026 : /health repond 200 avec cet arbre (334 paquets
# contre 452), @prisma/client et les binaires sharp intacts.
FROM deps AS prod-deps
RUN npm ci --omit=dev \
 && npm uninstall --no-save --omit=dev prisma --workspace=apps/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/api
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/package.json ./package.json
COPY apps/api/prisma ./prisma

# npm workspaces ne copie pas un paquet local dans node_modules : il y pose
# un lien symbolique vers packages/shared-types, dossier absent de cette
# image. Le lien pointait donc dans le vide, et l'API s'arretait au demarrage
# sur « Cannot find module '@baobaoheath/shared-types' ».
#
# Le JavaScript compile prend la place du lien. Node trouve l'index.js du
# dossier sans autre declaration, et le package.json du paquet — qui designe
# du TypeScript — n'a pas a etre embarque.
COPY --from=build /repo/packages/shared-types/dist /repo/node_modules/@baobaoheath/shared-types

RUN chown -R node:node /repo
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]

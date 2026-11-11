-- M5 : un appel sans reponse dans la commune s'etend a toute la prefecture.
ALTER TABLE "commandes" ADD COLUMN "elargieLe" TIMESTAMP(3);
ALTER TABLE "courses" ADD COLUMN "elargieLe" TIMESTAMP(3);

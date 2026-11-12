import { PrismaClient } from './generated/client/client';
import { empreinteRecherche, encryptArray, encryptField, deepDecrypt } from '../utils/encryption.utils';

export interface FieldMap {
  scalar: string[];
  array: string[];
}

// Free-text medical/PII fields encrypted at rest. Deliberately excludes
// Diagnostic.libelle: it's grouped/filtered at the DB level for epidemic
// surveillance analytics (groupBy + contains), which non-deterministic
// AES-GCM ciphertext would break.
//
// Exported so prisma/backfill-encryption.ts can migrate existing plaintext
// rows using the exact same field list this extension encrypts going forward.
export const ENCRYPTED_FIELDS: Record<string, FieldMap> = {
  // R4 : l'adresse precise (point de repere, position « lat,lng ») et les
  // traits d'identite (lieu de naissance, nom de la mere) rejoignent les
  // champs chiffres. Une sauvegarde volee ne doit pas donner le domicile d'un
  // patient, ni les reponses aux questions qui servent a l'identifier.
  PatientProfile: {
    scalar: ['groupeSanguin', 'urgenceNom', 'urgenceTelephone', 'pointRepere', 'position', 'lieuNaissance', 'nomMere'],
    array: ['allergies', 'maladiesChroniques'],
  },
  Consultation: { scalar: ['motifPrincipal', 'resumeIa', 'notesAsc', 'notesMedecin'], array: ['symptomes'] },
  Ordonnance: { scalar: ['posologie', 'instructions'], array: [] },
  Vaccination: { scalar: ['reaction'], array: [] },
  Message: { scalar: ['contenu'], array: [] },
  PersonneAssuree: { scalar: ['lieuNaissance', 'nationalite', 'adresse'], array: [] },
};

/**
 * R4 : les champs chiffres qu'il faut encore pouvoir rapprocher en base, et
 * la colonne qui porte leur empreinte (voir `empreinteRecherche`).
 *
 * L'empreinte se calcule **ici**, sur la valeur en clair, juste avant le
 * chiffrement : aucun service n'a a y penser, et aucun ne peut l'oublier.
 * Une recherche, elle, compare l'empreinte (`nomMereEmpreinte`), jamais le
 * champ chiffre, qui ne correspondrait a rien.
 */
export const EMPREINTES: Record<string, Record<string, string>> = {
  PatientProfile: { nomMere: 'nomMereEmpreinte' },
};

function poserEmpreintes(record: Record<string, unknown>, empreintes: Record<string, string>): void {
  for (const [champ, colonne] of Object.entries(empreintes)) {
    const valeur = record[champ];
    if (typeof valeur === 'string') record[colonne] = empreinteRecherche(valeur);
    else if (valeur === null) record[colonne] = null;
  }
}

function encryptDataObject(data: unknown, map: FieldMap, empreintes?: Record<string, string>): void {
  if (!data || typeof data !== 'object') return;
  const record = data as Record<string, unknown>;

  // Avant le chiffrement : l'empreinte se calcule sur le clair.
  if (empreintes) poserEmpreintes(record, empreintes);
  for (const field of map.scalar) {
    if (typeof record[field] === 'string') record[field] = encryptField(record[field] as string);
  }
  for (const field of map.array) {
    if (Array.isArray(record[field])) record[field] = encryptArray(record[field] as string[]);
  }
}

function encryptArgs(args: unknown, map: FieldMap, empreintes?: Record<string, string>): void {
  if (!args || typeof args !== 'object') return;
  const record = args as Record<string, unknown>;

  if (Array.isArray(record.data)) {
    record.data.forEach((item) => encryptDataObject(item, map, empreintes));
  } else if (record.data) {
    encryptDataObject(record.data, map, empreintes);
  }
  // upsert
  if (record.create) encryptDataObject(record.create, map, empreintes);
  if (record.update) encryptDataObject(record.update, map, empreintes);
}

// Le client peut porter des omissions globales (`OMISSIONS_GLOBALES`, config/prisma.ts) :
// la contrainte doit accepter n'importe quelle configuration d'omission.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withFieldEncryption<T extends PrismaClient<never, any>>(client: T) {
  return client.$extends({
    name: 'field-encryption',
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          const map = model ? ENCRYPTED_FIELDS[model] : undefined;
          if (map) encryptArgs(args, map, EMPREINTES[model!]);

          const result = await query(args);
          return deepDecrypt(result);
        },
      },
    },
  });
}

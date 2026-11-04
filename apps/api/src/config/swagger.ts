import { Express, Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { logger } from './logger';
import { getIdentitePlateforme } from '../services/parametres.service';

export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'API', // complete a la volee avec le nom de la plateforme (Parametres > Identite)
    version: '1.0.0',
    description: 'API de la plateforme de parcours de soins connecté',
    contact: {
      name: 'Équipe technique',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Serveur de développement',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT obtenu via /api/v1/auth/login',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object' },
          error: { type: 'string' },
        },
      },
      RegisterDto: {
        type: 'object',
        required: ['telephone', 'motDePasse', 'prenom', 'nom'],
        properties: {
          telephone: { type: 'string', example: '+224621000000', description: 'Numéro de téléphone guinéen' },
          motDePasse: { type: 'string', example: 'MotDePasse123!', description: 'Minimum 8 caractères' },
          prenom: { type: 'string', example: 'Mamadou' },
          nom: { type: 'string', example: 'Diallo' },
          role: { type: 'string', enum: ['PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'PHARMACIEN', 'ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'], default: 'PATIENT' },
        },
      },
      LoginDto: {
        type: 'object',
        required: ['telephone', 'motDePasse'],
        properties: {
          telephone: { type: 'string', example: '+224621000000' },
          motDePasse: { type: 'string', example: 'MotDePasse123!' },
        },
      },
      AuthAck: {
        type: 'object',
        description: "Les tokens ne sont plus renvoyés dans le corps de la réponse : ils sont posés en cookies httpOnly (bb_access, bb_refresh) accompagnés d'un cookie bb_csrf (non httpOnly) à répercuter dans l'en-tête X-CSRF-Token sur toute requête mutante.",
        properties: {
          authenticated: { type: 'boolean', example: true },
        },
      },
      Utilisateur: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          telephone: { type: 'string' },
          email: { type: 'string' },
          prenom: { type: 'string' },
          nom: { type: 'string' },
          role: { type: 'string' },
          langue: { type: 'string' },
          photoUrl: { type: 'string' },
          estActif: { type: 'boolean' },
          creeLe: { type: 'string', format: 'date-time' },
        },
      },
      CreatePatientDto: {
        type: 'object',
        required: ['telephone', 'motDePasse', 'prenom', 'nom', 'dateNaissance', 'sexe', 'prefecture'],
        properties: {
          telephone: { type: 'string', example: '+224621000000' },
          motDePasse: { type: 'string', example: 'MotDePasse123!' },
          prenom: { type: 'string', example: 'Fatoumata' },
          nom: { type: 'string', example: 'Camara' },
          dateNaissance: { type: 'string', format: 'date', example: '1995-06-15' },
          sexe: { type: 'string', enum: ['M', 'F', 'A'], example: 'F' },
          prefecture: { type: 'string', example: 'Conakry' },
          sousPrefecture: { type: 'string', example: 'Matam' },
          village: { type: 'string', example: 'Kipé' },
          groupeSanguin: { type: 'string', example: 'O+' },
          allergies: { type: 'array', items: { type: 'string' }, example: ['Pénicilline'] },
          maladiesChroniques: { type: 'array', items: { type: 'string' }, example: ['Diabète'] },
          urgenceNom: { type: 'string', example: 'Ibrahima Camara' },
          urgenceTelephone: { type: 'string', example: '+224622000000' },
        },
      },
      PatientProfile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          qrCode: { type: 'string' },
          dateNaissance: { type: 'string', format: 'date-time' },
          sexe: { type: 'string' },
          groupeSanguin: { type: 'string' },
          allergies: { type: 'array', items: { type: 'string' } },
          maladiesChroniques: { type: 'array', items: { type: 'string' } },
          prefecture: { type: 'string' },
          sousPrefecture: { type: 'string' },
          village: { type: 'string' },
          photoUrl: { type: 'string' },
          urgenceNom: { type: 'string' },
          urgenceTelephone: { type: 'string' },
          creeLe: { type: 'string', format: 'date-time' },
          utilisateur: { $ref: '#/components/schemas/Utilisateur' },
        },
      },
      CreateConsultationDto: {
        type: 'object',
        required: ['idPatient', 'motifPrincipal'],
        properties: {
          idPatient: { type: 'string', example: 'clxxx123' },
          motifPrincipal: { type: 'string', example: 'Fièvre et maux de tête' },
          symptomes: { type: 'array', items: { type: 'string' }, example: ['Fièvre', 'Céphalées', 'Frissons'] },
        },
      },
      VitalsDto: {
        type: 'object',
        properties: {
          temperature: { type: 'number', example: 38.5, description: '°C — alerte si > 39.5' },
          poidsKg: { type: 'number', example: 65.5 },
          tailleCm: { type: 'number', example: 170 },
          perimetreBrachial: { type: 'number', example: 125, description: 'mm' },
          tensionSystolique: { type: 'integer', example: 120, description: 'mmHg' },
          tensionDiastolique: { type: 'integer', example: 80, description: 'mmHg' },
          frequenceCardiaque: { type: 'integer', example: 75, description: 'bpm' },
          frequenceRespiratoire: { type: 'integer', example: 18, description: 'resp/min' },
          spo2: { type: 'number', example: 98, description: '% — alerte si < 95' },
          glycemie: { type: 'number', example: 1.1, description: 'g/L — alerte si > 3' },
        },
      },
      DiagnosticDto: {
        type: 'object',
        required: ['libelle', 'source'],
        properties: {
          libelle: { type: 'string', example: 'Paludisme simple' },
          codeIcd11: { type: 'string', example: '1F40' },
          typeDiagnostic: { type: 'string', enum: ['PRINCIPAL', 'DIFFERENTIEL', 'SECONDAIRE'], default: 'PRINCIPAL' },
          severite: { type: 'string', enum: ['LEGER', 'MODERE', 'SEVERE', 'CRITIQUE'] },
          source: { type: 'string', enum: ['IA_LOCALE', 'IA_CLAUDE', 'MEDECIN', 'ASC'] },
        },
      },
      OrdonnanceDto: {
        type: 'object',
        required: ['idMedicament', 'posologie', 'frequence', 'dureeJours'],
        properties: {
          idMedicament: { type: 'string', example: 'clxxx456' },
          posologie: { type: 'string', example: '1 comprimé matin et soir' },
          frequence: { type: 'string', example: '2 fois par jour pendant 3 jours' },
          dureeJours: { type: 'integer', example: 3 },
          instructions: { type: 'string', example: 'Prendre avec de la nourriture' },
        },
      },
      ReferralDto: {
        type: 'object',
        required: ['idStructureCible', 'urgence', 'resumeClinique'],
        properties: {
          idStructureCible: { type: 'string', example: 'clxxx789' },
          urgence: { type: 'string', enum: ['ROUTINE', 'URGENT', 'URGENCE_VITALE'], example: 'URGENT' },
          resumeClinique: { type: 'string', example: 'Patient avec paludisme grave — fièvre > 39.5°C + convulsions' },
        },
      },
      Consultation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          statut: { type: 'string', enum: ['PLANIFIEE', 'EN_COURS', 'TERMINEE', 'ANNULEE', 'REFERENCEE'] },
          motifPrincipal: { type: 'string' },
          symptomes: { type: 'array', items: { type: 'string' } },
          notesAsc: { type: 'string' },
          protocoleUtilise: { type: 'string' },
          confianceIa: { type: 'number' },
          resumeIa: { type: 'string' },
          consulteeLE: { type: 'string', format: 'date-time' },
          patient: { $ref: '#/components/schemas/PatientProfile' },
          constantes: { $ref: '#/components/schemas/VitalsDto' },
        },
      },
      CreateStockDto: {
        type: 'object',
        required: ['idMedicament', 'quantite', 'unite'],
        properties: {
          idMedicament: { type: 'string', example: 'clxxx123' },
          quantite: { type: 'integer', example: 50 },
          unite: { type: 'string', example: 'comprimés' },
          seuilAlerte: { type: 'integer', example: 10, description: 'Alerte si quantite <= seuil' },
          datePeremption: { type: 'string', format: 'date', example: '2027-06-30' },
        },
      },
      UpdateStockDto: {
        type: 'object',
        required: ['quantite', 'unite'],
        properties: {
          quantite: { type: 'integer', example: 35 },
          unite: { type: 'string', example: 'comprimés' },
          seuilAlerte: { type: 'integer', example: 10 },
          datePeremption: { type: 'string', format: 'date', example: '2027-06-30' },
        },
      },
      Stock: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          quantite: { type: 'integer' },
          seuilAlerte: { type: 'integer' },
          unite: { type: 'string' },
          datePeremption: { type: 'string', format: 'date-time' },
          enAlerte: { type: 'boolean', description: 'true si quantite <= seuilAlerte' },
          modifieLe: { type: 'string', format: 'date-time' },
          medicament: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              dci: { type: 'string' },
              nomCommercial: { type: 'string' },
              forme: { type: 'string' },
              dosage: { type: 'string' },
            },
          },
        },
      },
      RapportMensuel: {
        type: 'object',
        properties: {
          periode: { type: 'object', properties: { mois: { type: 'integer' }, annee: { type: 'integer' }, debut: { type: 'string', format: 'date-time' }, fin: { type: 'string', format: 'date-time' } } },
          statistiques: { type: 'object', properties: { totalConsultations: { type: 'integer' }, consultationsTerminees: { type: 'integer' }, totalReferences: { type: 'integer' }, totalVaccinations: { type: 'integer' }, totalRendezVous: { type: 'integer' }, rendezVousHonores: { type: 'integer' } } },
          topDiagnostics: { type: 'array', items: { type: 'object', properties: { libelle: { type: 'string' }, count: { type: 'integer' } } } },
          alertesStock: { type: 'integer' },
        },
      },
      ValiderConsultationDto: {
        type: 'object',
        required: ['notesMedecin'],
        properties: {
          notesMedecin: { type: 'string', example: 'Diagnostic confirmé — paludisme simple traité correctement' },
          idOrdonnances: { type: 'array', items: { type: 'string' }, description: 'IDs des ordonnances à signer' },
        },
      },
      RepondreReferencementDto: {
        type: 'object',
        required: ['statut'],
        properties: {
          statut: { type: 'string', enum: ['ACCEPTE', 'REFUSE'], example: 'ACCEPTE' },
          motifRefus: { type: 'string', example: 'Capacité insuffisante — redirectionner vers CHU' },
        },
      },
      SendMessageDto: {
        type: 'object',
        required: ['idDestinataire', 'contenu'],
        properties: {
          idDestinataire: { type: 'string', example: 'clxxx123' },
          contenu: { type: 'string', example: 'Bonjour, veuillez surveiller la tension artérielle du patient.' },
          idConsultation: { type: 'string', description: 'Optionnel — lier le message à une consultation' },
        },
      },
      DashboardStats: {
        type: 'object',
        properties: {
          consultationsValidees: { type: 'integer' },
          consultationsEnAttente: { type: 'integer' },
          referencementsEnAttente: { type: 'integer' },
          messagesNonLus: { type: 'integer' },
          structure: { type: 'object' },
        },
      },
      InitierPaiementDto: {
        type: 'object',
        required: ['idConsultation', 'montantGnf', 'modePaiement'],
        properties: {
          idConsultation: { type: 'string', example: 'clxxx123' },
          montantGnf: { type: 'integer', example: 50000, description: 'Montant en Francs Guinéens' },
          modePaiement: { type: 'string', enum: ['ORANGE_MONEY', 'MTN_MOMO', 'ESPECES'], example: 'ORANGE_MONEY' },
          numeroOperateur: { type: 'string', example: '+224621000000', description: 'Requis pour Orange Money et MTN MoMo' },
        },
      },
      ConfirmerPaiementDto: {
        type: 'object',
        required: ['referenceOperateur'],
        properties: {
          referenceOperateur: { type: 'string', example: 'OM-1745678901234-5678', description: "Référence de transaction retournée par l'opérateur" },
        },
      },
      Facture: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          montantGnf: { type: 'integer', description: 'Montant en Francs Guinéens' },
          statut: { type: 'string', enum: ['EN_ATTENTE', 'PAYEE', 'PARTIELLE', 'ANNULEE', 'REMBOURSEE'] },
          modePaiement: { type: 'string', enum: ['ORANGE_MONEY', 'MTN_MOMO', 'ESPECES'] },
          referenceOperateur: { type: 'string' },
          numeroOperateur: { type: 'string' },
          payeeLe: { type: 'string', format: 'date-time' },
          creeLe: { type: 'string', format: 'date-time' },
          patient: { $ref: '#/components/schemas/PatientProfile' },
          consultation: { $ref: '#/components/schemas/Consultation' },
        },
      },
      CreateVaccinationDto: {
        type: 'object',
        required: ['idPatient', 'vaccinNom'],
        properties: {
          idPatient: { type: 'string', example: 'clxxx123' },
          vaccinNom: { type: 'string', example: 'BCG' },
          codeEpi: { type: 'string', example: 'BCG-001', description: 'Code EPI national' },
          numeroLot: { type: 'string', example: 'LOT-2026-001' },
          siteInjection: { type: 'string', example: 'Bras gauche — deltoid' },
          reaction: { type: 'string', example: 'Aucune réaction observée' },
          dateProchaineD: { type: 'string', format: 'date', example: '2026-07-15', description: 'Date du prochain rappel' },
        },
      },
      UpdateVaccinationDto: {
        type: 'object',
        properties: {
          reaction: { type: 'string', example: "Légère rougeur au site d'injection" },
          urlCertificat: { type: 'string', example: 'https://s3.amazonaws.com/baobao/certificats/vaccin-123.pdf' },
          dateProchaineD: { type: 'string', format: 'date', example: '2026-07-15' },
        },
      },
      Vaccination: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          vaccinNom: { type: 'string' },
          codeEpi: { type: 'string' },
          numeroLot: { type: 'string' },
          siteInjection: { type: 'string' },
          reaction: { type: 'string' },
          urlCertificat: { type: 'string' },
          dateProchaineD: { type: 'string', format: 'date-time' },
          administreLe: { type: 'string', format: 'date-time' },
          patient: { $ref: '#/components/schemas/PatientProfile' },
          administrePar: { type: 'object', properties: { prenom: { type: 'string' }, nom: { type: 'string' }, role: { type: 'string' } } },
        },
      },
      StatsVaccination: {
        type: 'object',
        properties: {
          totalAdministrees: { type: 'integer' },
          topVaccins: { type: 'array', items: { type: 'object', properties: { vaccinNom: { type: 'string' }, count: { type: 'integer' } } } },
          parPrefecture: { type: 'string' },
        },
      },
      SendSmsDto: {
        type: 'object',
        required: ['telephone', 'message'],
        properties: {
          telephone: { type: 'string', example: '+224621000000', description: 'Numéro de téléphone destinataire' },
          message: { type: 'string', example: 'PLATEFORME: Votre rendez-vous est demain à 9h00.', description: 'Contenu du SMS (max 160 caractères)' },
        },
      },
      SmsMasseDto: {
        type: 'object',
        required: ['prefecture', 'message'],
        properties: {
          prefecture: { type: 'string', example: 'Conakry', description: 'Préfecture cible pour envoi en masse' },
          message: { type: 'string', example: 'PLATEFORME: Campagne de vaccination contre la rougeole — rendez-vous ce samedi.', description: 'Message à envoyer à tous les patients de la préfecture' },
        },
      },
      SmsResult: {
        type: 'object',
        properties: {
          messageId: { type: 'string', example: 'AT-1745678901234-5678', description: "ID de message Africa's Talking" },
          statut: { type: 'string', example: 'ENVOYE' },
        },
      },
      SmsMasseResult: {
        type: 'object',
        properties: {
          total: { type: 'integer', description: 'Nombre total de patients dans la préfecture' },
          envoyes: { type: 'integer', description: 'Nombre de SMS envoyés avec succès' },
          echoues: { type: 'integer', description: 'Nombre de SMS en échec' },
          prefecture: { type: 'string' },
        },
      },
      RappelsResult: {
        type: 'object',
        properties: {
          rendezVousARappeler: { type: 'integer', description: 'Nombre de RDV à rappeler demain' },
          vaccinationsARappeler: { type: 'integer', description: 'Nombre de vaccinations dues dans 7 jours' },
          ids: {
            type: 'object',
            properties: {
              rendezVous: { type: 'array', items: { type: 'string' } },
              vaccinations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      // ─── Analytics ─────────────────────────────────────
      DashboardGlobal: {
        type: 'object',
        properties: {
          kpis: {
            type: 'object',
            properties: {
              totalPatients: { type: 'integer' },
              totalConsultations: { type: 'integer' },
              totalVaccinations: { type: 'integer' },
                patientsVaccines: { type: 'integer', description: 'Patients ayant recu au moins une dose' },
              totalReferencements: { type: 'integer' },
              totalAsc: { type: 'integer' },
            },
          },
          consultationsParStatut: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                statut: { type: 'string' },
                count: { type: 'integer' },
              },
            },
          },
          topPathologies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pathologie: { type: 'string' },
                count: { type: 'integer' },
              },
            },
          },
        },
      },
      HeatmapData: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            prefecture: { type: 'string' },
            count: { type: 'integer' },
            pathologies: { type: 'object', additionalProperties: { type: 'integer' } },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
          },
        },
      },
      AlerteEpidemique: {
        type: 'object',
        properties: {
          pathologie: { type: 'string', example: 'Paludisme' },
          prefecture: { type: 'string', example: 'Conakry' },
          nombre: { type: 'integer', example: 25 },
          seuil: { type: 'integer', example: 20 },
          niveau: { type: 'string', enum: ['ATTENTION', 'ALERTE', 'URGENCE'], example: 'ALERTE' },
          dateDetection: { type: 'string', format: 'date-time' },
        },
      },
      CouvertureVaccinale: {
        type: 'object',
        properties: {
          totalPatients: { type: 'integer' },
          couverture: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                vaccin: { type: 'string' },
                patientsVaccines: { type: 'integer' },
                totalPatients: { type: 'integer' },
                tauxCouverture: { type: 'integer', description: 'Pourcentage 0-100' },
              },
            },
          },
          prefecture: { type: 'string' },
        },
      },
      TendanceMensuelle: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            mois: { type: 'string', example: 'avr. 2026' },
            consultations: { type: 'integer' },
            vaccinations: { type: 'integer' },
            referencements: { type: 'integer' },
          },
        },
      },
      ExportData: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['JSON', 'CSV'] },
          total: { type: 'integer' },
          contenu: { type: 'object', description: 'Données JSON ou texte CSV selon le format choisi' },
        },
      },
    },
  },
  paths: {
    // ─── AUTH ─────────────────────────────────────────────
    '/api/v1/auth/register': {
      post: {
        tags: ['Authentification'],
        summary: 'Créer un nouveau compte',
        description: 'Enregistre un nouvel utilisateur et retourne une paire de tokens JWT',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterDto' } } } },
        responses: {
          201: { description: 'Compte créé avec succès', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/AuthAck' } } }] } } } },
          400: { description: 'Numéro déjà utilisé ou données invalides' },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Authentification'],
        summary: 'Se connecter',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginDto' } } } },
        responses: {
          200: { description: 'Connexion réussie', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/AuthAck' } } }] } } } },
          401: { description: 'Identifiants invalides' },
        },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Authentification'],
        summary: 'Renouveler les tokens',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } } },
        responses: {
          200: { description: 'Tokens renouvelés', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/AuthAck' } } }] } } } },
          401: { description: 'Refresh token invalide ou expiré' },
        },
      },
    },
    '/api/v1/auth/logout': {
      post: { tags: ['Authentification'], summary: 'Se déconnecter', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Déconnexion réussie' }, 401: { description: 'Token manquant ou invalide' } } },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Authentification'],
        summary: "Profil de l'utilisateur connecté",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Profil récupéré', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/Utilisateur' } } }] } } } },
          401: { description: 'Non authentifié' },
          404: { description: 'Utilisateur non trouvé' },
        },
      },
    },
    // ─── PATIENTS ─────────────────────────────────────────
    '/api/v1/patients': {
      post: {
        tags: ['Patients'],
        summary: 'Créer un compte patient',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePatientDto' } } } },
        responses: {
          201: { description: 'Patient créé avec succès', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: { patient: { $ref: '#/components/schemas/PatientProfile' } } } } }] } } } },
          400: { description: 'Numéro déjà utilisé ou données invalides' },
        },
      },
      get: {
        tags: ['Patients'],
        summary: 'Liste des patients',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'prefecture', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Liste récupérée' }, 401: { description: 'Non authentifié' }, 403: { description: 'Accès refusé' } },
      },
    },
    '/api/v1/patients/me': {
      get: { tags: ['Patients'], summary: 'Mon profil patient', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Profil récupéré', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/PatientProfile' } } }] } } } }, 401: { description: 'Non authentifié' }, 404: { description: 'Profil non trouvé' } } },
      put: { tags: ['Patients'], summary: 'Mettre à jour mon profil', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { prenom: { type: 'string' }, nom: { type: 'string' }, email: { type: 'string' }, langue: { type: 'string', enum: ['fr', 'pu', 'ml'] }, photoUrl: { type: 'string' }, groupeSanguin: { type: 'string' }, allergies: { type: 'array', items: { type: 'string' } }, maladiesChroniques: { type: 'array', items: { type: 'string' } } } } } } }, responses: { 200: { description: 'Profil mis à jour' }, 401: { description: 'Non authentifié' } } },
    },
    '/api/v1/patients/me/export': {
      get: { tags: ['Patients'], summary: 'Exporter mon dossier médical', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Dossier exporté' }, 401: { description: 'Non authentifié' }, 404: { description: 'Patient non trouvé' } } },
    },
    '/api/v1/patients/qr/{qrCode}': {
      get: { tags: ['Patients'], summary: 'Rechercher par QR Code', security: [{ bearerAuth: [] }], parameters: [{ name: 'qrCode', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Patient trouvé' }, 404: { description: 'Patient non trouvé' } } },
    },
    '/api/v1/patients/{id}': {
      get: { tags: ['Patients'], summary: "Détail d'un patient par ID", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Patient trouvé' }, 404: { description: 'Patient non trouvé' } } },
    },
    // ─── CONSULTATIONS ────────────────────────────────────
    '/api/v1/consultations': {
      get: { tags: ['Consultations'], summary: 'Liste des consultations', security: [{ bearerAuth: [] }], parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'idPatient', in: 'query', schema: { type: 'string' } }, { name: 'idAsc', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Liste récupérée' }, 401: { description: 'Non authentifié' }, 403: { description: 'Accès refusé' } } },
      post: { tags: ['Consultations'], summary: 'Ouvrir une nouvelle consultation', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateConsultationDto' } } } }, responses: { 201: { description: 'Consultation créée', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/Consultation' } } }] } } } }, 400: { description: 'Données invalides' }, 403: { description: 'Profil ASC non trouvé' } } },
    },
    '/api/v1/consultations/{id}': {
      get: { tags: ['Consultations'], summary: "Détail d'une consultation", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Consultation trouvée' }, 404: { description: 'Consultation non trouvée' } } },
      put: { tags: ['Consultations'], summary: 'Mettre à jour une consultation', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { motifPrincipal: { type: 'string' }, symptomes: { type: 'array', items: { type: 'string' } }, notesAsc: { type: 'string' }, protocoleUtilise: { type: 'string' }, confianceIa: { type: 'number' } } } } } }, responses: { 200: { description: 'Consultation mise à jour' }, 400: { description: 'Données invalides ou consultation terminée' } } },
    },
    '/api/v1/consultations/{id}/vitals': {
      post: { tags: ['Consultations'], summary: 'Saisir les constantes vitales', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/VitalsDto' } } } }, responses: { 200: { description: 'Constantes enregistrées' }, 400: { description: 'Consultation non trouvée' } } },
    },
    '/api/v1/consultations/{id}/complete': {
      post: { tags: ['Consultations'], summary: 'Clôturer une consultation', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Consultation clôturée' }, 400: { description: 'Consultation déjà terminée' } } },
    },
    '/api/v1/consultations/{id}/ordonnances': {
      post: { tags: ['Consultations'], summary: 'Prescrire un médicament (EF-05)', description: "Ajoute un médicament à l'ordonnance en cours de rédaction de la consultation. Si aucune ordonnance n'est ouverte, elle est créée avec son numéro (OR-AAAA-NNNNNN), son code de vérification et sa durée de validité. Deux médicaments prescrits pendant la même consultation forment donc une seule ordonnance.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OrdonnanceDto' } } } }, responses: { 201: { description: "Ligne d'ordonnance ajoutée" }, 400: { description: 'Médicament non trouvé' } } },
    },
    '/api/v1/consultations/{id}/ordonnances/alertes': {
      post: {
        tags: ['Consultations'],
        summary: 'Alertes avant prescription (EF-05-05, EF-05-06)',
        description: "Ce que le prescripteur doit savoir avant d'ajouter ce médicament : allergies déclarées (y compris par famille ATC), contre-indications face aux maladies chroniques du dossier, interactions avec les traitements encore en cours. L'alerte ne bloque jamais — le prescripteur voit le patient, le référentiel voit une paire de molécules. `motifRequis` dit si au moins une alerte dépasse la simple précaution ; le client ne recalcule pas ce seuil. Sauter cet appel ne contourne rien : l'API recalcule les mêmes alertes à la création et les fige sur la ligne.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Identifiant de la consultation' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idMedicament'], properties: { idMedicament: { type: 'string' } } } } } },
        responses: { 200: { description: 'Alertes et seuil de motif' }, 403: { description: 'Accès refusé' }, 404: { description: 'Consultation ou médicament non trouvé' } },
      },
    },
    // ─── Commande pharmacie (EF-07) ───────────────────────────
    '/api/v1/commandes': {
      post: {
        tags: ['Commandes'],
        summary: 'Lancer la recherche d’une pharmacie (EF-07)',
        description: "Dès l'ordonnance signée, les pharmacies **partenaires du quartier du patient** sont interrogées : détenez-vous la totalité des produits ? Une ordonnance non signée est refusée — elle n'est pas opposable. Si aucune pharmacie partenaire n'existe dans le quartier, la commande conclut directement `SANS_PHARMACIE` : le patient repart avec son ordonnance.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idOrdonnance'], properties: { idOrdonnance: { type: 'string' } } } } } },
        responses: { 201: { description: 'Commande créée, pharmacies notifiées' }, 400: { description: 'Ordonnance non signée ou sans médicament' }, 409: { description: 'Une commande existe déjà pour cette ordonnance' } },
      },
    },
    '/api/v1/commandes/pharmacie': {
      get: { tags: ['Commandes'], summary: 'File du comptoir', description: "Les appels en cours du quartier de la pharmacie qu'elle n'a pas encore refusés, et les commandes qu'elle a prises.", security: [{ bearerAuth: [] }], responses: { 200: { description: 'Liste des commandes' }, 403: { description: 'Pharmacie non partenaire ou sans structure' } } },
    },
    '/api/v1/commandes/{id}/disponibilite': {
      post: {
        tags: ['Commandes'],
        summary: 'Répondre à l’appel — et prendre la commande (EF-07)',
        description: "`aTousLesProduits: true` **tente** de prendre la commande. L'attribution est atomique : deux pharmacies qui répondent à la même seconde donnent un gagnant et un perdant, jamais deux gagnants. La perdante reçoit un 409. Un refus est enregistré tel quel ; quand toutes les sollicitées ont refusé, la commande passe `SANS_PHARMACIE` et le patient comme le médecin sont avertis.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['aTousLesProduits'], properties: { aTousLesProduits: { type: 'boolean' } } } } } },
        responses: { 200: { description: 'Réponse enregistrée' }, 403: { description: 'Quartier ou partenariat non conforme' }, 409: { description: 'Une autre pharmacie a été plus rapide' } },
      },
    },
    '/api/v1/commandes/{id}/retirer': {
      post: { tags: ['Commandes'], summary: 'Rendre la commande', description: "La pharmacie n'avait finalement pas tout. Le verrou se rouvre et les autres retrouvent la main. Le motif est exigé : le patient attend une explication, pas un désistement muet.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['motif'], properties: { motif: { type: 'string', minLength: 5 } } } } } }, responses: { 200: { description: 'Commande rendue' }, 403: { description: "La commande n'est pas la vôtre" } } },
    },
    '/api/v1/commandes/{id}/mode-remise': {
      post: { tags: ['Commandes'], summary: 'Choisir retrait ou livraison (patient)', description: "**La livraison n'est jamais imposée** : beaucoup de patients habitent à côté d'une pharmacie et iront chercher eux-mêmes. Seul le patient concerné peut choisir.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['RETRAIT_PHARMACIE', 'LIVRAISON'] } } } } } }, responses: { 200: { description: 'Mode enregistré' }, 400: { description: "Aucune pharmacie n'a encore pris la commande" }, 403: { description: 'Cette commande ne vous appartient pas' } } },
    },
    // ─── Ordonnance : consultation et impression (EF-05, EF-06-02) ───
    '/api/v1/ordonnances/me': {
      get: { tags: ['Ordonnances'], summary: 'Mes ordonnances (patient)', description: "Les ordonnances du patient connecté, la plus récente d'abord. Le code de vérification en fait partie : c'est le secret que le patient présente au comptoir s'il n'a pas son QR.", security: [{ bearerAuth: [] }], responses: { 200: { description: 'Liste des ordonnances' }, 404: { description: 'Profil patient non trouvé' } } },
    },
    '/api/v1/ordonnances/{id}': {
      get: { tags: ['Ordonnances'], summary: 'Détail d’une ordonnance', description: "L'habilitation se juge sur la consultation : le patient son dossier, l'ASC ses consultations, le médecin celles de sa structure.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Ordonnance' }, 403: { description: 'Accès refusé' }, 404: { description: 'Ordonnance non trouvée' } } },
    },
    '/api/v1/ordonnances/{id}/document': {
      get: { tags: ['Ordonnances'], summary: 'Ordonnance imprimable (EF-06-02)', description: "Document HTML prêt pour `window.print`. Le couple numéro + code y figure encadré : c'est ce que le pharmacien saisit. Une ordonnance non signée ou expirée porte un filigrane, pour qu'aucun papier n'ait l'air opposable sans l'être.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Document HTML', content: { 'text/html': { schema: { type: 'string' } } } }, 403: { description: 'Accès refusé' }, 404: { description: 'Ordonnance non trouvée' } } },
    },
    // ─── Pharmacie : contrôle et délivrance (EF-07) ──────────
    '/api/v1/pharmacien/ordonnances/verifier': {
      post: {
        tags: ['Pharmacien'],
        summary: "Vérifier une ordonnance au comptoir (EF-07-01)",
        description: "Contrôle une ordonnance présentée sans le QR du patient. Le numéro seul ne suffit pas : il est séquentiel, donc devinable. Un numéro inconnu et un code faux renvoient la même réponse, pour qu'on ne puisse pas énumérer les numéros valides. Une ordonnance refusée est renvoyée avec son motif (non signée, expirée, annulée, déjà servie) afin que le pharmacien puisse l'expliquer au patient.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['numero', 'codeVerification'], properties: { numero: { type: 'string', example: 'OR-2026-000123' }, codeVerification: { type: 'string', example: 'A7D27Y' } } } } } },
        responses: { 200: { description: "Résultat du contrôle : `valide` indique si la délivrance est permise ; `motif` dit pourquoi elle ne l'est pas" }, 400: { description: 'Numéro mal formé' }, 403: { description: 'Compte non rattaché à une pharmacie' } },
      },
    },
    '/api/v1/pharmacien/ordonnances/{id}/delivrer': {
      post: {
        tags: ['Pharmacien'],
        summary: 'Délivrer un médicament (EF-07-07)',
        description: "`id` désigne une **ligne** d'ordonnance, pas l'ordonnance : la délivrance se fait médicament par médicament, une officine pouvant n'avoir qu'une partie du traitement. L'ordonnance est contrôlée avant toute sortie de stock ; son statut passe ensuite à PARTIELLEMENT_SERVIE ou SERVIE selon ce qu'il reste.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: "Identifiant de la ligne d'ordonnance" }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { modePaiement: { type: 'string', enum: ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO'] }, quantiteDelivree: { type: 'integer', minimum: 1 } } } } } },
        responses: { 200: { description: 'Médicament délivré' }, 400: { description: "Ordonnance non signée, expirée, annulée, déjà servie, ou stock insuffisant" }, 404: { description: "Ligne d'ordonnance non trouvée" } },
      },
    },
    '/api/v1/consultations/{id}/referral': {
      post: { tags: ['Consultations'], summary: 'Créer un référencement', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReferralDto' } } } }, responses: { 201: { description: 'Référencement créé' }, 400: { description: 'Référencement déjà existant ou structure non trouvée' } } },
    },
    // ─── ASC ──────────────────────────────────────────────
    '/api/v1/asc/planning': {
      get: { tags: ['ASC'], summary: "Planning de l'ASC", security: [{ bearerAuth: [] }], responses: { 200: { description: 'Planning récupéré' }, 404: { description: 'Profil ASC non trouvé' } } },
    },
    '/api/v1/asc/stocks': {
      get: { tags: ['ASC'], summary: 'Inventaire des stocks', security: [{ bearerAuth: [] }], parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'seuilAlerte', in: 'query', schema: { type: 'boolean' } }], responses: { 200: { description: 'Stocks récupérés' } } },
      post: { tags: ['ASC'], summary: 'Créer un stock', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateStockDto' } } } }, responses: { 201: { description: 'Stock créé' }, 400: { description: 'Stock déjà existant ou médicament non trouvé' } } },
    },
    '/api/v1/asc/stocks/{id}': {
      put: { tags: ['ASC'], summary: 'Mettre à jour un stock', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateStockDto' } } } }, responses: { 200: { description: 'Stock mis à jour' }, 400: { description: 'Stock non trouvé ou accès refusé' } } },
    },
    '/api/v1/asc/rapport': {
      get: { tags: ['ASC'], summary: 'Rapport mensuel', security: [{ bearerAuth: [] }], parameters: [{ name: 'mois', in: 'query', required: true, schema: { type: 'integer', minimum: 1, maximum: 12 }, example: 4 }, { name: 'annee', in: 'query', required: true, schema: { type: 'integer' }, example: 2026 }], responses: { 200: { description: 'Rapport généré', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/RapportMensuel' } } }] } } } }, 400: { description: 'Paramètres mois et annee requis' } } },
    },
    // ─── MEDECIN ──────────────────────────────────────────
    '/api/v1/medecin/dashboard': {
      get: { tags: ['Médecin'], summary: 'Dashboard statistiques', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Statistiques récupérées', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/DashboardStats' } } }] } } } } } },
    },
    '/api/v1/medecin/consultations': {
      get: { tags: ['Médecin'], summary: 'Consultations à valider', security: [{ bearerAuth: [] }], parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'prefecture', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Liste récupérée' }, 401: { description: 'Non authentifié' }, 403: { description: 'Accès refusé' } } },
    },
    '/api/v1/medecin/consultations/{id}/valider': {
      put: { tags: ['Médecin'], summary: 'Valider une consultation', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ValiderConsultationDto' } } } }, responses: { 200: { description: 'Consultation validée' }, 400: { description: 'Consultation déjà validée ou non trouvée' } } },
    },
    '/api/v1/pharmacien/approvisionnements': {
      post: { tags: ['Pharmacien'], summary: 'Enregistrer une facture d\'approvisionnement (addendum 2026-09-28, point 1.3)', description: 'Chaque ligne devient un lot, avec sa propre date de peremption. Le total du stock suit. **Saisie assistee** : la facture est attachee en justificatif ; l\'extraction automatique viendra ensuite et devra toujours etre relue avant enregistrement — une erreur sur une quantite ou une peremption entrerait sinon en silence dans le stock d\'un medicament. Un lot deja perime est refuse a l\'entree.', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['fournisseur', 'dateFacture', 'lignes'], properties: { fournisseur: { type: 'string' }, dateFacture: { type: 'string', format: 'date' }, numeroFacture: { type: 'string' }, justificatifUrl: { type: 'string', description: 'Photo ou scan de la facture' }, lignes: { type: 'array', items: { type: 'object', required: ['idMedicament', 'quantite'], properties: { idMedicament: { type: 'string' }, quantite: { type: 'integer', minimum: 1 }, numeroLot: { type: 'string' }, datePeremption: { type: 'string', format: 'date' }, prixAchatGnf: { type: 'integer' }, unite: { type: 'string' } } } } } } } } }, responses: { 201: { description: 'Entree en stock enregistree' }, 400: { description: 'Produit hors catalogue, ou lot deja perime' } } },
      get: { tags: ['Pharmacien'], summary: 'Historique des entrees en stock', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Approvisionnements, le plus recent en tete' } } } },
    '/api/v1/pharmacien/peremptions': {
      get: { tags: ['Pharmacien'], summary: 'Lots qui approchent de leur date, ou l\'ont depassee (addendum, point 1.4)', description: 'Le plus urgent en tete. Les perimes ne sont pas seulement a surveiller : ils sont a retirer des rayons. Seuil en jours, 90 par defaut (`STOCK_PEREMPTION_ALERTE_JOURS`).', security: [{ bearerAuth: [] }], parameters: [{ name: 'jours', in: 'query', schema: { type: 'integer', default: 90 } }], responses: { 200: { description: 'Lots concernes' } } } },
    '/api/v1/pharmacien/medicaments/{id}/lots': {
      get: { tags: ['Pharmacien'], summary: 'Lots d\'un produit dans cette officine', description: 'Du plus proche de sa peremption au plus lointain — l\'ordre dans lequel ils sortiront.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Lots du produit' }, 404: { description: 'Produit absent de l officine' } } } },
    '/api/v1/pharmacien/connexions': {
      get: { tags: ['Pharmacien'], summary: 'Historique des connexions de l officine', description: 'Réservé au titulaire. Les tentatives de comptes inconnus ne conservent que le HMAC de l identifiant, jamais sa valeur en clair.', security: [{ bearerAuth: [] }], parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }], responses: { 200: { description: 'Journal paginé des connexions' }, 403: { description: 'Accès réservé au titulaire de cette officine' } } } },
    '/api/v1/pharmacien/agents': {
      get: { tags: ['Pharmacien'], summary: 'Lister les utilisateurs de l officine', description: 'Réservé au titulaire.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Utilisateurs et fonctions de cette officine' }, 403: { description: 'Accès réservé au titulaire' } } },
      post: { tags: ['Pharmacien'], summary: 'Créer un utilisateur de l officine', description: 'Réservé au titulaire. Le mot de passe temporaire doit être transmis de manière sécurisée.', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['telephone', 'prenom', 'nom'], properties: { telephone: { type: 'string' }, email: { type: 'string', format: 'email' }, prenom: { type: 'string' }, nom: { type: 'string' }, roleOfficine: { type: 'string', enum: ['ADJOINT', 'PREPARATEUR', 'CAISSIER'], default: 'ADJOINT' }, motDePasse: { type: 'string', minLength: 6 } } } } } }, responses: { 201: { description: 'Utilisateur créé' }, 403: { description: 'Accès réservé au titulaire' } } } },
    '/api/v1/pharmacien/agents/{id}/statut': {
      patch: { tags: ['Pharmacien'], summary: 'Suspendre ou réactiver un utilisateur', description: 'Réservé au titulaire ; le compte titulaire ne peut pas être modifié par cette route.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['estActif'], properties: { estActif: { type: 'boolean' } } } } } }, responses: { 200: { description: 'État du compte mis à jour' }, 403: { description: 'Accès réservé au titulaire' }, 404: { description: 'Utilisateur introuvable dans cette officine' } } } },
    '/api/v1/pharmacien/agents/{id}/role-permanent': {
      put: { tags: ['Pharmacien'], summary: 'Modifier la fonction permanente', description: 'Réservé au titulaire. La modification révoque toute permission temporaire active.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['roleOfficine'], properties: { roleOfficine: { type: 'string', enum: ['ADJOINT', 'PREPARATEUR', 'CAISSIER'] } } } } } }, responses: { 200: { description: 'Fonction mise à jour' }, 403: { description: 'Accès réservé au titulaire' } } } },
    '/api/v1/pharmacien/agents/{id}/permission-temporaire': {
      put: { tags: ['Pharmacien'], summary: 'Accorder une fonction temporaire', description: 'Réservé au titulaire. La fonction temporaire prend fin à la date fournie et ne peut pas promouvoir un utilisateur au rang de titulaire.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['roleOfficine', 'expireLe'], properties: { roleOfficine: { type: 'string', enum: ['ADJOINT', 'PREPARATEUR', 'CAISSIER'] }, expireLe: { type: 'string', format: 'date-time' } } } } } }, responses: { 200: { description: 'Fonction temporaire enregistrée' }, 403: { description: 'Accès réservé au titulaire' }, 400: { description: 'Expiration passée' } } },
      delete: { tags: ['Pharmacien'], summary: 'Révoquer une fonction temporaire', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Fonction temporaire révoquée' }, 403: { description: 'Accès réservé au titulaire' } } } },
    '/api/v1/pharmacien/ventes': {
      post: { tags: ['Pharmacien'], summary: 'Enregistrer une vente au comptoir (addendum 2026-09-28, point 1.1)', description: "Le client est facultatif : un passant n'a pas de dossier. Les prix sont fixes (tarif national de reference plus la marge de l'officine) ; aucune remise n'est acceptee. La sortie de stock se fait au plus proche de la peremption, et un lot perime est refuse. Scanner deux fois le meme produit vaut quantite 2.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lignes', 'modePaiement'], properties: { lignes: { type: 'array', minItems: 1, items: { type: 'object', required: ['idMedicament', 'quantite'], properties: { idMedicament: { type: 'string' }, quantite: { type: 'integer', minimum: 1 } } } }, modePaiement: { type: 'string', enum: ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO'] }, numeroOperateur: { type: 'string', description: 'Obligatoire hors especes' }, idPatient: { type: 'string', description: 'Facultatif : absent pour un client de passage' }, idOrdonnance: { type: 'string', description: 'Obligatoire si le panier contient un produit reglemente' } } } } } }, responses: { 201: { description: 'Vente enregistree, stock decremente' }, 400: { description: 'Panier vide, produit hors stock ou ordonnance manquante/refusee' }, 409: { description: 'Lots non perimes insuffisants' } } },
      get: { tags: ['Pharmacien'], summary: "Ventes de l'officine", description: 'Le titulaire voit les ventes de l officine ; les opérateurs ne voient que leurs ventes du jour. `limite` plafonnée à 200.', security: [{ bearerAuth: [] }], parameters: [{ name: 'limite', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } }], responses: { 200: { description: 'Ventes selon la fonction officinale' } } } },
    '/api/v1/pharmacien/ventes/{id}': {
      get: { tags: ['Pharmacien'], summary: "Detail d'une vente", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Vente avec ses lignes' }, 403: { description: 'Vente d une autre officine' }, 404: { description: 'Vente non trouvee' } } } },
    '/api/v1/pharmacien/ventes/{id}/annuler': {
      post: { tags: ['Pharmacien'], summary: 'Annuler une vente et remettre les lots en stock', description: "Le titulaire peut annuler directement. Un operateur doit fournir le telephone et le mot de passe d'un titulaire actif de la meme officine. L'auteur et l'approbateur sont conserves separement dans la vente ; le mot de passe n'est jamais persiste. Les lots consommes sont remis exactement, et le motif est obligatoire.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['motif'], properties: { motif: { type: 'string', minLength: 5, maxLength: 500 }, autorisationTitulaire: { type: 'object', required: ['telephone', 'motDePasse'], properties: { telephone: { type: 'string' }, motDePasse: { type: 'string', format: 'password' } } } } } } } }, responses: { 200: { description: 'Vente annulee, auteur et titulaire approbateur traces' }, 400: { description: 'Motif trop court' }, 403: { description: 'Vente d une autre officine ou validation du titulaire manquante/refusee' }, 409: { description: 'Deja annulee ou annulee entre-temps' } } } },
    '/api/v1/pharmacien/catalogue-local': {
      post: { tags: ['Pharmacien'], summary: 'Créer un produit propre à cette officine', description: 'Réservé au titulaire. Le produit reste invisible aux autres officines et au référentiel partagé. Seuls les produits non médicamenteux peuvent être créés localement ; leur prix de vente est fixe.', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['libelle', 'categorie', 'prixUnitaireGnf'], properties: { libelle: { type: 'string', minLength: 2, maxLength: 160 }, categorie: { type: 'string', enum: ['LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE', 'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE'] }, prixUnitaireGnf: { type: 'integer', minimum: 1 } } } } } }, responses: { 201: { description: 'Produit local créé' }, 403: { description: 'Accès réservé au titulaire' } } },
    },
    '/api/v1/pharmacien/catalogue-local/{id}': {
      patch: { tags: ['Pharmacien'], summary: 'Modifier un produit propre à cette officine', description: 'Réservé au titulaire. Impossible de modifier le référentiel partagé ou un produit appartenant à une autre pharmacie.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { libelle: { type: 'string', minLength: 2, maxLength: 160 }, categorie: { type: 'string' }, prixUnitaireGnf: { type: 'integer', minimum: 1 } } } } } }, responses: { 200: { description: 'Produit mis à jour' }, 404: { description: 'Produit local introuvable' } } },
      delete: { tags: ['Pharmacien'], summary: 'Désactiver un produit propre à cette officine', description: 'Réservé au titulaire. Désactivation logique uniquement, autorisée lorsque le produit est en rupture ; l’historique des ventes reste intact.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Produit désactivé' }, 400: { description: 'Le produit doit être en rupture' }, 404: { description: 'Produit local introuvable' } } },
    },
    '/api/v1/pharmacien/tableau-de-bord': {
      get: { tags: ['Pharmacien'], summary: "Tableau de bord de l'officine (addendum 2026-09-28, point 1.2)", description: "Chiffre du jour depuis minuit, panier moyen, encaissements par moyen de paiement, dix produits les plus vendus sur trente jours, ruptures de stock et nombre de lots a perimer. **Les ventes annulees sont exclues de tous les agregats** : une erreur de caisse corrigee ne doit pas gonfler le chiffre d'affaires.", security: [{ bearerAuth: [] }], responses: { 200: { description: 'Chiffres de cette officine' } } } },
    '/api/v1/assurance/eligibilite': {
      post: { tags: ['Assurance'], summary: "Controle d'eligibilite au comptoir (addendum 2026-09-28, point 5.1)", description: "Contrat actif, date d'effet, carence, assureur actif sur la plateforme. **La reponse est enregistree telle quelle** : c'est elle qui justifiera le tiers payant si l'assureur le conteste. On ne la recalcule donc jamais, on la relit. Un refus porte toujours son motif, sans quoi le comptoir n'aurait rien a expliquer au patient — une contrainte SQL l'impose.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idPatient'], properties: { idPatient: { type: 'string' } } } } } }, responses: { 201: { description: 'Controle enregistre. `eligible` peut etre faux : ce n est pas une erreur HTTP' }, 403: { description: 'Compte sans structure' }, 404: { description: 'Patient non trouve' } } } },
    '/api/v1/assurance/patients/{id}/eligibilite': {
      get: { tags: ['Assurance'], summary: "Historique des controles d'eligibilite d'un patient", description: 'Le plus recent en tete, 50 au maximum. Ce sont les reponses figees, pas un recalcul.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Controles traces' } } } },
    '/api/v1/assurance/simulation': {
      post: { tags: ['Assurance'], summary: 'Chiffrer une prise en charge avant paiement (addendum, point 5.4)', description: "Ne enregistre rien. Rend le detail **ligne par ligne** : couvert ou non, a quel taux, et sinon pourquoi — « un reste a charge sans explication se conteste au comptoir ». Rappel de la regle qui surprend : **un taux de 100 % ne veut pas dire que tout est pris**. Il s'applique apres exclusions, puis dans la limite de la franchise et des plafonds ; un assure a 100 % paie quand meme son lait infantile. Les notes disent ce qui a rabote la part de l'assureur.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idPatient', 'lignes', 'montantNetGnf'], properties: { idPatient: { type: 'string' }, montantNetGnf: { type: 'integer', description: 'Ce que la caisse encaisse, remise deduite' }, lignes: { type: 'array', items: { type: 'object', required: ['idMedicament', 'libelle', 'categorie', 'montantGnf'], properties: { idMedicament: { type: 'string' }, libelle: { type: 'string' }, categorie: { type: 'string', enum: ['MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE', 'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE'] }, montantGnf: { type: 'integer' } } } } } } } } }, responses: { 200: { description: 'Detail de la prise en charge' }, 400: { description: "Aucun contrat utilisable pour ce patient" } } } },
    '/api/v1/assurance/patients/{id}/contrats': {
      get: { tags: ['Assurance'], summary: "Contrats d'un patient, et ce qui a deja ete consomme cette annee", description: "`consommeAnneeGnf` est la somme des parts assureur des ventes **non annulees** de l'annee : une erreur de caisse corrigee n'entame pas le plafond du patient.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Contrats, le plus recent en tete' } } } },
    '/api/v1/assurance/patients/recherche': {
      get: { tags: ['Assurance'], summary: "Trouver le patient a qui rattacher une police (administration nationale)", description: "Au comptoir le patient est la et presente son QR ; ici l'assureur envoie une liste de noms et de numeros de police, et il faut retomber sur la personne a l'echelle du pays — donc hors de toute structure. Le predicat est **celui du comptoir** (`filtreRecherchePatient`) : un patient trouvable a l'admission doit l'etre ici, sinon sa police reste en suspens sans que personne ne sache pourquoi. Rien de medical ne sort de cette route : l'identite, et le numero masque comme partout ailleurs — il sert a distinguer deux homonymes, pas a appeler qui que ce soit.", security: [{ bearerAuth: [] }], parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 3 }, description: 'Nom, prenom, numero de telephone ou QR' }], responses: { 200: { description: 'Jusqu a 20 identites, par nom' }, 400: { description: 'Moins de 3 caracteres' } } } },
    '/api/v1/assurance/assureurs': {
      get: { tags: ['Assurance'], summary: 'Assureurs et leurs regles de couverture', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Assureurs actifs et inactifs' } } },
      post: { tags: ['Assurance'], summary: 'Creer un assureur (administration nationale)', description: "Le `code` figure sur la carte de l'assure et doit etre unique. `idStructure` rattache l'assureur a une structure de type **ASSURANCE** quand il a des agents sur la plateforme : sans cela ses agents heriteraient des droits d'un hopital ou d'une pharmacie. Les modes PORTAIL et API (EF-09-02) attendent une convention technique ; MANUEL est le depart.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['nom', 'code'], properties: { nom: { type: 'string' }, code: { type: 'string', maxLength: 16 }, telephone: { type: 'string' }, email: { type: 'string', format: 'email' }, modeEchange: { type: 'string', enum: ['MANUEL', 'PORTAIL', 'API'] }, idStructure: { type: 'string' } } } } } }, responses: { 201: { description: 'Assureur cree' }, 400: { description: "La structure rattachee n'est pas de type ASSURANCE" }, 409: { description: 'Code deja pris' } } } },
    '/api/v1/assurance/assureurs/{id}/regles': {
      post: { tags: ['Assurance'], summary: 'Ajouter une regle de couverture par categorie (addendum, point 5.3)', description: "C'est ici que vivent les exclusions citees par le chef de projet : le lait infantile, les cosmetiques. Elles visent `CategorieProduit`, une **enumeration fermee** — on ne fonde pas une regle de remboursement sur un champ que chacun remplit comme il veut. La regle **ne remplace pas** la precedente : sa `dateEffet` decide, et le calcul retient celle en vigueur a la date de la vente, pour qu'un changement de taux ne reecrive pas ce qui a deja ete chiffre (EF-09-03). Une categorie exclue n'a pas de taux : porter les deux serait contradictoire, et une contrainte SQL le refuse.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['categorie'], properties: { categorie: { type: 'string', enum: ['MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE', 'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE'] }, exclu: { type: 'boolean' }, tauxPourcent: { type: 'integer', minimum: 0, maximum: 100 }, plafondLigneGnf: { type: 'integer' }, dateEffet: { type: 'string', format: 'date' } } } } } }, responses: { 201: { description: 'Regle ajoutee' }, 400: { description: "Exclusion et taux ensemble, ou regle vide" }, 404: { description: 'Assureur non trouve' } } } },
    '/api/v1/assurance/contrats': {
      post: { tags: ['Assurance'], summary: "Enregistrer le contrat d'un patient (administration nationale)", description: "`tauxBasePourcent` s'applique a ce qui est couvert, **apres** exclusions et dans la limite des plafonds. `carenceJours` empeche de s'assurer la veille d'une depense connue. `plafondAnnuelGnf` a 0 vaut « pas de plafond », de meme que `franchiseGnf`. La police est unique chez un assureur donne.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idAssureur', 'idPatient', 'numeroPolice', 'dateEffet'], properties: { idAssureur: { type: 'string' }, idPatient: { type: 'string' }, numeroPolice: { type: 'string' }, tauxBasePourcent: { type: 'integer', minimum: 0, maximum: 100, default: 80 }, plafondAnnuelGnf: { type: 'integer', default: 0 }, franchiseGnf: { type: 'integer', default: 0 }, dateEffet: { type: 'string', format: 'date' }, dateFin: { type: 'string', format: 'date' }, carenceJours: { type: 'integer', default: 0 } } } } } }, responses: { 201: { description: 'Contrat enregistre' }, 400: { description: "Date de fin anterieure a la date d'effet" }, 404: { description: 'Assureur ou patient non trouve' }, 409: { description: 'Police deja prise chez cet assureur' } } } },
    '/api/v1/pharmacien/ventes/{id}/paiement': {
      get: { tags: ['Pharmacien'], summary: 'Ou en est le paiement de cette vente (EF-08)', description: "**Jusqu'au 2026-10-09, une vente mobile naissait PAYEE** : le pharmacien cochait « Orange Money », tapait un numero, et rien ne verifiait qu'un franc ait bouge. `numeroOperateur` n'etait qu'une chaine saisie. Desormais une vente mobile naît `EN_ATTENTE` avec une operation de passerelle, et ne devient `PAYEE` que sur un `success` — en portant `referenceTransaction`, qui est la preuve opposable. Une contrainte SQL refuse l'etat qui mentirait : payee par operation, sans reference. Cette route **interroge la passerelle** quand l'issue n'est pas connue : le pharmacien a le client devant lui et ne peut pas attendre un rappel qui peut ne jamais arriver. Les lots sont consommes des la creation — on ne vend pas deux fois la derniere boite pendant que le client tape son code — et une vente abandonnee les rend en etant annulee.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'La vente, avec son statut de passerelle et sa reference si elle est reglee' }, 403: { description: "Vente d'une autre officine" }, 404: { description: 'Vente non trouvee' } } } },
    '/api/v1/webhooks/chapchap': {
      post: { tags: ['Paiement'], summary: 'Rappel de la passerelle Chap Chap Pay (EF-08)', description: "**Un meme rappel sert deux sortes d'operations** : `VNT-<id>` une vente de pharmacie, `FAC-<id>` la facture d'une consultation. Le prefixe de `order_id` dit laquelle — chercher dans les deux tables a l'aveugle marcherait tant que les identifiants ne se croisent pas, ce qu'aucune contrainte ne garantit. **Route publique, authentifiee par signature.** ChapChap ne porte ni jeton ni cookie : l'en-tete `CCP-HMAC-Signature` fait foi, et elle seule. Elle est un HMAC-SHA256 calcule avec la **cle d'encryptage** sur les **octets exacts du corps**. Cette route est donc montee **avant l'analyseur JSON global** : le laisser remplacer le corps par un objet rendrait la verification impossible, puisque re-serialiser produit d'autres octets. **Seul `success` fait passer la facture a PAYEE**, et il est definitif. Un `canceled`, `failed`, `error` ou `expired` laisse la facture payable : le patient recommence, au lieu de repasser au guichet pour un code mal saisi. Plusieurs rappels peuvent porter la meme operation, dans n'importe quel ordre — un `canceled` tardif ne defait jamais un paiement acquis. **Toute reponse HTTP met fin aux reprises de ChapChap**, 500 compris : seule une absence de reponse est retentee. Un rappel perdu n'est donc pas rattrape tout seul, et c'est la relecture du statut (`GET /paiements/{id}/statut`) qui ferme le trou. Une facture inconnue est acquittee par un 200 : il n'y a rien a rejouer.", parameters: [{ name: 'CCP-HMAC-Signature', in: 'header', required: true, schema: { type: 'string' }, description: 'HMAC-SHA256 du corps brut, avec la cle d encryptage' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { order_id: { type: 'string', description: "L identifiant de la facture KENEYA" }, operation_id: { type: 'string' }, amount: { type: 'number' }, status: { type: 'object', properties: { code: { type: 'string', enum: ['new', 'pending', 'success', 'canceled', 'failed', 'error', 'expired'] } } }, transaction: { type: 'object', properties: { payment_method: { type: 'string' }, payment_reference: { type: 'string' } } } } } } } }, responses: { 200: { description: 'Rappel traite, ou acquitte sans effet' }, 400: { description: 'Corps illisible' }, 401: { description: 'Signature invalide' }, 500: { description: 'Traitement impossible : a renvoyer depuis le tableau de bord ChapChap' } } } },
    '/api/v1/assurance/moi': {
      get: { tags: ['Assurance'], summary: "L'assureur voit sa propre compagnie (addendum, point 5.2)", description: "**Aucune route de cet espace ne prend d'identifiant de compagnie.** Elle se deduit de la structure de l'agent connecte : l'accepter en parametre laisserait un agent lire la situation d'un concurrent en changeant un chiffre dans l'URL. Les regles sont en lecture seule ici — elles se saisissent depuis l'administration nationale tant que l'echange conventionne (EF-09-02) n'existe pas.", security: [{ bearerAuth: [] }], responses: { 200: { description: 'La compagnie, ses regles et ses compteurs de polices' }, 403: { description: "Compte sans structure, ou structure rattachee a aucune compagnie" } } } },
    '/api/v1/assurance/moi/assures': {
      get: { tags: ['Assurance'], summary: 'Les assures de la compagnie, et leur consommation annuelle', description: "**Rien de medical ne traverse cette frontiere.** Le nom de l'assure, son contrat, ce qui a ete pris en charge cette annee et le nombre de passages — jamais un produit delivre, une ordonnance ni un diagnostic. Un assureur qui lirait ce qu'on soigne pourrait refuser un contrat dessus. Ni telephone, ni date de naissance, ni adresse : ils ne servent a rien ici. Les ventes annulees ne comptent pas, pour qu'une erreur de caisse corrigee n'entame pas le plafond d'un assure.", security: [{ bearerAuth: [] }], responses: { 200: { description: 'Les polices, actives en tete' } } } },
    '/api/v1/assurance/moi/pharmacies': {
      get: { tags: ['Assurance'], summary: 'Situation par officine : delivre, facture, paye, reste du (point 5.2)', description: "« Ce qui a ete delivre, ce qui lui est facture, ce qui est paye, ce qui reste du, et les ecarts. » `montantFactureGnf` est la part de la compagnie sur les ventes non annulees ; `montantPayeGnf` la somme des reglements saisis ; `resteDuGnf` leur difference. **Elle peut etre negative** quand la compagnie a verse plus que du : c'est un ecart aussi, et le masquer le rendrait introuvable. Une officine reglee sans vente apparait, et l'inverse aussi, sans quoi un versement egare resterait invisible. Le plus gros reste du vient en tete.", security: [{ bearerAuth: [] }], responses: { 200: { description: 'Une ligne par officine' } } } },
    '/api/v1/assurance/moi/reglements': {
      get: { tags: ['Assurance'], summary: 'Les versements de la compagnie, le plus recent en tete', security: [{ bearerAuth: [] }], responses: { 200: { description: '100 au maximum' } } },
      post: { tags: ['Assurance'], summary: 'Enregistrer un versement a une officine (point 5.2)', description: "Le versement couvre **une periode** et non des ventes nommees : c'est ainsi qu'une compagnie regle une officine, par bordereau mensuel. Rattacher chaque virement a des lignes supposerait un rapprochement que personne ne fait a la main. Pas d'`idAssureur` en entree : il se deduit de la structure de l'agent. La destinataire doit etre une **pharmacie** — une erreur de destinataire fausserait la situation des deux cotes sans rien dire. Deux contraintes SQL doublent les controles : montant strictement positif, et periode ordonnee.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idStructure', 'montantGnf', 'periodeDebut', 'periodeFin'], properties: { idStructure: { type: 'string' }, montantGnf: { type: 'integer', minimum: 1 }, periodeDebut: { type: 'string', format: 'date' }, periodeFin: { type: 'string', format: 'date' }, reference: { type: 'string', maxLength: 120, description: 'Reference du virement ou du bordereau' } } } } } }, responses: { 201: { description: 'Versement enregistre' }, 400: { description: 'Periode a l envers, ou montant nul' }, 404: { description: "La structure n est pas une pharmacie" } } } },
    '/api/v1/assurance/assureurs/{id}/agents': {
      post: { tags: ['Assurance'], summary: "Creer le compte par lequel un assureur se connecte (administration nationale)", description: "**L'assureur n'appartient a aucun hopital.** Son agent se connecte depuis une structure de type ASSURANCE qui lui est propre — sans elle, il heriterait des droits d'une pharmacie ou d'un etablissement de soins, et donc d'un acces aux dossiers. Cette structure est creee a la volee si la compagnie n'en a pas : demander a l'administration de declarer d'abord un « etablissement de sante » pour une compagnie d'assurance n'aurait aucun sens a l'ecran, alors que le modele en a besoin. Le mot de passe temporaire n'est rendu **qu'une fois** et devra etre change.", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prenom', 'nom', 'telephone'], properties: { prenom: { type: 'string' }, nom: { type: 'string' }, telephone: { type: 'string' }, email: { type: 'string', format: 'email' }, prefecture: { type: 'string', description: 'Siege, si la structure reste a creer' } } } } } }, responses: { 201: { description: 'Compte cree, mot de passe rendu une fois' }, 404: { description: 'Assureur introuvable' }, 409: { description: 'Numero deja pris' } } } },
    '/api/v1/patients/me/demandes-rendez-vous': {
      post: { tags: ['Patient'], summary: 'Demander un rendez-vous a distance (addendum 2026-09-28, point 6)', description: 'Le patient fait sa demande depuis chez lui. Elle n\'ouvre pas d\'episode : un episode est une visite, et une demande n\'en est pas encore une. A defaut d\'etablissement choisi, celui du dossier. Une seule demande en attente a la fois.', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['motif'], properties: { motif: { type: 'string', minLength: 5, maxLength: 1000 }, idStructure: { type: 'string' }, idMedecin: { type: 'string' } } } } } }, responses: { 201: { description: 'Demande envoyee' }, 400: { description: 'Etablissement ou medecin invalide' }, 409: { description: 'Une demande est deja en attente' } } },
      get: { tags: ['Patient'], summary: 'Mes demandes de rendez-vous', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Demandes, la plus recente en tete' } } } },
    '/api/v1/patients/me/demandes-rendez-vous/{id}/annuler': {
      post: { tags: ['Patient'], summary: 'Retirer une demande encore en attente', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Demande annulee' }, 409: { description: 'Demande deja traitee' } } } },
    '/api/v1/hopital/demandes': {
      get: { tags: ['Hôpital'], summary: 'Demandes a distance sans medecin designe', description: 'L\'accueil les oriente : c\'est son metier, et le seul qu\'il garde sur ce circuit. Il ne fixe pas l\'heure. Les plus anciennes d\'abord.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Demandes a orienter' } } } },
    '/api/v1/hopital/demandes/{id}/orienter': {
      post: { tags: ['Hôpital'], summary: 'Designer le medecin qui traitera la demande', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idMedecin'], properties: { idMedecin: { type: 'string' } } } } } }, responses: { 200: { description: 'Demande orientee ; le medecin est prevenu' }, 400: { description: 'Ce medecin n exerce pas dans l etablissement' }, 409: { description: 'Demande deja traitee' } } } },
    '/api/v1/medecin/demandes': {
      get: { tags: ['Médecin'], summary: 'Demandes de rendez-vous qui me sont adressees', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Demandes en attente, les plus anciennes d abord' } } } },
    '/api/v1/medecin/demandes/{id}/accepter': {
      post: { tags: ['Médecin'], summary: 'Accepter en fixant l\'heure — ce geste ouvre la visite', description: 'L\'episode de soins et le rendez-vous naissent ensemble, dans la meme transaction : un episode sans rendez-vous laisserait un dossier que personne n\'attend. Le medecin en devient d\'emblee responsable.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prevuLe'], properties: { prevuLe: { type: 'string', format: 'date-time' } } } } } }, responses: { 200: { description: 'Rendez-vous fixe ; le patient est prevenu' }, 404: { description: 'Demande non adressee a ce medecin' }, 409: { description: 'Demande deja traitee' } } } },
    '/api/v1/medecin/demandes/{id}/refuser': {
      post: { tags: ['Médecin'], summary: 'Refuser avec un motif', description: 'Le motif est obligatoire : un refus sans explication est un mur. Il reste dans l\'espace du patient, pas dans la notification — il peut porter un detail que rien ne doit sortir de la plateforme.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['motif'], properties: { motif: { type: 'string', minLength: 5, maxLength: 500 } } } } } }, responses: { 200: { description: 'Demande refusee ; le patient est prevenu' }, 400: { description: 'Motif manquant' } } } },
    '/api/v1/medecin/orientations/{idEpisode}/rendez-vous': {
      post: { tags: ['Médecin'], summary: 'Fixer le rendez-vous d\'un patient oriente (addendum 2026-09-28, point 3)', description: 'Le creneau appartient au medecin : l\'accueil oriente sans proposer d\'heure. Un seul rendez-vous en vigueur par episode — deplacer le creneau remplace le precedent. C\'est ce geste, et lui seul, qui annonce une heure au patient.', security: [{ bearerAuth: [] }], parameters: [{ name: 'idEpisode', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prevuLe'], properties: { prevuLe: { type: 'string', format: 'date-time' }, motif: { type: 'string', maxLength: 500 } } } } } }, responses: { 201: { description: 'Rendez-vous fixe ; le patient est prevenu' }, 404: { description: 'Ce medecin n\'est pas responsable de l\'episode' }, 409: { description: 'Episode termine' } } } },
    '/api/v1/medecin/rendez-vous': {
      get: { tags: ['Médecin'], summary: 'Agenda du medecin, par ordre chronologique (addendum 2026-09-28, point 8)', description: 'Du plus proche au plus lointain, les rendez-vous annules ecartes. Par defaut a partir d\'aujourd\'hui.', security: [{ bearerAuth: [] }], parameters: [{ name: 'du', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'au', in: 'query', schema: { type: 'string', format: 'date-time' } }], responses: { 200: { description: 'Rendez-vous du medecin' }, 403: { description: 'Reserve au role MEDECIN' } } } },
    '/api/v1/medecin/rendez-vous/{id}/statut': {
      patch: { tags: ['Médecin'], summary: 'Prendre le patient, terminer la consultation ou constater une absence', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['statut'], properties: { statut: { type: 'string', enum: ['EN_CONSULTATION', 'TERMINE', 'ABSENT'] } } } } } }, responses: { 200: { description: 'Statut change' }, 404: { description: 'Rendez-vous introuvable' }, 409: { description: 'Rendez-vous annule' } } } },
    '/api/v1/medecin/resultats': {
      get: { tags: ['Médecin'], summary: 'Résultats d\'analyse validés que le patient ne voit pas encore (addendum 2026-09-28)', description: 'Les demandes dont ce médecin est prescripteur ou responsable de l\'épisode, validées par le laboratoire et non encore libérées. Les plus anciennes d\'abord : c\'est le patient qui attend depuis le plus longtemps.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'File des résultats à libérer' }, 403: { description: 'Réservé au rôle MEDECIN' } } },
    },
    '/api/v1/medecin/resultats/{id}/liberer': {
      post: { tags: ['Médecin'], summary: 'Rendre les résultats visibles au patient, avec une explication (addendum 2026-09-28)', description: 'Le patient ne voit un résultat qu\'après ce geste : ni la validation du laboratoire ni le temps qui passe ne le rendent visible. Le commentaire est la traduction en langage clair — facultatif, pour ne pas provoquer des « RAS » systématiques. Libérer vaut accusé de lecture des alertes critiques de la demande.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { commentaire: { type: 'string', maxLength: 2000 } } } } } }, responses: { 200: { description: 'Résultats libérés ; le patient est notifié' }, 403: { description: 'Réservé au médecin prescripteur ou responsable de l\'épisode' }, 409: { description: 'Non validés par le laboratoire, ou déjà libérés' } } },
    },
    '/api/v1/medecin/referencements': {
      get: { tags: ['Médecin'], summary: 'Référencements à traiter', security: [{ bearerAuth: [] }], parameters: [{ name: 'statut', in: 'query', schema: { type: 'string', enum: ['EN_ATTENTE', 'ACCEPTE', 'REFUSE', 'COMPLETE'] } }, { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }], responses: { 200: { description: 'Référencements récupérés' }, 401: { description: 'Non authentifié' } } },
    },
    '/api/v1/medecin/referencements/{id}/repondre': {
      put: { tags: ['Médecin'], summary: 'Répondre à un référencement', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RepondreReferencementDto' } } } }, responses: { 200: { description: 'Réponse enregistrée' }, 400: { description: 'Référencement déjà traité ou motif manquant' } } },
    },
    '/api/v1/medecin/messages': {
      get: { tags: ['Médecin'], summary: 'Récupérer les messages', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Messages récupérés' }, 401: { description: 'Non authentifié' } } },
      post: { tags: ['Médecin'], summary: 'Envoyer un message', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessageDto' } } } }, responses: { 201: { description: 'Message envoyé' }, 400: { description: 'Destinataire non trouvé' } } },
    },
    // ─── PAIEMENTS ────────────────────────────────────────
    '/api/v1/paiements': {
      post: { tags: ['Paiements'], summary: 'Initier un paiement', description: 'Crée une facture et initie un paiement Orange Money, MTN MoMo ou Espèces', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InitierPaiementDto' } } } }, responses: { 201: { description: 'Paiement initié', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/Facture' } } }] } } } }, 400: { description: 'Facture déjà existante ou numéro opérateur manquant' }, 403: { description: "Accès refusé — ce n'est pas votre consultation" } } },
    },
    '/api/v1/paiements/historique': {
      get: { tags: ['Paiements'], summary: 'Historique des paiements', security: [{ bearerAuth: [] }], parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'statut', in: 'query', schema: { type: 'string', enum: ['EN_ATTENTE', 'PAYEE', 'PARTIELLE', 'ANNULEE', 'REMBOURSEE'] } }, { name: 'modePaiement', in: 'query', schema: { type: 'string', enum: ['ORANGE_MONEY', 'MTN_MOMO', 'ESPECES'] } }], responses: { 200: { description: 'Historique récupéré' }, 404: { description: 'Profil patient non trouvé' } } },
    },
    '/api/v1/paiements/{id}/statut': {
      get: { tags: ['Paiements'], summary: "Statut d'un paiement", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Statut récupéré', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/Facture' } } }] } } } }, 404: { description: 'Facture non trouvée' } } },
    },
    '/api/v1/paiements/{id}/confirmer': {
      post: { tags: ['Paiements'], summary: 'Confirmer un paiement', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ConfirmerPaiementDto' } } } }, responses: { 200: { description: 'Paiement confirmé' }, 400: { description: 'Facture déjà payée ou non trouvée' } } },
    },
    '/api/v1/paiements/{id}/annuler': {
      post: { tags: ['Paiements'], summary: 'Annuler un paiement', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Paiement annulé' }, 400: { description: "Impossible d'annuler une facture déjà payée" } } },
    },
    // ─── VACCINATIONS ─────────────────────────────────────
    '/api/v1/vaccinations': {
      post: { tags: ['Vaccinations'], summary: 'Administrer un vaccin', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateVaccinationDto' } } } }, responses: { 201: { description: 'Vaccination enregistrée', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/Vaccination' } } }] } } } }, 400: { description: 'Patient non trouvé' } } },
    },
    '/api/v1/vaccinations/me': {
      get: { tags: ['Vaccinations'], summary: 'Mon carnet vaccinal', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Carnet vaccinal récupéré', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Vaccination' } } } }] } } } }, 404: { description: 'Profil patient non trouvé' } } },
    },
    '/api/v1/vaccinations/rappels': {
      get: { tags: ['Vaccinations'], summary: 'Rappels de vaccination', security: [{ bearerAuth: [] }], parameters: [{ name: 'joursAvant', in: 'query', schema: { type: 'integer', default: 7 } }, { name: 'prefecture', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Rappels récupérés' } } },
    },
    '/api/v1/vaccinations/stats': {
      get: { tags: ['Vaccinations'], summary: 'Statistiques de vaccination', security: [{ bearerAuth: [] }], parameters: [{ name: 'prefecture', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Statistiques récupérées', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/StatsVaccination' } } }] } } } } } },
    },
    '/api/v1/vaccinations/patient/{id}': {
      get: { tags: ['Vaccinations'], summary: "Carnet vaccinal d'un patient", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'vaccinNom', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }], responses: { 200: { description: 'Carnet vaccinal récupéré' }, 404: { description: 'Patient non trouvé' } } },
    },
    '/api/v1/vaccinations/{id}': {
      put: { tags: ['Vaccinations'], summary: 'Mettre à jour une vaccination', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateVaccinationDto' } } } }, responses: { 200: { description: 'Vaccination mise à jour' }, 400: { description: 'Vaccination non trouvée' } } },
    },
    // ─── NOTIFICATIONS ────────────────────────────────────
    '/api/v1/notifications/sms': {
      post: { tags: ['Notifications'], summary: 'Envoyer un SMS personnalisé', description: "Envoie un SMS a un numero specifique — Admin uniquement. **Aucun contenu medical n'est accepte** (EF-11-02) : un SMS voyage en clair, s'affiche sur un ecran verrouille et reste dans un telephone souvent partage. Un message contenant « resultat », « analyse », « ordonnance », « prelevement », « vaccination » ou un autre terme de soin est **refuse en 400**, avec le mot fautif. Invitez le destinataire a consulter son espace plutot que de lui annoncer un soin par SMS.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendSmsDto' } } } }, responses: { 200: { description: 'SMS envoyé', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/SmsResult' } } }] } } } }, 400: { description: 'Numéro ou message invalide' }, 403: { description: 'Accès refusé — Admin requis' } } },
    },
    '/api/v1/notifications/sms/masse': {
      post: { tags: ['Notifications'], summary: 'SMS en masse par préfecture', description: "Envoie un SMS à tous les patients d'une préfecture — accessible Admin Régional et National", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SmsMasseDto' } } } }, responses: { 200: { description: 'SMS envoyés en masse', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/SmsMasseResult' } } }] } } } }, 400: { description: 'Prefecture ou message manquant' }, 403: { description: 'Accès refusé' } } },
    },
    '/api/v1/notifications/rappel/rendez-vous/{id}': {
      post: { tags: ['Notifications'], summary: 'Envoyer rappel de rendez-vous', description: 'Envoie un SMS de rappel au patient pour son rendez-vous — accessible ASC', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'ID du rendez-vous' }], responses: { 200: { description: 'Rappel envoyé', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/SmsResult' } } }] } } } }, 400: { description: 'Rendez-vous non trouvé' } } },
    },
    '/api/v1/notifications/rappel/vaccination/{id}': {
      post: { tags: ['Notifications'], summary: 'Envoyer rappel de vaccination', description: 'Envoie un SMS de rappel pour un prochain rappel vaccinal — accessible ASC et Médecin', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'ID de la vaccination' }], responses: { 200: { description: 'Rappel vaccinal envoyé', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/SmsResult' } } }] } } } }, 400: { description: 'Vaccination non trouvée' } } },
    },
    '/api/v1/notifications/alerte/stock/{id}': {
      post: { tags: ['Notifications'], summary: 'Envoyer alerte stock critique', description: "Envoie un SMS d'alerte à l'ASC pour un stock en dessous du seuil", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'ID du stock' }], responses: { 200: { description: 'Alerte stock envoyée', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/SmsResult' } } }] } } } }, 400: { description: 'Stock non trouvé' } } },
    },
    '/api/v1/notifications/referencement/{id}': {
      post: { tags: ['Notifications'], summary: "Notifier le patient d'un référencement", description: "Envoie un SMS au patient pour l'informer de l'acceptation ou du refus de son référencement", security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'ID du référencement' }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['statut'], properties: { statut: { type: 'string', enum: ['ACCEPTE', 'REFUSE'], example: 'ACCEPTE' } } } } } }, responses: { 200: { description: 'Notification envoyée', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/SmsResult' } } }] } } } }, 400: { description: 'Statut invalide ou référencement non trouvé' } } },
    },
    '/api/v1/notifications/me': {
      get: { tags: ['Notifications'], summary: 'Mes notifications in-app', description: 'Notifications persistées de l\'utilisateur connecté, les plus récentes en premier. Les nouvelles arrivent aussi en temps réel via Socket.IO (événement notification:new).', security: [{ bearerAuth: [] }], parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'lu', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Filtrer sur les lues / non lues' }], responses: { 200: { description: 'Page de notifications ({ items, total, page, limit, totalPages })' } } },
    },
    '/api/v1/notifications/me/non-lues': {
      get: { tags: ['Notifications'], summary: 'Nombre de notifications non lues', security: [{ bearerAuth: [] }], responses: { 200: { description: '{ nonLues: number }' } } },
    },
    '/api/v1/notifications/{id}/lire': {
      put: { tags: ['Notifications'], summary: 'Marquer une notification comme lue', description: 'Idempotent. 404 si la notification n\'appartient pas à l\'utilisateur connecté.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Notification mise à jour' }, 404: { description: 'Notification non trouvée' } } },
    },
    '/api/v1/notifications/tout-lire': {
      put: { tags: ['Notifications'], summary: 'Marquer toutes mes notifications comme lues', security: [{ bearerAuth: [] }], responses: { 200: { description: '{ marquees: number }' } } },
    },
    '/api/v1/notifications/rappels/verifier': {
      get: { tags: ['Notifications'], summary: 'Vérifier les rappels à envoyer', description: 'Retourne la liste des rendez-vous et vaccinations nécessitant un rappel — utile pour les CRON jobs', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Rappels identifiés', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/RappelsResult' } } }] } } } }, 403: { description: 'Accès refusé — Admin requis' } } },
    },
    // ─── ANALYTICS ────────────────────────────────────────
    '/api/v1/analytics/dashboard': {
      get: {
        tags: ['Analytics'],
        summary: 'Dashboard épidémiologique global',
        description: 'Retourne les KPIs globaux, consultations par statut et top pathologies — accessible Médecin, Admin',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'prefecture', in: 'query', schema: { type: 'string' }, description: 'Filtrer par préfecture' },
          { name: 'debut', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-01-01' },
          { name: 'fin', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-12-31' },
        ],
        responses: {
          200: {
            description: 'Dashboard récupéré',
            content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/DashboardGlobal' } } }] } } },
          },
          403: { description: 'Accès refusé' },
        },
      },
    },
    '/api/v1/analytics/heatmap': {
      get: {
        tags: ['Analytics'],
        summary: 'Données cartographiques heatmap',
        description: 'Retourne les données géographiques des consultations par préfecture pour la carte épidémiologique',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'pathologie', in: 'query', schema: { type: 'string' }, description: 'Filtrer par pathologie', example: 'Paludisme' },
          { name: 'debut', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-01-01' },
          { name: 'fin', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-12-31' },
        ],
        responses: {
          200: {
            description: 'Données heatmap récupérées',
            content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/HeatmapData' } } }] } } },
          },
          403: { description: 'Accès refusé' },
        },
      },
    },
    '/api/v1/analytics/alertes': {
      get: {
        tags: ['Analytics'],
        summary: 'Alertes épidémiques actives',
        description: 'Détecte automatiquement les pathologies dépassant les seuils sur les 30 derniers jours — triées par niveau URGENCE > ALERTE > ATTENTION',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Alertes récupérées',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/ApiResponse' },
                    { properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AlerteEpidemique' } } } },
                  ],
                },
              },
            },
          },
          403: { description: 'Accès refusé' },
        },
      },
    },
    '/api/v1/analytics/vaccinations/couverture': {
      get: {
        tags: ['Analytics'],
        summary: 'Taux de couverture vaccinale',
        description: 'Retourne le taux de couverture vaccinale par vaccin — utile pour les rapports ONG et Ministère de la Santé',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'prefecture', in: 'query', schema: { type: 'string' }, description: 'Filtrer par préfecture' },
        ],
        responses: {
          200: {
            description: 'Couverture vaccinale récupérée',
            content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/CouvertureVaccinale' } } }] } } },
          },
          403: { description: 'Accès refusé' },
        },
      },
    },
    '/api/v1/analytics/tendances': {
      get: {
        tags: ['Analytics'],
        summary: 'Tendances sur 6 mois',
        description: 'Retourne les tendances mensuelles des consultations, vaccinations et référencements sur les 6 derniers mois',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'prefecture', in: 'query', schema: { type: 'string' }, description: 'Filtrer par préfecture' },
        ],
        responses: {
          200: {
            description: 'Tendances récupérées',
            content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/TendanceMensuelle' } } }] } } },
          },
          403: { description: 'Accès refusé' },
        },
      },
    },
    '/api/v1/analytics/export': {
      get: {
        tags: ['Analytics'],
        summary: 'Exporter les données (DHIS2 / CSV)',
        description: 'Exporte les données de consultation au format JSON ou CSV — compatible DHIS2. Accessible Admin uniquement',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['JSON', 'CSV', 'DHIS2'], default: 'JSON' }, description: 'Format d\'export' },
          { name: 'debut', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-01-01' },
          { name: 'fin', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-12-31' },
          { name: 'prefecture', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Export généré — CSV retourné en téléchargement, JSON en body',
            content: {
              'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { $ref: '#/components/schemas/ExportData' } } }] } },
              'text/csv': { schema: { type: 'string', description: 'Fichier CSV téléchargeable' } },
            },
          },
          403: { description: 'Accès refusé — Admin requis' },
        },
      },
    },
    '/api/v1/sync/changes': {
      get: {
        tags: ['Sync Offline'],
        summary: 'Recuperer les changements offline',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'scope', in: 'query', schema: { type: 'string', default: 'medical' } },
        ],
        responses: { 200: { description: 'Changements retournes' } },
      },
    },
    '/api/v1/sync/push': {
      post: {
        tags: ['Sync Offline'],
        summary: 'Envoyer des mutations offline',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mutations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['clientMutationId', 'entityType', 'operation', 'payload'],
                      properties: {
                        clientMutationId: { type: 'string' },
                        entityType: { type: 'string', enum: ['PatientProfile', 'Consultation', 'ConstantesVitales', 'Vaccination', 'Stock'] },
                        entityId: { type: 'string' },
                        operation: { type: 'string', enum: ['CREATE', 'UPDATE', 'DELETE'] },
                        payload: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 202: { description: 'Mutations recues et traitees' } },
      },
    },
    '/api/v1/fhir/patients/{id}/bundle': {
      get: {
        tags: ['FHIR'],
        summary: 'Exporter le dossier patient en Bundle FHIR minimal',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Bundle FHIR' }, 403: { description: 'Consentement requis ou acces refuse' } },
      },
    },
    '/api/v1/fhir/patients/{id}': {
      get: {
        tags: ['FHIR'],
        summary: 'Exporter un Patient FHIR',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Patient FHIR' }, 403: { description: 'Consentement requis ou acces refuse' } },
      },
    },
    '/api/v1/fhir/consultations/{id}': {
      get: {
        tags: ['FHIR'],
        summary: 'Exporter une consultation en Encounter FHIR',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Encounter FHIR' } },
      },
    },
    '/api/v1/triage/evaluer': {
      post: {
        tags: ['Triage ASC'],
        summary: 'Evaluer les symptomes avec le moteur de regles ASC',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { symptomes: { type: 'array', items: { type: 'string' } }, constantes: { type: 'object' } } } } },
        },
        responses: { 200: { description: 'Hypotheses et recommandation' } },
      },
    },
    '/api/v1/privacy/me/consents': {
      get: {
        tags: ['Confidentialite'],
        summary: 'Mes consentements, avec le texte que j ai vu (EF-02-01/03)',
        description: "Les consentements du patient connecte, avec le texte qu'il avait sous les yeux (EF-02-01/03).\n\n**Toutes les portees sont rendues**, meme celles sur lesquelles il ne s'est jamais prononce : une portee absente de l'ecran est une question qu'on ne lui a jamais posee. `repondu: false` les distingue.\n\n`etat` vaut `A_JOUR`, `TEXTE_PLUS_RECENT` (le texte a change depuis ; l'accord reste valable et un renouvellement est propose), ou **`JAMAIS_RECUEILLI` — l'accord a ete enregistre sans que personne ne montre quoi que ce soit.** Pose par le systeme a la creation du dossier, ou anterieur au versionnage : ce n'est pas un consentement, et l'ecran du patient le dit en ces termes. Dans la base du 2026-10-04, deux des quatre consentements etaient dans ce cas.\n\n`texteAccepte` est le texte **tel qu'il etait**, pas celui d'aujourd'hui : montrer le texte du jour comme s'il l'avait accepte lui ferait dire ce qu'il n'a pas dit.",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Les quatre portees, repondues ou non' } },
      },
      put: {
        tags: ['Confidentialite'],
        summary: 'Donner ou retirer un consentement (EF-02-03/07)',
        description: "Accorder ou retirer un consentement (EF-02-03/07).\n\n**Deux ecritures, une transaction** : l'evenement, qui ne s'efface jamais, et l'etat courant, qui sert aux controles d'acces.\n\n**Accorder exige un texte publie** (409 sinon) : on ne consent pas a un texte qui n'existe pas. **Un retrait est toujours possible**, meme sans texte — le refuser faute de documentation reviendrait a retenir quelqu'un contre son gre.\n\n**Le retrait prend effet tout de suite** : aucun delai, aucune file d'attente. Il n'est pas rattache au texte du jour mais a celui qui avait ete accepte.\n\n**Limite a connaitre.** Aujourd'hui, seul l'export FHIR consulte reellement ces consentements. L'acces au dossier par un soignant est decide par la relation de soin (etre suivi dans l'etablissement, avoir un episode en cours), sans passer par `DOSSIER_MEDICAL`. L'ecran du patient le dit desormais au lieu d'affirmer le contraire ; le raccordement demande le bris de glace (EF-02-06), sans quoi couper l'acces bloquerait des soins.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['scope', 'actif'], properties: { scope: { type: 'string', enum: ['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE'] }, actif: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Consentement mis a jour' } },
      },
    },
    '/api/v1/privacy/me/audit-logs': {
      get: {
        tags: ['Confidentialite'],
        summary: 'Qui a consulte mon dossier (EF-02-08)',
        description: "Le journal des acces au dossier du patient connecte, du plus recent au plus ancien.\n\n**Ce que chaque ligne porte** : qui a agi (nom, prenom, role), quand, le code HTTP rendu (`statutHttp` — un refus >= 400 est une tentative, pas un acces), et deux cles de traduction.\n\n**L'API ne rend pas de texte redige.** `libelle` et `libelleObjet` sont des cles d'i18n : la plateforme est bilingue, et une phrase francaise figee s'afficherait telle quelle a un patient ayant choisi l'anglais. Le client traduit `libelleObjet`, puis le passe en parametre `objet` a `libelle`. `libelleObjet` est vide pour les phrases qui se suffisent a elles-memes, comme le scan d'un code.\n\n`action` et `ressource` restent la trace technique (`GET /:id`), **a ne pas afficher seules** : elles servent une enquete ou un signalement.\n\n**Les objets restent generaux** (« un document de votre dossier », jamais « une ordonnance ») : un journal se lit parfois sur un ecran partage, et ces mots sont interdits par EF-11-02. Une anomalie se repere a l'auteur et a l'heure.\n\n**Ce que le journal ne nomme pas** : une recherche ou une liste touche plusieurs dossiers, ou aucun. Ces acces sont traces mais n'apparaissent dans le journal d'aucun patient. Le couvrir demanderait une ligne par patient affiche — un choix a trancher, pas un oubli.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'parTiers', in: 'query', schema: { type: 'boolean', default: false }, description: "Ne garder que les acces d'autrui. C'est ce qu'on cherche quand on soupconne une anomalie : les acces du patient lui-meme representaient 273 lignes sur 850 dans la base de demonstration." },
        ],
        responses: {
          200: {
            description: 'Journal des acces, page par page',
            content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: {
              id: { type: 'string' },
              action: { type: 'string', description: 'Trace technique : le motif de route' },
              ressource: { type: 'string' },
              idRessource: { type: 'string', nullable: true },
              libelle: { type: 'string', description: "Cle d'i18n de la phrase ; attend un parametre `objet`" },
              libelleObjet: { type: 'string', description: "Cle d'i18n de l'objet ; vide si la phrase se suffit" },
              parMoi: { type: 'boolean', description: 'Vrai quand le patient est lui-meme l auteur' },
              statutHttp: { type: 'integer', nullable: true },
              creeLe: { type: 'string', format: 'date-time' },
              utilisateur: { type: 'object', properties: { id: { type: 'string' }, prenom: { type: 'string' }, nom: { type: 'string' }, role: { type: 'string' } } },
            } } }, meta: { type: 'object', properties: { total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' }, totalPages: { type: 'integer' } } } } }] } } },
          },
          404: { description: 'Profil patient non trouve' },
        },
      },
    },
    '/api/v1/ussd/session': {
      post: {
        tags: ['USSD'],
        summary: 'Endpoint callback USSD compatible agregateur',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['sessionId', 'phoneNumber'], properties: { sessionId: { type: 'string' }, phoneNumber: { type: 'string' }, text: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Reponse texte CON/END', content: { 'text/plain': { schema: { type: 'string' } } } } },
      },
    },
    // ── Parametres de la plateforme (feuille de route P0) ──────────────
    '/api/v1/parametres/publics': {
      get: {
        tags: ['Parametres'],
        summary: 'Identite publique de la plateforme (nom, logo, coordonnees) — sans authentification',
        responses: {
          200: {
            description: 'Identite courante',
            content: { 'application/json': { schema: { type: 'object', properties: {
              nom: { type: 'string', example: 'KÈNÈYA' },
              nomCourt: { type: 'string', example: 'KENEYA', description: 'Version sans accent pour SMS/USSD' },
              slogan: { type: 'string' }, logoUrl: { type: 'string' },
              adresse: { type: 'string' }, ville: { type: 'string' }, pays: { type: 'string' },
              telephone: { type: 'string' }, telephoneSupport: { type: 'string' },
              emailContact: { type: 'string' }, emailSupport: { type: 'string' }, emailExpediteur: { type: 'string' },
              siteWeb: { type: 'string' }, facebook: { type: 'string' }, whatsapp: { type: 'string' },
              copyright: { type: 'string' }, devise: { type: 'string', example: 'GNF' },
            } } } },
          },
        },
      },
    },
    '/api/v1/admin-structure/parametres': {
      get: { tags: ['Parametres'], summary: 'Parametres complets (SUPER_ADMIN)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Sections identite, facturation, securite, alertes, sync' } } },
      put: {
        tags: ['Parametres'], summary: 'Mise a jour partielle, section par section (SUPER_ADMIN)', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { identite: { type: 'object' }, facturation: { type: 'object' }, securite: { type: 'object' }, alertes: { type: 'object' }, sync: { type: 'object' } } } } } },
        responses: { 200: { description: 'Parametres a jour' }, 400: { description: 'Validation' } },
      },
    },
    // ── P1 Hopital : episodes de soins et demandes d'analyse (EF-03) ────
    '/api/v1/hopital/presences': {
      get: { tags: ['Hôpital'], summary: 'Patients attendus aujourd\'hui (addendum 2026-09-28, point 2)', description: 'La file de l\'assistante : qui est attendu, avec quel medecin, et qui est deja arrive.', security: [{ bearerAuth: [] }], parameters: [{ name: 'jour', in: 'query', schema: { type: 'string', format: 'date' } }], responses: { 200: { description: 'Rendez-vous du jour dans la structure' } } } },
    '/api/v1/hopital/rendez-vous/{id}/presence': {
      post: { tags: ['Hôpital'], summary: 'Pointer l\'arrivee du patient', description: 'Le seul geste de l\'accueil sur un rendez-vous : il ne le cree pas et n\'en change pas l\'heure. Le medecin est prevenu que son patient attend. Un second pointage est refuse.', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Arrivee pointee ; le medecin est prevenu' }, 404: { description: 'Rendez-vous introuvable dans cette structure' }, 409: { description: 'Deja pointe, ou rendez-vous annule' } } } },
    '/api/v1/hopital/tableau-de-bord': { get: { tags: ['Hopital'], summary: 'Tableau de bord de l etablissement (EF-03-07)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Compteurs et derniers episodes' } } } },
    '/api/v1/hopital/patients/recherche': {
      get: { tags: ['Hopital'], summary: 'Rechercher un patient avant admission (EF-03-01)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 3 }, description: 'Nom, prenom, telephone ou QR code' }],
        responses: { 200: { description: 'Identites minimales, telephone masque, episode ouvert eventuel' } } },
    },
    '/api/v1/hopital/examens': { get: { tags: ['Hopital'], summary: 'Referentiel des examens (codes LOINC)', security: [{ bearerAuth: [] }], parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'categorie', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Examens actifs' } } } },
    '/api/v1/hopital/laboratoires': { get: { tags: ['Hopital'], summary: 'Structures pouvant recevoir une demande d analyse', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Laboratoires et hopitaux actifs' } } } },
    '/api/v1/hopital/medecins': { get: { tags: ['Hopital'], summary: 'Medecins de la structure (orientation)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Liste' } } } },
    '/api/v1/hopital/episodes': {
      get: { tags: ['Hopital'], summary: 'Episodes de la structure', security: [{ bearerAuth: [] }], parameters: [{ name: 'statut', in: 'query', schema: { type: 'string', enum: ['OUVERT', 'EN_COURS', 'CLOS', 'ANNULE'] } }, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Page d episodes' } } },
      post: { tags: ['Hopital'], summary: 'Ouvrir un episode de soins (EF-03-02)', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idPatient', 'motif'], properties: { idPatient: { type: 'string' }, motif: { type: 'string' }, service: { type: 'string' }, idResponsable: { type: 'string' }, notes: { type: 'string' } } } } } },
        responses: { 201: { description: 'Episode numerote EP-AAAA-NNNNNN' }, 409: { description: 'Un episode est deja ouvert pour ce patient' } } },
    },
    '/api/v1/hopital/episodes/{id}': {
      get: { tags: ['Hopital'], summary: 'Detail d un episode', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Episode avec demandes et rendez-vous' } } },
      patch: { tags: ['Hopital'], summary: 'Modifier un episode', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { motif: { type: 'string' }, service: { type: 'string' }, idResponsable: { type: 'string', nullable: true }, notes: { type: 'string', nullable: true }, statut: { type: 'string', enum: ['OUVERT', 'EN_COURS'] } } } } } }, responses: { 200: { description: 'Episode a jour' } } },
    },
    '/api/v1/hopital/episodes/{id}/cloturer': { post: { tags: ['Hopital'], summary: 'Cloturer un episode', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Episode clos' } } } },
    '/api/v1/hopital/episodes/{id}/annuler': { post: { tags: ['Hopital'], summary: 'Annuler un episode', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Episode annule' } } } },
    '/api/v1/hopital/episodes/{id}/orientation': {
      post: { tags: ['Hopital'], summary: 'Orienter vers un medecin ou un service, rendez-vous propose (EF-03-05)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { idMedecin: { type: 'string' }, service: { type: 'string' }, prevuLe: { type: 'string', format: 'date-time' }, motif: { type: 'string' } } } } } },
        responses: { 200: { description: 'Episode EN_COURS, rendez-vous cree si prevuLe' } } },
    },
    '/api/v1/hopital/episodes/{id}/demandes-analyse': {
      post: { tags: ['Hopital'], summary: 'Creer et transmettre une demande d analyse structuree (EF-03-03, EF-03-04)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idLaboratoire', 'examens'], properties: { idLaboratoire: { type: 'string' }, urgence: { type: 'string', enum: ['ROUTINE', 'URGENT', 'URGENCE_VITALE'] }, indicationClinique: { type: 'string' }, consignesPatient: { type: 'string' }, examens: { type: 'array', items: { type: 'object', required: ['idExamen'], properties: { idExamen: { type: 'string' }, commentaire: { type: 'string' } } } } } } } } },
        responses: { 201: { description: 'Demande DA-AAAA-NNNNNN transmise, patient notifie' } } },
    },
    '/api/v1/hopital/demandes-analyse/{id}': { get: { tags: ['Hopital'], summary: 'Detail d une demande d analyse', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Demande avec lignes' } } } },
    '/api/v1/hopital/demandes-analyse/{id}/annuler': { post: { tags: ['Hopital'], summary: 'Annuler une demande non prelevee', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['motif'], properties: { motif: { type: 'string' } } } } } }, responses: { 200: { description: 'Demande annulee' }, 409: { description: 'Prelevement deja realise' } } } },
    '/api/v1/hopital/demandes-analyse/{id}/document': { get: { tags: ['Hopital'], summary: 'Bon d examen imprimable (EF-03-06)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'HTML pret a imprimer', content: { 'text/html': { schema: { type: 'string' } } } } } } },
    '/api/v1/patients/me/episodes': { get: { tags: ['Patients'], summary: 'Mon parcours hospitalier : episodes, analyses, rendez-vous', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Episodes du patient' } } } },
    '/api/v1/patients/me/demandes-analyse/{id}/document': { get: { tags: ['Patients'], summary: 'Mon bon d examen imprimable', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } } } },
    // ── P2 Laboratoire : prelevement, resultats, validation, critiques (EF-04) ──
    '/api/v1/laboratoire/tableau-de-bord': { get: { tags: ['Laboratoire'], summary: 'Tableau de bord du laboratoire', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Compteurs, prochains prelevements, file urgente' } } } },
    '/api/v1/laboratoire/scan/{qrCode}': { get: { tags: ['Laboratoire'], summary: 'Scan du QR patient au comptoir', description: 'Le patient arrive avec son code ; le laborantin le scanne et voit ce qu\'il reste a faire pour lui **dans son laboratoire**. Le scan ouvre une fenetre, pas le dossier : identite minimale et demandes encore a traiter, ni resultats valides, ni ordonnances, ni historique. Le geste est trace au journal d\'audit ; le journal des acces consultable par le patient (EF-02-08) reste a construire en P4.', security: [{ bearerAuth: [] }], parameters: [{ name: 'qrCode', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Patient et demandes a traiter' }, 403: { description: 'Aucun laboratoire rattache au compte' }, 404: { description: 'QR code inconnu' } } } },
    '/api/v1/laboratoire/demandes': { get: { tags: ['Laboratoire'], summary: 'File des demandes triee par urgence puis anciennete (EF-04-01)', security: [{ bearerAuth: [] }], parameters: [{ name: 'statut', in: 'query', schema: { type: 'string', enum: ['TRANSMISE', 'RECUE', 'PRELEVEE', 'EN_ANALYSE', 'VALIDEE', 'ANNULEE'] } }, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Page de demandes' } } } },
    '/api/v1/laboratoire/demandes/{id}': { get: { tags: ['Laboratoire'], summary: 'Detail : lignes, echantillons, resultats', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Demande' } } } },
    '/api/v1/laboratoire/demandes/{id}/reception': { post: { tags: ['Laboratoire'], summary: 'Accuser reception (TRANSMISE -> RECUE)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Demande RECUE' }, 409: { description: 'Statut incompatible' } } } },
    '/api/v1/laboratoire/demandes/{id}/prelevement/planifier': { post: { tags: ['Laboratoire'], summary: 'Planifier le prelevement sur place ou a domicile, patient notifie (EF-04-02)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lieu'], properties: { lieu: { type: 'string', enum: ['SUR_PLACE', 'DOMICILE'] }, creneau: { type: 'string', format: 'date-time' } } } } } }, responses: { 200: { description: 'Creneau enregistre' } } } },
    '/api/v1/laboratoire/demandes/{id}/prelevement': { post: { tags: ['Laboratoire'], summary: 'Enregistrer le prelevement : echantillons codes EC-AAAA-NNNNNN (EF-04-03)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { lieu: { type: 'string', enum: ['SUR_PLACE', 'DOMICILE'] }, echantillons: { type: 'array', description: 'Par defaut : un echantillon par type de specimen', items: { type: 'object', required: ['specimen'], properties: { specimen: { type: 'string' }, commentaire: { type: 'string' } } } } } } } } }, responses: { 201: { description: 'Demande PRELEVEE' } } } },
    '/api/v1/laboratoire/demandes/{id}/resultats': { put: { tags: ['Laboratoire'], summary: 'Saisir ou importer des resultats, lecture calculee d apres les references (EF-04-04, EF-04-06)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['resultats'], properties: { resultats: { type: 'array', items: { type: 'object', required: ['valeur'], properties: { idLigne: { type: 'string' }, codeLoinc: { type: 'string', description: 'Alternative a idLigne (import automate)' }, valeur: { type: 'string' }, unite: { type: 'string' }, commentaire: { type: 'string' }, idEchantillon: { type: 'string' }, interpretation: { type: 'string', enum: ['NORMAL', 'ANORMAL', 'CRITIQUE'] } } } } } } } } }, responses: { 200: { description: 'Demande EN_ANALYSE avec resultats' } } } },
    '/api/v1/laboratoire/demandes/{id}/valider': { post: { tags: ['Laboratoire'], summary: 'Validation nominative du laborantin, bloquante avant diffusion (EF-04-05) ; alertes critiques au prescripteur (EF-04-07)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { commentaire: { type: 'string' } } } } } }, responses: { 200: { description: 'Demande VALIDEE ; patient informe sauf resultat critique en attente d accuse' }, 403: { description: 'Reserve au role TECHNICIEN_LABO' }, 400: { description: 'Resultat manquant' } } } },
    '/api/v1/laboratoire/demandes/{id}/compte-rendu': { get: { tags: ['Laboratoire'], summary: 'Compte rendu imprimable (filigrane NON VALIDE avant validation)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } } } },
    '/api/v1/resultats/alertes': { get: { tags: ['Resultats'], summary: 'Mes alertes de resultats critiques, non accusees d abord (EF-04-08)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Alertes' } } } },
    '/api/v1/resultats/alertes/{id}/accuser': { post: { tags: ['Resultats'], summary: 'Accuser lecture ; declenche la diffusion au patient si plus rien n est en attente (EF-04-09)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Alerte accusee' } } } },
    '/api/v1/resultats/demandes/{id}/compte-rendu': { get: { tags: ['Resultats'], summary: 'Compte rendu d une demande de ma structure', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } } } },
    '/api/v1/resultats/patients/{idPatient}/examens-suivis': { get: { tags: ['Resultats'], summary: 'Examens numeriques disponibles pour une courbe', security: [{ bearerAuth: [] }], parameters: [{ name: 'idPatient', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Liste' }, 403: { description: 'Dossier non accessible' } } } },
    '/api/v1/resultats/patients/{idPatient}/evolution': { get: { tags: ['Resultats'], summary: 'Courbe d evolution d une valeur (EF-04-10)', security: [{ bearerAuth: [] }], parameters: [{ name: 'idPatient', in: 'path', required: true, schema: { type: 'string' } }, { name: 'codeLoinc', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Points dates avec references' } } } },
    '/api/v1/patients/me/demandes-analyse/{id}/compte-rendu': { get: { tags: ['Patients'], summary: 'Mon compte rendu de resultats (une fois diffuse)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'HTML' }, 409: { description: 'Resultats non encore disponibles' } } } },
    '/api/v1/patients/me/resultats/examens-suivis': { get: { tags: ['Patients'], summary: 'Mes examens suivis dans le temps', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Liste' } } } },
    '/api/v1/patients/me/resultats/evolution': { get: { tags: ['Patients'], summary: 'Ma courbe d evolution pour un examen (EF-04-10)', security: [{ bearerAuth: [] }], parameters: [{ name: 'codeLoinc', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Points' } } } },
    '/api/v1/admin-structure/parametres/logo': {
      post: {
        tags: ['Parametres'], summary: 'Televerser le logo de la plateforme (SUPER_ADMIN)', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { logo: { type: 'string', format: 'binary', description: 'PNG, JPEG, WebP ou SVG, 2 Mo max' } } } } } },
        responses: { 200: { description: 'Identite a jour avec logoUrl' }, 400: { description: 'Image refusee' } },
      },
    },
    // ── P11 Demandes d'exercice de droits (EF-12-09) ──────────────────
    '/api/v1/privacy/me/demandes-rgpd': {
      get: {
        tags: ['Confidentialite'],
        summary: 'Mes demandes d exercice de droits (EF-12-09)',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Mes demandes, la plus recente d abord', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['ACCES', 'RECTIFICATION', 'EFFACEMENT', 'PORTABILITE', 'OPPOSITION', 'LIMITATION'] },
              statut: { type: 'string', enum: ['RECUE', 'EN_COURS', 'SATISFAITE', 'REFUSEE'] },
              precision: { type: 'string', nullable: true },
              creeLe: { type: 'string', format: 'date-time' },
              dateLimite: { type: 'string', format: 'date-time' },
              joursRestants: { type: 'integer', nullable: true, description: "Null une fois la demande close : son delai ne court plus" },
              enRetard: { type: 'boolean' },
              reponse: { type: 'string', nullable: true },
              traiteLe: { type: 'string', format: 'date-time', nullable: true },
              traitePar: { type: 'string', nullable: true, description: "Null si l'agent a depuis quitte la plateforme" },
              demandeur: { type: 'string' },
            } } } } }] } } } },
          404: { description: 'Profil patient non trouve' },
        },
      },
      post: {
        tags: ['Confidentialite'],
        summary: 'Deposer une demande (EF-12-09)',
        description: "Deposer une demande d'exercice de droits. C'est un droit du patient : la route lui est ouverte, et c'est l'administration nationale qui traite.\n\n**Rien n'est execute automatiquement.** Ni effacement, ni rectification d'un dossier de soins : ces actes ont des consequences legales et se decident. La demande est enregistree, suivie, et une reponse ecrite est obligatoire.\n\n**Sur l'effacement.** Un dossier de soins est soumis a une duree de conservation, et le journal d'audit doit survivre — c'est pourquoi `JournalAudit.idPatientConcerne` est en `onDelete: Restrict`. Ce que la plateforme peut offrir est une anonymisation de l'identite, le dossier restant pour sa duree legale. Une demande d'effacement est donc satisfaite *ainsi*, ou refusee avec son motif.\n\n`precision` est **obligatoire pour une rectification** : sans elle, on ne sait pas quoi corriger. Une seconde demande du meme type encore ouverte est refusee.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['type'], properties: {
          type: { type: 'string', enum: ['ACCES', 'RECTIFICATION', 'EFFACEMENT', 'PORTABILITE', 'OPPOSITION', 'LIMITATION'] },
          precision: { type: 'string', maxLength: 2000, description: 'Obligatoire pour une rectification' },
        } } } } },
        responses: {
          201: { description: 'Demande enregistree, avec sa date limite' },
          400: { description: 'Type inconnu, rectification sans precision, ou demande du meme type deja ouverte' },
        },
      },
    },
    '/api/v1/demandes-rgpd': {
      get: {
        tags: ['Demandes RGPD'],
        summary: 'La file de traitement (EF-12-09)',
        description: "La file de traitement : les demandes ouvertes d'abord, puis la plus urgente. Reserve a `ADMIN_NATIONAL` et `SUPER_ADMIN` — une demande RGPD engage le responsable de traitement, pas un etablissement.\n\n`enRetard` compte celles dont le delai est depasse. Le delai applique est de 30 jours ; le RGPD en donne un, prolongeable a trois pour une demande complexe, mais **la prolongation est une decision humaine qui se motive**, pas une regle qu'un service applique seul.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'statut', in: 'query', schema: { type: 'string', enum: ['RECUE', 'EN_COURS', 'SATISFAITE', 'REFUSEE'] } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['ACCES', 'RECTIFICATION', 'EFFACEMENT', 'PORTABILITE', 'OPPOSITION', 'LIMITATION'] } },
        ],
        responses: {
          200: { description: 'File de demandes', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: {
            demandes: { type: 'array', items: { type: 'object', properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['ACCES', 'RECTIFICATION', 'EFFACEMENT', 'PORTABILITE', 'OPPOSITION', 'LIMITATION'] },
              statut: { type: 'string', enum: ['RECUE', 'EN_COURS', 'SATISFAITE', 'REFUSEE'] },
              precision: { type: 'string', nullable: true },
              creeLe: { type: 'string', format: 'date-time' },
              dateLimite: { type: 'string', format: 'date-time' },
              joursRestants: { type: 'integer', nullable: true, description: "Null une fois la demande close : son delai ne court plus" },
              enRetard: { type: 'boolean' },
              reponse: { type: 'string', nullable: true },
              traiteLe: { type: 'string', format: 'date-time', nullable: true },
              traitePar: { type: 'string', nullable: true, description: "Null si l'agent a depuis quitte la plateforme" },
              demandeur: { type: 'string' },
            } } },
            ouvertes: { type: 'integer' }, enRetard: { type: 'integer' }, delaiJours: { type: 'integer' },
          } } } }] } } } },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    '/api/v1/demandes-rgpd/{id}/prendre-en-charge': {
      post: {
        tags: ['Demandes RGPD'],
        summary: 'Se declarer en charge (EF-12-09)',
        description: "Reclamation atomique : deux agents ne peuvent pas se croire chacun en charge de la meme demande.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Demande passee EN_COURS' },
          403: { description: 'Deja prise en charge' },
          404: { description: 'Demande introuvable' },
        },
      },
    },
    '/api/v1/demandes-rgpd/{id}/repondre': {
      post: {
        tags: ['Demandes RGPD'],
        summary: 'Clore la demande, avec sa reponse ecrite (EF-12-09)',
        description: "Clore la demande. La reponse est **obligatoire dans les deux cas**, au moins dix caracteres : un refus qu'on ne motive pas n'est pas contestable, et une demande satisfaite doit dire ce qui a ete fait. La regle vit dans le schema, dans le service **et** dans une contrainte SQL, pour ne dependre d'aucun des trois seul.\n\nOn ne repond qu'une fois : une demande deja close est refusee en 403.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['satisfaite', 'reponse'], properties: {
          satisfaite: { type: 'boolean' },
          reponse: { type: 'string', minLength: 10, maxLength: 4000 },
        } } } } },
        responses: {
          200: { description: 'Demande close' },
          400: { description: 'Reponse absente ou trop courte' },
          403: { description: 'Demande deja close' },
          404: { description: 'Demande introuvable' },
        },
      },
    },
    // ── P11 Suspension de compte (EF-12-01) ───────────────────────────
    '/api/v1/comptes': {
      get: {
        tags: ['Comptes'],
        summary: 'Lister les comptes (EF-12-01)',
        description: "La liste des comptes de la plateforme, les fermes d'abord. Reserve a `ADMIN_NATIONAL` et `SUPER_ADMIN`.\n\n`fermeSansMotif` distingue un compte ferme par l'ancienne voie (`desactiverAgent`, reservee a l'admin de structure, qui n'enregistre ni date ni motif) d'une suspension documentee. On le dit plutot que de laisser croire a une mesure expliquee.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Nom, prenom, e-mail ou telephone' },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'actifs', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
        ],
        responses: {
          200: { description: 'Page de comptes', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: {
            comptes: { type: 'array', items: { type: 'object', properties: {
              id: { type: 'string' }, prenom: { type: 'string' }, nom: { type: 'string' },
              email: { type: 'string', nullable: true }, telephone: { type: 'string' },
              role: { type: 'string' }, estActif: { type: 'boolean' },
              structure: { type: 'string', nullable: true },
              derniereConnexion: { type: 'string', format: 'date-time', nullable: true },
              suspension: { type: 'object', nullable: true, properties: { suspenduLe: { type: 'string', format: 'date-time' }, motif: { type: 'string' }, parQui: { type: 'string', nullable: true } } },
              fermeSansMotif: { type: 'boolean', description: "Ferme par l'ancienne voie, sans date ni motif" },
            } } },
            total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' },
          } } } }] } } } },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    '/api/v1/comptes/{id}/suspendre': {
      post: {
        tags: ['Comptes'],
        summary: 'Suspendre un compte immediatement (EF-12-01)',
        description: "Ferme un compte **immediatement**. Le mot engage : trois portes sont fermees.\n\n1. `estActif = false` — chaque requete HTTP relit la session en base, donc le refus vaut des la requete suivante ;\n2. **les sessions sont supprimees** — sans quoi elles tiennent jusqu'a leur expiration ;\n3. **les connexions temps reel sont coupees** — un socket n'est authentifie qu'a la poignee de main. Avant le 2026-10-03, un compte suspendu continuait de recevoir les notifications de ses patients jusqu'a ce qu'il ferme son navigateur, alors que la moindre requete HTTP lui etait refusee.\n\nLa reponse dit **ce qui a reellement ete coupe** (`sessionsFermees`, `socketsFermes`) plutot qu'un simple « fait » : une mesure annoncee immediate doit pouvoir etre verifiee.\n\n**Le motif est obligatoire**, au moins dix caracteres. Une suspension coupe un soignant de ses patients ; une mesure qu'on ne peut pas expliquer ne peut pas etre contestee. La regle vit aussi dans une contrainte SQL, pour ne dependre d'aucun code seul.\n\n**Refus possibles** : se suspendre soi-meme, un compte deja ferme, un `SUPER_ADMIN` quand on n'en est pas un, et surtout **le dernier super administrateur actif** — le suspendre laisserait la plateforme sans administration, sans retour en arriere possible.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['motif'], properties: { motif: { type: 'string', minLength: 10, maxLength: 500 } } } } } },
        responses: {
          200: { description: 'Compte ferme', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: {
            id: { type: 'string' }, nomComplet: { type: 'string' }, estActif: { type: 'boolean' },
            motif: { type: 'string', nullable: true },
            sessionsFermees: { type: 'integer' }, socketsFermes: { type: 'integer' },
          } } } }] } } } },
          400: { description: 'Motif absent ou trop court' },
          403: { description: 'Soi-meme, compte deja ferme, super administrateur, ou dernier administrateur actif' },
          404: { description: 'Compte introuvable' },
        },
      },
    },
    '/api/v1/comptes/{id}/reactiver': {
      post: {
        tags: ['Comptes'],
        summary: 'Reactiver un compte (EF-12-01)',
        description: "Rouvre un compte. La fiche ne garde **aucune** trace de la suspension levee : une contrainte SQL l'exige, et un compte actif affichant encore un motif de suspension serait trompeur.\n\n**Le journal d'audit garde l'histoire** — il est en ajout seul (EF-12-04), et c'est la qu'une enquete retrouvera la suite des decisions.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Compte reactive' },
          400: { description: 'Compte deja actif' },
          403: { description: 'Reserve a un super administrateur pour un super administrateur' },
          404: { description: 'Compte introuvable' },
        },
      },
    },
    // ── P11 Journal d'audit : recherche et export (EF-12-05) ──────────
    '/api/v1/journal': {
      get: {
        tags: ['Journal d audit'],
        summary: 'Rechercher dans le journal d audit (EF-12-05)',
        description: "L'ecran le plus sensible du produit : c'est le seul endroit ou l'on voit, d'un coup, qui a touche au dossier de qui. Reserve a `ADMIN_NATIONAL` et `SUPER_ADMIN`.\n\n**Cette route est elle-meme journalisee.** Sans cela, le seul endroit d'ou l'on voit tout serait le seul qu'on ne verrait pas — et le journal ne prouverait plus rien le jour ou il faudrait s'en servir.\n\n**Sans `du`, la recherche ne remonte pas au-dela de 30 jours** : une requete sans critere ne doit pas balayer la table entiere, qui est celle qui grandit le plus vite de la plateforme. Une borne haute donnee en date seule (`2026-10-03`) inclut la journee entiere — « jusqu'au 3 » veut dire le 3 compris.\n\n**Un critere mal orthographie est refuse en 400, pas ignore** : un filtre silencieusement ecarte rendrait un resultat trop large a une enquete, sans que personne le sache.\n\n`libelle` et `libelleObjet` sont des cles d'i18n, comme pour le journal du patient ; `action` et `ressource` restent la trace technique.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'du', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Borne basse. Par defaut : il y a 30 jours.' },
          { name: 'au', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Borne haute. Une date seule vaut la fin de la journee.' },
          { name: 'idUtilisateur', in: 'query', schema: { type: 'string' }, description: "L'auteur de l'action." },
          { name: 'idPatient', in: 'query', schema: { type: 'string' }, description: 'Le patient dont le dossier a ete touche.' },
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'PHARMACIEN', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO', 'LIVREUR', 'ASSUREUR', 'ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] } },
          { name: 'ressource', in: 'query', schema: { type: 'string' }, description: 'patients, consultations, laboratoire, journal...' },
          { name: 'echecsSeulement', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Ne garder que les refus (code HTTP >= 400) : une tentative, pas un acces. Souvent le premier critere d une enquete.' },
          { name: 'parTiers', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: "Avec `idPatient` : exclure les acces du patient a son propre dossier. Sans `idPatient`, ce critere n'a pas de sens et reste sans effet." },
        ],
        responses: {
          200: {
            description: 'Page de lignes, de la plus recente a la plus ancienne',
            content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: {
              lignes: { type: 'array', items: { type: 'object', properties: {
                id: { type: 'string' },
                creeLe: { type: 'string', format: 'date-time' },
                action: { type: 'string', description: 'Trace technique : le motif de route' },
                ressource: { type: 'string' },
                idRessource: { type: 'string', nullable: true },
                libelle: { type: 'string', description: "Cle d'i18n ; attend un parametre `objet`" },
                libelleObjet: { type: 'string' },
                statutHttp: { type: 'integer', nullable: true },
                ipAdresse: { type: 'string', nullable: true },
                idUtilisateur: { type: 'string' },
                acteur: { type: 'object', properties: { prenom: { type: 'string' }, nom: { type: 'string' }, role: { type: 'string' } } },
                idPatientConcerne: { type: 'string', nullable: true },
                patientConcerne: { type: 'string', nullable: true, description: "Nom du patient, ou null quand l'action ne concernait aucun dossier — une liste ou une recherche, par exemple" },
              } } },
              meta: { type: 'object', properties: { total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' }, totalPages: { type: 'integer' } } },
              maxExport: { type: 'integer', description: "Au-dela, l'export est refuse plutot que tronque" },
            } } } }] } } },
          },
          400: { description: 'Critere inconnu, role inconnu, date illisible ou intervalle a l envers' },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    '/api/v1/journal/anomalies': {
      get: {
        tags: ['Journal d audit'],
        summary: 'Anomalies d acces a examiner (EF-12-06)',
        description: "**Des signaux a examiner, pas des verdicts.** Un soignant de garde consulte beaucoup de dossiers la nuit sans rien faire de mal, et un comptoir de pharmacie scanne des dizaines de codes par jour. Un detecteur qui trancherait ferait suspendre des gens a tort — et une suspension coupe un soignant de ses patients. Chaque signal porte ce qui l'a declenche et de quoi aller voir le detail dans le journal ; il ne conclut rien.\n\n**Trois detecteurs**, sur une fenetre glissante :\n- `REFUS_REPETES` — refus d'acces repetes par le meme compte. **Seuls 401 et 403 comptent** : un 400 est une requete mal formee, pas une porte forcee (la base de demonstration en portait 58, tous issus de scripts de verification), et un 404 est trop bruyant pour declencher seul ;\n- `VOLUME_DOSSIERS` — dossiers **distincts** touches par le meme compte. Ouvrir dix fois le meme dossier ne compte que pour un ;\n- `ADRESSES_MULTIPLES` — un compte vu depuis plusieurs adresses IP : identifiants partages ou voles. Celui-la **ne monte jamais en alerte**, un soignant passant du wifi de l'etablissement a son telephone le declenche.\n\n`gravite` vaut `ALERTE` au-dela du triple du seuil, `SIGNAL` sinon : un compte a six refus et un compte a soixante n'appellent pas la meme reaction. Les alertes sont rendues en tete.\n\n**Les seuils ne sont pas calibres sur du trafic reel** et devront probablement varier selon le role. Ils sont rendus avec la reponse pour que l'ecran puisse les montrer plutot que de les cacher.\n\nDepuis un signal, l'enquete continue sur `/api/v1/journal?idUtilisateur=...&echecsSeulement=true`.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'fenetreHeures', in: 'query', schema: { type: 'integer', default: 1, maximum: 168 }, description: 'Fenetre glissante. Une valeur hors bornes retombe sur la valeur par defaut.' },
        ],
        responses: {
          200: { description: 'Signaux, alertes en tete', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: {
            anomalies: { type: 'array', items: { type: 'object', properties: {
              type: { type: 'string', enum: ['REFUS_REPETES', 'VOLUME_DOSSIERS', 'ADRESSES_MULTIPLES'] },
              gravite: { type: 'string', enum: ['SIGNAL', 'ALERTE'] },
              idUtilisateur: { type: 'string' },
              acteur: { type: 'string', description: "« Compte supprime » si le compte n'existe plus : le journal lui survit" },
              role: { type: 'string', nullable: true },
              acteurActif: { type: 'boolean', description: 'Faux si le compte est deja ferme' },
              mesure: { type: 'integer' }, seuil: { type: 'integer' },
              depuis: { type: 'string', format: 'date-time' },
            } } },
            seuils: { type: 'object', properties: { refusRepetes: { type: 'integer' }, dossiersDistincts: { type: 'integer' }, adressesDistinctes: { type: 'integer' }, fenetreHeures: { type: 'integer' } } },
            depuis: { type: 'string', format: 'date-time' },
          } } } }] } } } },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    '/api/v1/journal/export': {
      get: {
        tags: ['Journal d audit'],
        summary: 'Exporter le journal en CSV (EF-12-05)',
        description: "L'export CSV des memes criteres. Point-virgule, BOM UTF-8 et fins de ligne CRLF : c'est Excel en francais qui l'ouvrira. Les champs contenant le separateur, un guillemet ou un saut de ligne sont entoures de guillemets, les guillemets interieurs doubles.\n\n**Un export trop large est refuse, jamais tronque en silence** (400, avec le nombre exact de lignes). Un journal d'audit ampute sans le dire est pire qu'un export absent : on conclut d'une absence de ligne qu'il ne s'est rien passe. L'operateur resserre la periode ou ajoute un critere ; la limite est annoncee par `maxExport` sur la route de recherche.\n\nLe fichier porte la trace technique (`action`, `ressource`) et non la phrase redigee pour le patient : un export sert une enquete, pas un ecran.\n\n`Content-Disposition` est expose au navigateur (CORS), pour que le front retrouve le nom du fichier propose.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'du', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Borne basse. Par defaut : il y a 30 jours.' },
          { name: 'au', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Borne haute. Une date seule vaut la fin de la journee.' },
          { name: 'idUtilisateur', in: 'query', schema: { type: 'string' }, description: "L'auteur de l'action." },
          { name: 'idPatient', in: 'query', schema: { type: 'string' }, description: 'Le patient dont le dossier a ete touche.' },
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'PHARMACIEN', 'AGENT_ACCUEIL', 'TECHNICIEN_LABO', 'LIVREUR', 'ASSUREUR', 'ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] } },
          { name: 'ressource', in: 'query', schema: { type: 'string' }, description: 'patients, consultations, laboratoire, journal...' },
          { name: 'echecsSeulement', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Ne garder que les refus (code HTTP >= 400) : une tentative, pas un acces. Souvent le premier critere d une enquete.' },
          { name: 'parTiers', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: "Avec `idPatient` : exclure les acces du patient a son propre dossier. Sans `idPatient`, ce critere n'a pas de sens et reste sans effet." },
        ],
        responses: {
          200: { description: 'Fichier CSV', content: { 'text/csv': { schema: { type: 'string' } } } },
          400: { description: "Export trop large (le message donne le nombre exact de lignes), ou critere invalide" },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    // ── P11 Referentiels : import CSV reserve a l'administration nationale (EF-12-03) ──
    '/api/v1/referentiels/{type}/colonnes': {
      get: {
        tags: ['Referentiels'],
        summary: 'Les colonnes a preparer dans le fichier',
        description: "A consulter **avant** l'import : l'operateur sait quelles colonnes sont exigees et lesquelles sont facultatives. L'ordre des colonnes dans le fichier n'a pas d'importance, seuls les en-tetes comptent (compares en minuscules, espaces retires).",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['examens', 'interactions', 'medicaments'] } }],
        responses: {
          200: { description: 'Colonnes obligatoires et facultatives', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: { type: { type: 'string' }, obligatoires: { type: 'array', items: { type: 'string' } }, facultatives: { type: 'array', items: { type: 'string' } } } } } }] } } } },
          400: { description: 'Referentiel inconnu' },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    '/api/v1/referentiels/{type}/import': {
      post: {
        tags: ['Referentiels'],
        summary: 'Importer un referentiel depuis un CSV (EF-12-03)',
        description: "Reserve a l'administration nationale : un referentiel vaut pour toute la plateforme, et une regle d'interaction erronee se traduirait en alerte fausse — ou absente — chez chaque prescripteur.\n\n**Format accepte** : separateur `;` ou `,` (deduit de l'en-tete, `;` l'emporte car c'est ce qu'ecrit Excel en francais), guillemets avec echappement par doublement, champs sur plusieurs lignes, fins de ligne CRLF, BOM d'Excel tolere, lignes vides ignorees.\n\n**Toujours simuler d'abord** avec `simulation: true` : tout est valide, rien n'est ecrit. La reponse porte **une ligne par ligne du fichier** avec son verdict — un import qui echoue en silence sur trois lignes est pire que pas d'import. Une ligne refusee porte toujours son motif.\n\nL'import est une **mise a jour** quand la cle existe deja (code LOINC, paire de DCI, code produit), une creation sinon. Les paires de DCI sont normalisees et triees, pour que la detection d'interaction les retrouve dans les deux sens.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['examens', 'interactions', 'medicaments'] } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['contenu'], properties: { contenu: { type: 'string', description: 'Le contenu du fichier CSV, tel quel' }, simulation: { type: 'boolean', default: false, description: 'Valider sans rien ecrire' } } } } } },
        responses: {
          200: { description: 'Rapport d import, ligne par ligne', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: { type: { type: 'string' }, simulation: { type: 'boolean' }, total: { type: 'integer' }, creees: { type: 'integer' }, misesAJour: { type: 'integer' }, refusees: { type: 'integer' }, lignes: { type: 'array', items: { type: 'object', properties: { ligne: { type: 'integer', description: 'Le numero dans le fichier de l operateur : la ligne 1 est l en-tete' }, cle: { type: 'string' }, statut: { type: 'string', enum: ['CREEE', 'MISE_A_JOUR', 'REFUSEE'] }, motif: { type: 'string', nullable: true } } } } } } } }] } } } },
          400: { description: 'Fichier vide, colonne obligatoire absente, ou referentiel inconnu' },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    // ── P4 Bris de glace (EF-02-06) ───────────────────────────────────
    '/api/v1/bris-de-glace': {
      post: {
        tags: ['Bris de glace'],
        summary: 'Declarer un acces en urgence (EF-02-06)',
        description: "Declarer un acces en urgence a un dossier auquel on n'a pas droit (EF-02-06).\n\n**Pourquoi cette porte existe.** Un patient arrive inconscient dans un service qui ne le suit pas. Le soignant a besoin de ses allergies, tout de suite. Un controle d'acces sans porte de secours ferait prescrire a l'aveugle — et la regle serait contournee autrement, par un compte prete, sans laisser la moindre trace. Une porte declaree vaut mieux qu'une porte derobee.\n\n**Pourquoi ce n'est pas un passe-partout :**\n- un **motif** est exige, pris dans une liste fermee *et* explique en toutes lettres. La liste permet de compter, le texte permet de juger ;\n- l'acces **expire au bout de 4 heures**. Sans expiration, le premier bris de glace deviendrait la facon normale d'entrer. La duree est volontairement trop courte pour couvrir une garde : un soignant qui a encore besoin du dossier le lendemain doit redeclarer, et ce second geste se verra ;\n- le **patient est prevenu** dans la foulee ;\n- l'**administration repasse derriere**. Un garde-fou que personne ne relit n'est pas un garde-fou ;\n- la **declaration ne se reecrit pas** : un declencheur PostgreSQL refuse de toucher au motif, au patient, a l'auteur et aux dates.\n\n**Reserve aux roles qui donnent des soins** — medecin, ASC, superviseur d'ASC. Ni l'accueil, ni l'administration, ni le laboratoire : leur ouvrir cette porte ferait de l'exception la regle.\n\n**Si la notification du patient echoue, l'acces est quand meme ouvert** : il y a un patient inconscient au bout. Mais `notifieLe` reste nul, et la revue le signale — un bris de glace dont le patient n'a pas ete prevenu n'est qu'a moitie declare.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idPatient', 'motif', 'explication'], properties: { idPatient: { type: 'string' }, motif: { type: 'string', enum: ['URGENCE_VITALE', 'PATIENT_HORS_ETAT', 'CONTINUITE_DES_SOINS', 'VERIFICATION_AVANT_PRESCRIPTION', 'AUTRE'] }, explication: { type: 'string', minLength: 20, maxLength: 2000, description: 'La situation en une phrase. C est elle qui sera relue, et c est elle qui protege le soignant.' } } } } } },
        responses: {
          201: { description: 'Acces ouvert, patient prevenu', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: { id: { type: 'string' }, motif: { type: 'string', enum: ['URGENCE_VITALE', 'PATIENT_HORS_ETAT', 'CONTINUITE_DES_SOINS', 'VERIFICATION_AVANT_PRESCRIPTION', 'AUTRE'] }, explication: { type: 'string', description: 'Ce que le soignant a explique. Ne se reecrit pas.' }, ouvertLe: { type: 'string', format: 'date-time' }, expireLe: { type: 'string', format: 'date-time' }, refermeLe: { type: 'string', format: 'date-time', nullable: true }, ouvert: { type: 'boolean', description: 'Ni referme, ni expire.' }, statutRevue: { type: 'string', enum: ['A_REVOIR', 'JUSTIFIE', 'INJUSTIFIE'] }, avisRevue: { type: 'string', nullable: true }, revuLe: { type: 'string', format: 'date-time', nullable: true }, revuPar: { type: 'string', nullable: true }, notifieLe: { type: 'string', format: 'date-time', nullable: true, description: 'null : le patient n a pas pu etre prevenu. La declaration tient, le manque se voit.' }, patient: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' } } }, auteur: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' }, role: { type: 'string' } } }, structure: { type: 'string', nullable: true } } } } }] } } } },
          400: { description: 'Explication trop courte, ou son propre dossier' },
          403: { description: 'Reserve aux roles qui donnent des soins : MEDECIN, ASC, ASC_SUPERVISOR' },
          404: { description: 'Dossier patient introuvable' },
        },
      },
      get: {
        tags: ['Bris de glace'],
        summary: 'Les acces en urgence (EF-02-06)',
        description: "Les acces en urgence.\n\n**Un soignant ne voit que les siens** : la liste complete est un outil de controle, pas un annuaire des urgences des autres. L'administration voit tout, parce que c'est elle qui relit.\n\n`aRevoirSeulement=true` ne garde que ceux qui attendent une relecture : c'est la file de travail de l'administration.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'idPatient', in: 'query', schema: { type: 'string' } },
          { name: 'aRevoirSeulement', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'La file de travail de l administration.' },
        ],
        responses: {
          200: { description: 'Acces, le plus recent d abord', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, motif: { type: 'string', enum: ['URGENCE_VITALE', 'PATIENT_HORS_ETAT', 'CONTINUITE_DES_SOINS', 'VERIFICATION_AVANT_PRESCRIPTION', 'AUTRE'] }, explication: { type: 'string', description: 'Ce que le soignant a explique. Ne se reecrit pas.' }, ouvertLe: { type: 'string', format: 'date-time' }, expireLe: { type: 'string', format: 'date-time' }, refermeLe: { type: 'string', format: 'date-time', nullable: true }, ouvert: { type: 'boolean', description: 'Ni referme, ni expire.' }, statutRevue: { type: 'string', enum: ['A_REVOIR', 'JUSTIFIE', 'INJUSTIFIE'] }, avisRevue: { type: 'string', nullable: true }, revuLe: { type: 'string', format: 'date-time', nullable: true }, revuPar: { type: 'string', nullable: true }, notifieLe: { type: 'string', format: 'date-time', nullable: true, description: 'null : le patient n a pas pu etre prevenu. La declaration tient, le manque se voit.' }, patient: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' } } }, auteur: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' }, role: { type: 'string' } } }, structure: { type: 'string', nullable: true } } } } } }] } } } },
          400: { description: 'Critere inconnu' },
        },
      },
    },
    '/api/v1/bris-de-glace/{id}/refermer': {
      post: {
        tags: ['Bris de glace'],
        summary: 'Refermer un acces avant son expiration (EF-02-06)',
        description: "Refermer un acces avant son expiration.\n\nLe geste honnete quand on n'a plus besoin du dossier. **Seul celui qui a brise la vitre la referme** : un tiers qui refermerait l'acces d'un autre le laisserait devant un dossier qu'il consultait peut-etre encore.\n\nUn acces referme ne se rouvre pas — un declencheur PostgreSQL le refuse. Il faut declarer un nouveau bris de glace, et ce second geste se verra.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Acces referme' },
          403: { description: 'Seul celui qui a ouvert l acces peut le refermer' },
          404: { description: 'Acces introuvable' },
          409: { description: 'Acces deja referme' },
        },
      },
    },
    '/api/v1/bris-de-glace/{id}/reviser': {
      post: {
        tags: ['Bris de glace'],
        summary: 'Rendre une revue sur un acces en urgence (EF-02-06)',
        description: "Rendre une revue sur un acces en urgence (EF-02-06).\n\n**Un avis ecrit est exige, meme pour dire que l'acces etait fonde.** Une case cochee sans phrase ne prouve pas que quelqu'un a regarde.\n\n**On ne relit pas son propre acces** : un garde-fou qu'on s'applique a soi-meme n'en est pas un.\n\nUne revue ne se refait pas : juger deux fois le meme acces reviendrait a pouvoir changer d'avis apres coup, ce qui viderait la relecture de son sens. Un `INJUSTIFIE` n'est pas une sanction — c'est un constat ecrit, et les suites se decident ailleurs.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['statut', 'avis'], properties: { statut: { type: 'string', enum: ['JUSTIFIE', 'INJUSTIFIE'] }, avis: { type: 'string', minLength: 20, maxLength: 2000 } } } } } },
        responses: {
          200: { description: 'Revue rendue' },
          400: { description: 'Avis trop court' },
          403: { description: 'Reserve a l administration, et jamais sur son propre acces' },
          404: { description: 'Acces introuvable' },
          409: { description: 'Acces deja relu' },
        },
      },
    },
    // ── P4 Consentement versionne (EF-02-01/03/07) ────────────────────
    '/api/v1/textes-consentement': {
      get: {
        tags: ['Consentement'],
        summary: 'Les versions des textes de consentement (EF-02-01)',
        description: "Les textes de consentement, versions anciennes et brouillons compris (EF-02-01).\n\n**Un consentement ne vaut que pour ce qui a ete explique.** Sans garder le texte exact qui etait a l'ecran, on ne peut ni prouver ce que la personne a accepte, ni le lui remontrer. Le texte evolue ; les accords deja donnes continuent de pointer vers la version qu'ils ont vue.\n\n**On ne modifie jamais un texte publie** : publier, c'est creer une version de plus. Sans cela on reecrirait apres coup ce a quoi les gens ont dit oui.\n\nLisible par tout compte authentifie : un soignant doit pouvoir lire le texte sur lequel repose l'acces qu'on lui accorde.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'scope', in: 'query', schema: { type: 'string', enum: ['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE'] } }],
        responses: {
          200: { description: 'Textes, les plus recents d abord', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, scope: { type: 'string', enum: ['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE'] }, langue: { type: 'string', example: 'fr' }, version: { type: 'integer' }, titre: { type: 'string' }, corps: { type: 'string' }, publieLe: { type: 'string', format: 'date-time', nullable: true, description: 'null : brouillon, montre a personne.' }, dansUneAutreLangue: { type: 'boolean', description: 'Le texte n est pas dans la langue du patient. Le taire ferait passer pour eclaire un consentement qui ne l est pas.' } } } } } }] } } } },
          400: { description: 'Critere inconnu' },
        },
      },
      post: {
        tags: ['Consentement'],
        summary: 'Publier une nouvelle version (EF-02-01)',
        description: "Publier une nouvelle version d'un texte (EF-02-01).\n\n**Reserve a l'administration nationale.** Un texte de consentement vaut pour toute la plateforme : le laisser modifier par chaque structure ferait dire au consentement des choses differentes selon l'hopital.\n\nLa version est calculee, pas donnee : deux administrateurs qui publient en meme temps ne doivent pas se marcher dessus, et l'unicite `(scope, langue, version)` les departage.\n\n**Un texte plus recent ne revoque pas les accords deja donnes.** Revoquer d'office couperait l'acces au dossier de soins de tous les patients le jour ou l'on corrige une faute d'orthographe — et un acces coupe, en soins, ce n'est pas un desagrement. Les patients concernes lisent « le texte a change depuis votre accord » et peuvent renouveler. On demande, on n'impose pas. La limite est assumee : tant qu'ils n'ont pas repondu, c'est l'ancienne version qui fait foi.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['scope', 'langue', 'titre', 'corps'], properties: { scope: { type: 'string', enum: ['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE'] }, langue: { type: 'string', pattern: '^[a-z]{2}$', example: 'fr' }, titre: { type: 'string', minLength: 3, maxLength: 200 }, corps: { type: 'string', minLength: 40, maxLength: 20000, description: 'Le texte presente, tel quel. Quarante caracteres au moins : un texte qui n explique rien ne recueille pas un consentement eclaire.' } } } } } },
        responses: {
          201: { description: 'Version publiee' },
          400: { description: 'Texte trop court, titre trop court, ou langue mal ecrite' },
          403: { description: 'Reserve a ADMIN_NATIONAL et SUPER_ADMIN' },
        },
      },
    },
    '/api/v1/textes-consentement/en-vigueur': {
      get: {
        tags: ['Consentement'],
        summary: 'Le texte qu un patient verrait aujourd hui (EF-02-01)',
        description: "Le texte qu'un patient verrait aujourd'hui, dans la langue demandee.\n\n**La version en vigueur est la plus recemment publiee**, et non la plus grande : un numero de version se saisit, une date de publication s'enregistre. Si les deux divergeaient, c'est la date qui dit ce qui a ete reellement mis a l'ecran.\n\n**La langue fait partie du texte.** Un texte en francais montre a quelqu'un qui lit le pular n'est pas un consentement eclaire. Faute de traduction, le francais est rendu et `dansUneAutreLangue` vaut `true` : le manque se voit au lieu de se cacher.\n\n**404 franc quand rien n'est publie**, plutot qu'un texte vide : tant qu'aucun texte n'existe, il n'y a rien a quoi consentir.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'scope', in: 'query', required: true, schema: { type: 'string', enum: ['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE'] } },
          { name: 'langue', in: 'query', schema: { type: 'string', default: 'fr' } },
        ],
        responses: {
          200: { description: 'Texte en vigueur', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: { id: { type: 'string' }, scope: { type: 'string', enum: ['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE'] }, langue: { type: 'string', example: 'fr' }, version: { type: 'integer' }, titre: { type: 'string' }, corps: { type: 'string' }, publieLe: { type: 'string', format: 'date-time', nullable: true, description: 'null : brouillon, montre a personne.' }, dansUneAutreLangue: { type: 'boolean', description: 'Le texte n est pas dans la langue du patient. Le taire ferait passer pour eclaire un consentement qui ne l est pas.' } } } } }] } } } },
          400: { description: 'Portee absente' },
          404: { description: 'Aucun texte publie pour cette portee, ni dans la langue demandee ni en francais' },
        },
      },
    },
    '/api/v1/privacy/me/consents/historique': {
      get: {
        tags: ['Consentement'],
        summary: 'L histoire de mes consentements (EF-02-07)',
        description: "L'histoire des consentements du patient connecte (EF-02-07).\n\n**C'est elle qui donne un sens au mot « versionne ».** Avant, un retrait ecrasait l'accord : on voyait le refus d'aujourd'hui, jamais l'accord d'hier ni le nombre de changements d'avis.\n\n**En ajout seul.** Deux declencheurs PostgreSQL refusent UPDATE, DELETE et TRUNCATE, comme pour le journal d'audit (EF-12-04) : une table qui se laisse reecrire ne prouve rien le jour ou il faut s'en servir.\n\n`versionTexte` et `langueTexte` disent ce que la personne avait sous les yeux a ce moment-la. `null` signifie qu'aucun texte n'avait ete conserve — accord anterieur au versionnage, ou pose d'office par le systeme.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'scope', in: 'query', schema: { type: 'string', enum: ['DOSSIER_MEDICAL', 'FHIR_EXPORT', 'RAPPELS_SMS', 'RECHERCHE_ANONYMISEE'] } }],
        responses: {
          200: { description: 'Decisions, la plus recente d abord', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, scope: { type: 'string' }, sens: { type: 'string', enum: ['ACCORDE', 'RETIRE'] }, source: { type: 'string', description: 'WEB, MOBILE, COMPTOIR, DEFAUT_SYSTEME...' }, commentaire: { type: 'string', nullable: true }, creeLe: { type: 'string', format: 'date-time' }, versionTexte: { type: 'integer', nullable: true }, langueTexte: { type: 'string', nullable: true }, titreTexte: { type: 'string', nullable: true }, parQui: { type: 'string' } } } } } }] } } } },
          403: { description: 'Reserve au patient' },
        },
      },
    },
    // ── P4 Identito-vigilance et doublons (EF-01-04/05/10) ────────────
    '/api/v1/identites': {
      get: {
        tags: ['Identites'],
        summary: 'Les patients et le niveau de leur identite (EF-01-04/10)',
        description: "Les patients et le niveau de leur identite, pour le comptoir d'accueil.\n\n**Ce que ce niveau conditionne, et ce qu'il ne conditionne pas.** Une identite verifiee ouvre le tiers payant et la delivrance de produits reglementes. Elle ne conditionne **pas les soins** : un patient a l'identite provisoire est consulte, suivi et prescrit normalement. Un agent qui refuserait quelqu'un sans piece commettrait une faute grave.\n\n**Le numero de piece ne revient jamais en entier** : seuls ses quatre derniers caracteres sont lisibles. Il prouve qu'une piece a ete vue ; il n'a pas a etre recopie devant une file d'attente.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 100 }, description: 'Nom, prenom ou telephone.' },
          { name: 'niveau', in: 'query', schema: { type: 'string', enum: ['PROVISOIRE', 'VERIFIEE'] } },
        ],
        responses: {
          200: { description: 'Patients, numero de piece masque', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' }, telephone: { type: 'string' }, dateNaissance: { type: 'string', format: 'date-time' }, lieuNaissance: { type: 'string', nullable: true }, nomMere: { type: 'string', nullable: true }, prefecture: { type: 'string', nullable: true }, niveauIdentite: { type: 'string', enum: ['PROVISOIRE', 'VERIFIEE'] }, typePiece: { type: 'string', nullable: true }, numeroPieceMasque: { type: 'string', nullable: true, description: 'Quatre derniers caracteres seulement.' }, identiteVerifieeLe: { type: 'string', format: 'date-time', nullable: true }, verifiePar: { type: 'string', nullable: true } } } } } }] } } } },
          400: { description: 'Critere inconnu ou hors bornes' },
          403: { description: 'Reserve a AGENT_ACCUEIL et ADMIN_STRUCTURE' },
        },
      },
    },
    '/api/v1/identites/{id}/verifier': {
      post: {
        tags: ['Identites'],
        summary: 'Declarer avoir vu une piece d identite (EF-01-04/10)',
        description: "Enregistrer qu'une piece d'identite a ete vue (EF-01-04/10).\n\n**C'est une declaration d'agent, pas une verification automatique.** L'agent dit avoir vu le document et lequel ; son identifiant et l'horodatage sont enregistres. C'est ce qui rend l'acte contestable plus tard.\n\n`numeroPiece` et `lieuNaissance` sont exiges : la contrainte SQL `patients_identite_verifiee_fondee` les reclame pour une identite verifiee. Une verification qui ne peut pas nommer le document sur lequel elle se fonde n'est ni verifiable ni contestable.\n\n**Pourquoi ce verrou existe.** Dans la region, « Mamadou Diallo, ne en 1990 » peut designer plusieurs personnes dans la meme prefecture. Si l'identite est la mauvaise, c'est l'assureur qui paie pour quelqu'un d'autre, et le vrai titulaire voit son plafond annuel consomme sans le savoir.\n\nReverifier un dossier deja verifie exige `remplacerPiece: true` : une piece se renouvelle, mais remplacer la trace d'une verification anterieure est un geste conscient.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Identifiant du dossier patient.' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['typePiece', 'numeroPiece', 'lieuNaissance'], properties: { typePiece: { type: 'string', enum: ['CARTE_NATIONALE', 'PASSEPORT', 'ACTE_NAISSANCE', 'CARTE_CONSULAIRE', 'PERMIS_CONDUIRE', 'AUTRE'] }, numeroPiece: { type: 'string', minLength: 3, maxLength: 60 }, lieuNaissance: { type: 'string', minLength: 2, maxLength: 120 }, nomMere: { type: 'string', minLength: 2, maxLength: 120, description: 'Facultatif ici, mais c est le trait le plus discriminant pour les doublons.' }, remplacerPiece: { type: 'boolean', description: 'Exige pour reverifier un dossier deja verifie.' } } } } } },
        responses: {
          200: { description: 'Identite verifiee, tiers payant ouvert' },
          400: { description: 'Piece incomplete, ou dossier deja verifie sans remplacerPiece' },
          403: { description: 'Reserve a AGENT_ACCUEIL et ADMIN_STRUCTURE' },
          404: { description: 'Dossier patient introuvable' },
        },
      },
    },
    '/api/v1/identites/{id}/traits': {
      post: {
        tags: ['Identites'],
        summary: 'Noter un trait d etat civil sans verifier (EF-01-04)',
        description: "Noter un trait d'etat civil sans verifier d'identite.\n\nAu telephone ou sur declaration, un agent recueille le lieu de naissance et le nom de la mere sans voir de piece. **Ces traits servent la detection de doublons, qui n'attend pas une verification pour etre utile** — et ils ne font pas passer l'identite en `VERIFIEE`.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { lieuNaissance: { type: 'string', minLength: 2, maxLength: 120 }, nomMere: { type: 'string', minLength: 2, maxLength: 120 } } } } } },
        responses: {
          200: { description: 'Traits enregistres, niveau d identite inchange' },
          400: { description: 'Aucun trait fourni' },
          403: { description: 'Reserve a AGENT_ACCUEIL et ADMIN_STRUCTURE' },
          404: { description: 'Dossier patient introuvable' },
        },
      },
    },
    '/api/v1/identites/{id}/fusionner': {
      post: {
        tags: ['Identites'],
        summary: 'Fusionner un dossier dans un autre (EF-01-06)',
        description: "Fusionner un dossier dans un autre (EF-01-06).\n\n**L'operation la plus dangereuse du produit.** Fusionner deux personnes distinctes melange leurs dossiers medicaux : l'allergie de l'une devient celle de l'autre, et personne ne s'en apercoit avant une prescription. Reserve a `ADMIN_STRUCTURE` — verifier une piece est le geste de celui qui recoit le patient, melanger deux dossiers ne l'est pas.\n\n`{id}` est le dossier **qui survit**. C'est l'agent qui le choisit : lui seul sait lequel des deux porte l'histoire la plus complete.\n\n**Ce qui bouge.** Consultations, vaccinations, rendez-vous et demandes de rendez-vous, factures, episodes de soins, demandes d'analyse, ventes au comptoir, contrats d'assurance, controles d'eligibilite, demandes RGPD — et les consentements, un par un.\n\n**Ce qui ne bouge pas : le journal d'audit.** Un acces au dossier absorbe etait un acces au dossier absorbe. Le reattribuer ferait dire au journal que quelqu'un a ouvert un dossier qu'il n'a jamais ouvert — une falsification, que les declencheurs PostgreSQL d'EF-12-04 refusent de toute facon. Les lectures du journal suivent le lien de fusion au lieu de deplacer les lignes.\n\n**Les consentements : le plus restrictif l'emporte.** La contrainte `@@unique([idPatient, scope])` interdit de garder les deux lignes quand les dossiers ne s'accordent pas sur un usage. Elargir un acces sans que le patient l'ait dit montrerait des donnees qui ne devaient pas l'etre, et cela ne se rattrape pas ; un consentement retire a tort se redonne en une phrase. La reponse rapporte les usages restreints, pour que l'agent puisse redemander au patient.\n\n**Le dossier absorbe n'est jamais supprime.** Il garde son identifiant et son code QR : une personne qui presente son ancienne carte est amenee au dossier survivant. Il sort simplement des listes de travail et des propositions de doublon.\n\n**Pas de chaine de fusion** : un dossier deja fusionne ne peut etre ni principal ni absorbe. Trois doublons se traitent sans chaine — A absorbe B, puis A absorbe C. Un declencheur PostgreSQL le garantit.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Le dossier QUI SURVIT.' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['idAbsorbe', 'motif'], properties: { idAbsorbe: { type: 'string', description: 'Le dossier absorbe. Il est conserve, jamais supprime.' }, motif: { type: 'string', minLength: 10, maxLength: 2000, description: 'Sur quoi vous vous fondez. Exige : un acte de cette portee sans motif n est pas contestable.' } } } } } },
        responses: {
          200: { description: 'Fusion faite, et annulable', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'object', properties: { id: { type: 'string' }, motif: { type: 'string' }, statut: { type: 'string', enum: ['ACTIVE', 'ANNULEE'] }, fusionneLe: { type: 'string', format: 'date-time' }, fusionnePar: { type: 'string' }, motifAnnulation: { type: 'string', nullable: true }, annuleeLe: { type: 'string', format: 'date-time', nullable: true }, annuleePar: { type: 'string', nullable: true }, principal: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' } } }, absorbe: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' } } }, lignes: { type: 'array', description: 'Ce qui a bouge, resume par table. C est ce qui rend la reversibilite credible.', items: { type: 'object', properties: { tableCible: { type: 'string' }, operation: { type: 'string', enum: ['DEPLACEMENT', 'RESTRICTION_CONSENTEMENT'] }, nombre: { type: 'integer' } } } } } } } }] } } } },
          400: { description: 'Meme dossier, ou motif trop court' },
          403: { description: 'Reserve a ADMIN_STRUCTURE' },
          404: { description: "L'un des deux dossiers n'existe pas" },
          409: { description: 'Deja fusionne, ou deux identites verifiees sur deux pieces differentes. Le corps porte `motif` : DOSSIER_INTROUVABLE, MEME_DOSSIER, MOTIF_TROP_COURT, DEJA_FUSIONNE, DEUX_PIECES_DIFFERENTES, FUSION_INTROUVABLE, DEJA_ANNULEE' },
        },
      },
    },
    '/api/v1/identites/fusions/{idFusion}/annuler': {
      post: {
        tags: ['Identites'],
        summary: 'Defaire une fusion (EF-01-06)',
        description: "Defaire une fusion (EF-01-06).\n\n**C'est ce qui rend la fusion acceptable.** On ne remet pas « ce qui devrait etre » : chaque ligne deplacee a ete enregistree, et l'annulation relit cette liste. La reversibilite n'est pas une promesse, c'est une liste.\n\n**Ce qui a ete ajoute au dossier survivant depuis la fusion lui reste** : il ne figure pas dans la liste, donc il ne bouge pas. C'est le comportement voulu — une consultation faite apres la fusion a bien eu lieu sur le dossier survivant.\n\nVerifie par comparaison contre une vraie base : `npx tsx scripts/prouver-fusion-reversible.mts` photographie les deux dossiers, fusionne, annule, et compare.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'idFusion', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['motifAnnulation'], properties: { motifAnnulation: { type: 'string', minLength: 10, maxLength: 2000 } } } } } },
        responses: {
          200: { description: 'Fusion annulee, chaque ligne rendue' },
          400: { description: 'Motif trop court' },
          403: { description: 'Reserve a ADMIN_STRUCTURE' },
          404: { description: 'Fusion introuvable' },
          409: { description: 'Fusion deja annulee' },
        },
      },
    },
    '/api/v1/identites/{id}/fusions': {
      get: {
        tags: ['Identites'],
        summary: 'L historique des fusions d un dossier (EF-01-06)',
        description: "L'historique des fusions d'un dossier, annulations comprises.\n\nLe resume `lignes` dit **combien** de lignes ont bouge et dans quelles tables. C'est cela qui rend la reversibilite credible aux yeux d'un agent : il voit ce qui a ete deplace avant de decider d'annuler.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Fusions, la plus recente d abord', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, motif: { type: 'string' }, statut: { type: 'string', enum: ['ACTIVE', 'ANNULEE'] }, fusionneLe: { type: 'string', format: 'date-time' }, fusionnePar: { type: 'string' }, motifAnnulation: { type: 'string', nullable: true }, annuleeLe: { type: 'string', format: 'date-time', nullable: true }, annuleePar: { type: 'string', nullable: true }, principal: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' } } }, absorbe: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' } } }, lignes: { type: 'array', description: 'Ce qui a bouge, resume par table. C est ce qui rend la reversibilite credible.', items: { type: 'object', properties: { tableCible: { type: 'string' }, operation: { type: 'string', enum: ['DEPLACEMENT', 'RESTRICTION_CONSENTEMENT'] }, nombre: { type: 'integer' } } } } } } } } }] } } } },
          403: { description: 'Reserve a AGENT_ACCUEIL et ADMIN_STRUCTURE' },
        },
      },
    },
    '/api/v1/identites/{id}/doublons': {
      get: {
        tags: ['Identites'],
        summary: 'Les doublons possibles d un dossier (EF-01-05)',
        description: "Les dossiers qui pourraient etre la meme personne (EF-01-05).\n\n**Ce ne sont pas des verdicts, et rien n'est fusionne automatiquement.** Un agent decide. Fusionner deux personnes distinctes melange leurs dossiers medicaux : c'est bien plus dangereux que de laisser un doublon.\n\n**Ce que les donnees reelles ont impose.** Dans la base du 2026-10-04, 9 patients sur 10 portaient le 1er janvier 2000 comme date de naissance : c'est la valeur qu'on saisit quand on l'ignore. Elle ne vaut donc presque rien ici (`DATE_PAR_DEFAUT`, 5 points, contre 25 pour une vraie date partagee), sans quoi ces neuf patients seraient signales comme doublons les uns des autres et l'agent apprendrait a ignorer l'alerte.\n\nCe sont **le nom de la mere** (45) et **le lieu de naissance** (25) qui tranchent, comme dans les registres d'etat civil.\n\n**La regle qui empeche de fusionner deux freres.** Sans concordance de nom, le score est plafonne sous `probable`. Deux freres partagent leur mere, leur ville et le telephone familial ; des jumeaux partagent en plus leur date. Tout concorde sauf le prenom, et le score atteignait 115. Le cas remonte quand meme, en tete et avec ses traits, mais il ne sera jamais annonce comme probable.\n\n**Une variante d'orthographe ne conclut jamais non plus.** « Diallo » et « Dialo » sont reconnus comme le meme nom (`NOM_VARIANTE`), parce que c'est ainsi que naissent la plupart des doublons quand un nom est transcrit a l'oreille. Mais « Mamadou » et « Amadou » tombent dans la meme categorie et peuvent etre deux freres : le plafond s'applique, avec le trait `ORTHOGRAPHE_A_CONFIRMER` pour dire a l'agent que le nom concorde — mal ecrit — et non qu'il ne concorde pas.\n\n**Limites assumees.** Les poids disent un ordre d'importance, ils ne sont pas calibres sur du trafic reel. Et la comparaison entre familles de traits reste arbitraire : un meme nom de mere sans aucun nom commun (45) passe devant une variante d'orthographe avec telephone partage (42), alors que la seconde est plus probablement un doublon. Rien n'en decoule, puisque aucun des deux ne conclut.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Le dossier dont on cherche les doublons. Il est exclu du resultat.' }],
        responses: {
          200: { description: 'Candidats, le plus ressemblant d abord', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/ApiResponse' }, { properties: { data: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, nomComplet: { type: 'string' }, telephone: { type: 'string' }, dateNaissance: { type: 'string', format: 'date-time' }, lieuNaissance: { type: 'string', nullable: true }, nomMere: { type: 'string', nullable: true }, prefecture: { type: 'string', nullable: true }, niveauIdentite: { type: 'string', enum: ['PROVISOIRE', 'VERIFIEE'] }, score: { type: 'integer', description: 'A partir de 60 : doublon probable. De 40 a 59 : a verifier. En deca, le candidat n est pas rendu.' }, probable: { type: 'boolean', description: 'score >= 60. Jamais vrai sans concordance de nom exacte ou partielle.' }, traits: { type: 'array', items: { type: 'string', enum: ['NOM_IDENTIQUE', 'NOM_VARIANTE', 'NOM_PROCHE', 'MERE_IDENTIQUE', 'LIEU_IDENTIQUE', 'DATE_IDENTIQUE', 'DATE_PAR_DEFAUT', 'TELEPHONE_IDENTIQUE', 'SANS_CONCORDANCE_DE_NOM', 'ORTHOGRAPHE_A_CONFIRMER'] }, description: 'Ce qui a produit le score. C est ce que l agent lit pour decider : le score seul ne dit rien.' } } } } } }] } } } },
          403: { description: 'Reserve a AGENT_ACCUEIL et ADMIN_STRUCTURE' },
          404: { description: 'Dossier patient introuvable' },
        },
      },
    },
  },
};

// ─── Montage Swagger UI ───────────────────────────────────
export function setupSwagger(app: Express): void {
  // Le nom de la plateforme vient de la base : on l'injecte a chaque
  // affichage de la documentation plutot qu'au demarrage (il peut changer
  // depuis l'interface sans redemarrage de l'API).
  app.use('/api/docs', swaggerUi.serve, async (req: Request, res: Response, next: NextFunction) => {
    const nom = await getIdentitePlateforme().then((i) => i.nom).catch(() => 'Plateforme');
    const document = {
      ...swaggerDocument,
      info: { ...swaggerDocument.info, title: `${nom} API`, description: `API de la plateforme ${nom} — parcours de soins connecté` },
    };
    swaggerUi.setup(document, {
      customSiteTitle: `${nom} API Docs`,
      customCss: '.swagger-ui .topbar { background-color: #085041; }',
    })(req, res, next);
  });

  logger.debug(
    `Documentation API : http://localhost:${process.env.PORT ?? 3000}/api/docs`
  );
}

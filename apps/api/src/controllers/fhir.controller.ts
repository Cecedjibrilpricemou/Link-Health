import { Response } from 'express';
import { ConsentScope } from '../config/generated/client/client';
import { AuthRequest } from '../middlewares/auth.middleware';
import { assertCanAccessConsultation, assertCanAccessPatient } from '../services/access-control.service';
import * as fhirService from '../services/fhir.service';
import { assertPatientConsent } from '../services/privacy.service';
import { assertHistoriqueSiMedecin } from '../services/acces-dossier.service';

export async function getPatientFhirController(req: AuthRequest, res: Response): Promise<void> {
  await assertCanAccessPatient(req.user!, String(req.params.id));
  // L'export emporte tout l'historique : pour un medecin, il suit l'accord.
  await assertHistoriqueSiMedecin(req.user!, String(req.params.id));
  await assertPatientConsent(String(req.params.id), ConsentScope.FHIR_EXPORT, req.user!.userId);
  const data = await fhirService.getPatientFhir(String(req.params.id));
  res.status(200).json(data);
}

export async function getPatientBundleFhirController(req: AuthRequest, res: Response): Promise<void> {
  await assertCanAccessPatient(req.user!, String(req.params.id));
  await assertHistoriqueSiMedecin(req.user!, String(req.params.id));
  await assertPatientConsent(String(req.params.id), ConsentScope.FHIR_EXPORT, req.user!.userId);
  const data = await fhirService.getPatientBundleFhir(String(req.params.id));
  res.status(200).json(data);
}

export async function getConsultationFhirController(req: AuthRequest, res: Response): Promise<void> {
  await assertCanAccessConsultation(req.user!, String(req.params.id));
  const data = await fhirService.getConsultationFhir(String(req.params.id));
  res.status(200).json(data);
}

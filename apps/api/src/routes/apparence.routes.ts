// src/routes/apparence.routes.ts
// Les couleurs de l'interface, par structure : la lire (tout membre) et la
// changer (le responsable seul ; le titulaire est verifie par le service,
// le role PHARMACIEN couvrant aussi le caissier).
import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import * as apparence from '../services/apparence.service';
import { changerPaletteSchema } from '../validators/api.schemas';

const router = Router();

router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await apparence.apparence(req.user!) });
});

router.put('/', requireRole('ADMIN_STRUCTURE', 'PHARMACIEN', 'ASSUREUR'), validateBody(changerPaletteSchema),
  async (req: AuthRequest, res: Response) => {
    res.json({ success: true, data: await apparence.changerPalette(req.user!, req.body.palette) });
  });

export default router;

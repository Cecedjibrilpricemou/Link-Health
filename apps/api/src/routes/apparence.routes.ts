// src/routes/apparence.routes.ts
// Les couleurs de l'interface, par structure : la lire (tout membre) et la
// changer (le responsable seul ; le titulaire est verifie par le service,
// le role PHARMACIEN couvrant aussi le caissier).
import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { uploadLogoStructure } from '../middlewares/upload.middleware';
import { ValidationError } from '../utils/app-error';
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

// Le logo de la structure : le responsable seul (verifie par le service).
router.post('/logo', requireRole('ADMIN_STRUCTURE', 'PHARMACIEN', 'ASSUREUR'), (req: AuthRequest, res: Response, next: NextFunction) => {
  uploadLogoStructure(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Image trop volumineuse (3 Mo maximum).'
          : err instanceof Error ? err.message : 'Échec du téléversement.';
      next(new ValidationError(message));
      return;
    }
    next();
  });
}, async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new ValidationError('Aucune image reçue.');
  res.json({ success: true, data: await apparence.changerLogo(req.user!, req.file.buffer) });
});

router.delete('/logo', requireRole('ADMIN_STRUCTURE', 'PHARMACIEN', 'ASSUREUR'), async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await apparence.retirerLogo(req.user!) });
});

export default router;

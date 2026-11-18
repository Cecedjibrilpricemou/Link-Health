import { Router } from 'express';
import {
  registerController,
  loginController,
  verifyLoginOtpController,
  logoutController,
  refreshController,
  getMeController,
  changerMotDePasseController,
  updateProfilController,
  forgotPasswordController,
  resetPasswordController,
} from '../controllers/auth.controller';
import { Response } from 'express';
import { authenticate, AuthRequest } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { getMe } from '../services/auth.service';
import * as telephone from '../services/telephone.service';
import {
  changePasswordSchema,
  confirmerChangementTelephoneSchema,
  demanderChangementTelephoneSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyLoginOtpSchema,
} from '../validators/api.schemas';

const router = Router();

router.post('/register', validateBody(registerSchema), registerController);
router.post('/login', validateBody(loginSchema), loginController);
router.post('/verify-otp', validateBody(verifyLoginOtpSchema), verifyLoginOtpController);
router.post('/refresh', validateBody(refreshSchema), refreshController);
router.post('/logout', authenticate, logoutController);
router.get('/me', authenticate, getMeController);
router.put('/change-password', authenticate, validateBody(changePasswordSchema), changerMotDePasseController);
router.put('/profile', authenticate, validateBody(updateProfileSchema), updateProfilController);
// Le numero : mot de passe d'abord, puis code au nouveau numero.
router.post('/telephone/demande', authenticate, validateBody(demanderChangementTelephoneSchema), async (req: AuthRequest, res: Response) => {
  const data = await telephone.demanderChangementTelephone(req.user!.userId, req.body);
  res.status(200).json({ success: true, data, message: `Code envoye au ${data.telephoneMasque}` });
});
router.post('/telephone/confirmer', authenticate, validateBody(confirmerChangementTelephoneSchema), async (req: AuthRequest, res: Response) => {
  await telephone.confirmerChangementTelephone(req.user!.userId, req.user!.sessionId, req.body);
  const data = await getMe(req.user!.userId);
  res.status(200).json({ success: true, data, message: 'Numero de telephone change' });
});
router.post('/forgot-password', validateBody(forgotPasswordSchema), forgotPasswordController);
router.post('/reset-password', validateBody(resetPasswordSchema), resetPasswordController);

export default router;

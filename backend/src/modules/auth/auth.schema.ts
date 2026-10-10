import { z } from 'zod';

// =====================================================================
// Schémas de validation Zod pour le module auth
// Alignés sur docs/contrat-api.yaml sections RegisterRequest, LoginRequest
// =====================================================================

/**
 * Règle mot de passe : min 10 caractères (VH-12 architecture).
 */
const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caractères');

/**
 * POST /v1/auth/register
 * Contrainte contrat : email OU phone est requis (au moins un des deux).
 */
export const RegisterSchema = z
  .object({
    email: z.string().email('Email invalide').optional(),
    phone: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Téléphone au format international requis (ex. +2613xxxxxxxx)',
      )
      .optional(),
    password: passwordSchema,
    firstName: z.string().min(1, 'Prénom requis'),
    lastName: z.string().min(1, 'Nom requis'),
    preferredLang: z.enum(['FR', 'MG']).default('FR'),
  })
  .refine((data) => data.email != null || data.phone != null, {
    message: 'Email ou téléphone requis',
    path: ['email'],
  });

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * POST /v1/auth/login
 * Ambiguïté du contrat : email OU phone est requis. Hypothèse prise :
 * le champ password est toujours requis ; au moins un identifiant (email/phone) doit être fourni.
 */
export const LoginSchema = z
  .object({
    email: z.string().email('Email invalide').optional(),
    phone: z.string().optional(),
    password: z.string().min(1, 'Mot de passe requis'),
  })
  .refine((data) => data.email != null || data.phone != null, {
    message: 'Email ou téléphone requis',
    path: ['email'],
  });

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * POST /v1/auth/refresh
 */
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token requis'),
});

export type RefreshInput = z.infer<typeof RefreshSchema>;

/**
 * POST /v1/auth/logout
 */
export const LogoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type LogoutInput = z.infer<typeof LogoutSchema>;

/**
 * POST /v1/auth/verify/otp
 */
export const VerifyOtpSchema = z.object({
  target: z.string().min(1, 'Cible OTP requise'),
  code: z.string().regex(/^\d{6}$/, 'Code OTP à 6 chiffres requis'),
  purpose: z.enum(['REGISTRATION_VERIFY', 'PASSWORD_RESET']),
});

export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;

/**
 * POST /v1/auth/verify/resend
 */
export const ResendOtpSchema = z.object({
  target: z.string().min(1, 'Cible OTP requise'),
  purpose: z.enum(['REGISTRATION_VERIFY', 'PASSWORD_RESET']),
});

export type ResendOtpInput = z.infer<typeof ResendOtpSchema>;

/**
 * POST /v1/auth/password/reset-request
 */
export const PasswordResetRequestSchema = z.object({
  target: z.string().min(1, 'Email ou téléphone requis'),
});

export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestSchema>;

/**
 * POST /v1/auth/password/reset
 */
export const PasswordResetSchema = z.object({
  target: z.string().min(1, 'Email ou téléphone requis'),
  code: z.string().regex(/^\d{6}$/, 'Code OTP à 6 chiffres requis'),
  newPassword: z.string().min(10, 'Le mot de passe doit contenir au moins 10 caractères'),
});

export type PasswordResetInput = z.infer<typeof PasswordResetSchema>;

/**
 * DELETE /v1/auth/sessions/:sessionId
 */
export const RevokeSessionParamsSchema = z.object({
  sessionId: z.string().uuid('UUID de session invalide'),
});

export type RevokeSessionParams = z.infer<typeof RevokeSessionParamsSchema>;

/**
 * PATCH /v1/auth/me — mise à jour du profil voyageur
 * Tous les champs sont optionnels ; au moins un doit être présent.
 */
export const UpdateMeSchema = z
  .object({
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    preferredLang: z.enum(['FR', 'MG']).optional(),
    mobileMoneyPhone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/, 'Format international requis')
      .optional()
      .or(z.literal('')),
    email: z.string().email('Email invalide').max(200).optional().or(z.literal('')),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/, 'Format international requis')
      .optional()
      .or(z.literal('')),
  })
  .refine(
    (d) =>
      d.firstName !== undefined ||
      d.lastName !== undefined ||
      d.preferredLang !== undefined ||
      d.mobileMoneyPhone !== undefined ||
      d.email !== undefined ||
      d.phone !== undefined,
    { message: 'Au moins un champ est requis' },
  );

export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;

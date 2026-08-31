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
 * Le refresh token courant est transmis en body.
 * Hypothèse : si non fourni, on révoque la session identifiée par le JWT d'accès.
 */
export const LogoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type LogoutInput = z.infer<typeof LogoutSchema>;

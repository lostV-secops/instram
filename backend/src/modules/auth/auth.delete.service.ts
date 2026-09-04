import type { PrismaClient } from '@prisma/client';

// =====================================================================
// Service de suppression / anonymisation de compte voyageur (H-5)
// Contrat : DELETE /v1/me
//
// Règles RGPD appliquées :
//   - Email, téléphone, hash de mot de passe remplacés par des valeurs neutres.
//   - TravelerProfile : nom/prénom génériques, mobileMoneyPhone effacé.
//   - Passenger (passagers liés aux réservations) : données PII effacées.
//   - Toutes les AuthSession révoquées → déconnexion immédiate sur tous appareils.
//   - Notification.toAddress remplacé par l'email anonymisé.
//
// CONSERVÉS intentionnellement (audit financier / obligations légales) :
//   - Booking, Payment, PlatformFee, Commission, AuditLog
//
// Hypothèse résolue :
//   Le champ de relation sur Booking est `buyerUserId` (pas `travelerId` comme
//   indiqué dans l'instruction de référence). Le filtre Prisma utilise `buyerUserId`.
// =====================================================================

export async function requestAccountDeletion(
  userId: string,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const anonymizedEmail = `deleted-${userId}@instram.invalid`;

    // 1. Anonymiser les champs PII du compte User
    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonymizedEmail,
        phone: null,
        passwordHash: 'DELETED',
        deletionRequestedAt: new Date(),
        anonymizedAt: new Date(),
      },
    });

    // 2. Anonymiser TravelerProfile si le profil voyageur existe
    await tx.travelerProfile.updateMany({
      where: { userId },
      data: {
        firstName: 'Utilisateur',
        lastName: 'Supprimé',
        mobileMoneyPhone: null,
      },
    });

    // 3. Anonymiser les Passenger liés aux réservations de cet utilisateur
    //    (relation via Booking.buyerUserId — voir hypothèse résolue ci-dessus)
    await tx.passenger.updateMany({
      where: { booking: { buyerUserId: userId } },
      data: {
        firstName: 'Passager',
        lastName: 'Anonymisé',
        phone: null,
        nationalIdRef: null,
      },
    });

    // 4. Révoquer toutes les AuthSession actives → déconnexion sur tous les appareils
    await tx.authSession.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });

    // 5. Anonymiser le champ toAddress des Notification (contient téléphone ou email)
    await tx.notification.updateMany({
      where: { userId },
      data: { toAddress: anonymizedEmail },
    });

    // CONSERVÉS : Booking, Payment, PlatformFee, Commission, AuditLog (audit financier)
  });
}

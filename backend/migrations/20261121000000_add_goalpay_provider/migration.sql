-- Migration : ajout du provider GoalPay et champs associés sur Payment
-- GoalPay est un agrégateur Mobile Money malgache (MVola + Orange Money + Airtel)
-- Flux : redirect checkout (pas USSD push direct)

-- 1. Ajouter la valeur GOALPAY dans l'enum PaymentProvider
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'GOALPAY';

-- 2. Ajouter goalpayOrderRef (référence unique GoalPay pour le webhook)
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "goalpayOrderRef" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_goalpayOrderRef_key" ON "Payment"("goalpayOrderRef");
CREATE INDEX IF NOT EXISTS "Payment_goalpayOrderRef_idx" ON "Payment"("goalpayOrderRef");

-- 3. Ajouter checkoutUrl (URL de la page de paiement GoalPay)
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "checkoutUrl" TEXT;

import crypto from 'crypto';

// =====================================================================
// Client GoalPay — agrégateur Mobile Money malgache
// API ref : https://goalpay.pro/docs/api/integrations
//
// Flux :
//   1. createOrder()   → reçoit checkout_url + order_reference
//   2. Frontend redirige vers checkout_url (page hébergée GoalPay)
//   3. GoalPay appelle POST /v1/webhooks/goalpay → verifyWebhookSignature()
// =====================================================================

const GOALPAY_API_URL = process.env.GOALPAY_API_URL ?? 'https://api.goalpay.pro';

export interface GoalPayOrderRequest {
  description: string;
  reference: string; // Notre référence interne (ex: booking.reference)
  amount: number;    // Montant en Ariary (entier)
  metadata: Array<{
    label: string;
    unit_price: number;
    quantity: number;
  }>;
}

export interface GoalPayOrderResponse {
  checkoutUrl: string;
  orderReference: string; // Référence GoalPay (à stocker pour le webhook)
  expiresInMinutes: number;
}

export interface GoalPayWebhookPayload {
  event: 'payment.success' | 'payment.failed' | 'payment.canceled' | 'payment.expired';
  data: {
    order_reference: string;
    reference: string;
    amount: number;
    currency: string;
    description: string;
    error?: string;
  };
}

/**
 * Crée une commande de paiement GoalPay.
 * Retourne l'URL de checkout vers laquelle le frontend redirige l'utilisateur.
 */
export async function createGoalPayOrder(
  req: GoalPayOrderRequest,
): Promise<GoalPayOrderResponse> {
  const token = process.env.GOALPAY_API_TOKEN;
  if (!token) {
    throw Object.assign(new Error('GOALPAY_API_TOKEN non configuré'), { code: 'MISCONFIGURATION' });
  }

  const body = {
    description: req.description,
    access: token,
    reference: req.reference,
    amount: req.amount,
    currency: 'Ar',
    metadata: req.metadata,
  };

  const response = await fetch(`${GOALPAY_API_URL}/api/payement/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw Object.assign(
      new Error(`GoalPay API error ${response.status}: ${text}`),
      { code: 'GATEWAY_ERROR' },
    );
  }

  const data = await response.json() as {
    message: string;
    data: { checkout_url: string; expires_in_minutes: number; order_reference: string };
  };

  if (!data?.data?.checkout_url || !data?.data?.order_reference) {
    throw Object.assign(
      new Error('Réponse GoalPay invalide : checkout_url ou order_reference manquant'),
      { code: 'GATEWAY_ERROR' },
    );
  }

  return {
    checkoutUrl: data.data.checkout_url,
    orderReference: data.data.order_reference,
    expiresInMinutes: data.data.expires_in_minutes ?? 10,
  };
}

/**
 * Vérifie la signature HMAC du webhook GoalPay.
 * Schéma GoalPay : HMAC-SHA256(key=secret, data=secret).
 * Retourne true si la signature est valide.
 */
export function verifyGoalPaySignature(signature: string): boolean {
  const secret = process.env.GOALPAY_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(secret, 'utf8')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

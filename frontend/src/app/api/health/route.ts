/**
 * Liveness probe pour le healthcheck Docker.
 * GET /api/health → 200 OK
 */

import { NextResponse } from 'next/server';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', service: 'instram-frontend' });
}

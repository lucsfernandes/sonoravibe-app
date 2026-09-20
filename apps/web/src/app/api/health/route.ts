import { NextResponse } from 'next/server';

/**
 * Health check do frontend.
 *
 * Responde só pelo próprio processo: de propósito NÃO consulta a API. Se ela
 * cair, o frontend ainda deve servir as páginas públicas e a tela de erro —
 * encadear os dois faria uma falha da API derrubar também a interface.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}

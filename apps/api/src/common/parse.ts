import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Valida com Zod e transforma a falha num 400 com o caminho de cada campo.
 *
 * "controls.bpm: deve ser no máximo 220" é acionável na interface;
 * "requisição inválida" obriga o usuário a adivinhar o que errou.
 */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  what: string,
): z.infer<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;

  throw new BadRequestException({
    message: `Requisição de ${what} inválida.`,
    issues: parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

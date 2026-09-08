import { z } from 'zod';
import { normalizeFreeText, normalizeLabel } from './normalize.ts';

export interface ProtocolType {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const PROTOCOL_TYPE_LABEL_MAX = 120;
export const PROTOCOL_TYPE_DESCRIPTION_MAX = 2000;

export const protocolTypeInputSchema = z.object({
  label: z
    .string()
    .transform(normalizeLabel)
    .pipe(
      z
        .string()
        .min(1, 'Protocol type label is required.')
        .max(PROTOCOL_TYPE_LABEL_MAX, `Label must be ${PROTOCOL_TYPE_LABEL_MAX} characters or fewer.`),
    ),
  description: z
    .string()
    .max(PROTOCOL_TYPE_DESCRIPTION_MAX)
    .transform(normalizeFreeText)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type ProtocolTypeInput = z.infer<typeof protocolTypeInputSchema>;

export const protocolTypeUpdateSchema = protocolTypeInputSchema.partial();
export type ProtocolTypeUpdate = z.infer<typeof protocolTypeUpdateSchema>;

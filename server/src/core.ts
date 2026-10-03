import { z } from 'zod';
import type { Flag, Quote, ServiceDraft } from './types.js';

export const serviceDraftInput = z.object({
  tmp_id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000),
  deliverables: z.array(z.string().trim().max(240)).max(40),
  price_usd: z.number().finite(),
  price_currency: z.string().trim().max(10).nullable(),
  deposit_pct: z.number().finite(),
  lead_time_days: z.number().int().positive().nullable()
}).strict();

export type ParsedServiceDraft = z.infer<typeof serviceDraftInput>;

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const multiplier = (value: number): string => `${Number(value.toFixed(1))}×`;

export function computeServiceDrafts(input: unknown[]): { services: ServiceDraft[]; flags: Flag[] } {
  const parsed = z.array(serviceDraftInput).parse(input);
  const positivePrices = parsed.map((item) => Math.round(item.price_usd * 100)).filter((price) => price > 0).sort((a, b) => a - b);
  const middle = Math.floor(positivePrices.length / 2);
  const median = positivePrices.length === 0
    ? 0
    : positivePrices.length % 2 === 0
      ? (positivePrices[middle - 1]! + positivePrices[middle]!) / 2
      : positivePrices[middle]!;
  const flags: Flag[] = [];
  const services = parsed.map((item): ServiceDraft => {
    const priceCents = Math.round(item.price_usd * 100);
    const currency = item.price_currency?.toUpperCase();
    const nonUsdPrice = currency !== undefined && currency !== 'USD';
    if (nonUsdPrice) {
      flags.push({
        tmp_id: item.tmp_id,
        field: 'price_cents',
        severity: 'error',
        message: `Written as ${currency} ${item.price_usd.toLocaleString('en-US')}. Payments are charged in USD, so enter the price in US dollars.`
      });
    }
    if (priceCents <= 0) {
      flags.push({ tmp_id: item.tmp_id, field: 'price_cents', severity: 'error', message: 'Price must be greater than $0.' });
    } else if (!nonUsdPrice && median > 0 && priceCents < median / 3) {
      flags.push({
        tmp_id: item.tmp_id,
        field: 'price_cents',
        severity: 'warning',
        message: `${usd(priceCents)} is ${multiplier(median / priceCents)} below your median — typo?`
      });
    } else if (!nonUsdPrice && median > 0 && priceCents > median * 3) {
      flags.push({
        tmp_id: item.tmp_id,
        field: 'price_cents',
        severity: 'warning',
        message: `${usd(priceCents)} is ${multiplier(priceCents / median)} above your median — typo?`
      });
    }
    if (item.deposit_pct < 20 || item.deposit_pct > 100) {
      flags.push({
        tmp_id: item.tmp_id,
        field: 'deposit_pct',
        severity: 'warning',
        message: 'Deposit should be between 20% and 100%.'
      });
    }
    if (item.deliverables.length === 0 || item.deliverables.every((deliverable) => deliverable.length === 0)) {
      flags.push({ tmp_id: item.tmp_id, field: 'deliverables', severity: 'warning', message: 'Add at least one deliverable.' });
    }
    if (item.lead_time_days === null) {
      flags.push({ tmp_id: item.tmp_id, field: 'lead_time_days', severity: 'warning', message: 'Add an estimated lead time.' });
    }
    return {
      tmp_id: item.tmp_id,
      title: item.title,
      description: item.description,
      deliverables: item.deliverables,
      price_cents: priceCents,
      deposit_pct: item.deposit_pct,
      lead_time_days: item.lead_time_days
    };
  });
  return { services, flags };
}

export function calculateQuoteAmounts(totalCents: number, depositPct: number): {
  total_cents: number;
  deposit_cents: number;
  balance_cents: number;
} {
  const depositCents = Math.round(totalCents * depositPct / 100);
  return { total_cents: totalCents, deposit_cents: depositCents, balance_cents: totalCents - depositCents };
}

export function templateScopeSummary(serviceTitle: string, brief: string): string {
  return `${serviceTitle} includes work tailored to your brief: “${brief.trim()}”. We’ll confirm the details together before work begins.`;
}

export function isCompletedCapture(
  capture: { status?: string; amount?: { currency_code?: string; value?: string }; custom_id?: string } | undefined,
  quoteId: string,
  amountCents: number,
  orderCustomId?: string
): boolean {
  return Boolean(
    capture?.status === 'COMPLETED' &&
    capture.custom_id === quoteId &&
    orderCustomId === quoteId &&
    capture.amount?.currency_code === 'USD' &&
    Math.round(Number(capture.amount.value) * 100) === amountCents
  );
}

export function dueBalance(quote: Quote): number {
  return quote.status === 'paid' ? 0 : quote.balance_cents;
}

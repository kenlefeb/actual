import type { CandidateTransaction } from '#server/charge-matching/match-charges';

export type { CandidateTransaction };

// Amounts are integer cents. Expenses are positive here; the bank
// transaction they belong to is negative.
export type AmazonItem = {
  name: string;
  quantity: number;
  // Unit price
  price: number;
  tax: number;
  shipping: number;
  discount: number;
};

// One card charge, rebuilt from an order's items that shipped together
export type AmazonCharge = {
  id: string;
  orderId: string;
  shipDate: string;
  amount: number;
  items: AmazonItem[];
  giftCardOrPoints: boolean;
  // The export's own shipment total minus the item sum, when it has one
  totalDifference: number;
};

export type AmazonChargeStatus =
  | 'matched'
  | 'ambiguous'
  | 'unmatched'
  | 'gift-card-or-points'
  | 'already-itemized'
  | 'already-split';

export type AmazonChargeReview = {
  charge: AmazonCharge;
  status: AmazonChargeStatus;
  transaction: CandidateTransaction | null;
  candidates: CandidateTransaction[];
};

export type AmazonApplyMatch = {
  charge: AmazonCharge;
  transactionId: string;
};

export type AmazonApplySkipReason =
  | 'missing'
  | 'amount-changed'
  | 'split'
  | 'transfer'
  | 'already-itemized';

export type AmazonApplyResult = {
  applied: string[];
  skipped: Array<{
    chargeId: string;
    transactionId: string;
    reason: AmazonApplySkipReason;
  }>;
};

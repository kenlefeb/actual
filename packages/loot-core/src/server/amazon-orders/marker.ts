// The marker for an order is the #amazon tag together with that order's
// link (design decision 7). The tag alone is something users add by hand.
const TAG = /(^|\s)#amazon(?=\s|$)/i;
const LINK = 'order-details?orderID=';

export function orderLink(orderId: string): string {
  return `https://www.amazon.com/gp/your-account/order-details?orderID=${orderId}`;
}

export function orderMarker(orderId: string): string {
  return `#amazon\n${orderLink(orderId)}`;
}

export function hasAnyOrderMarker(notes: string | null | undefined): boolean {
  return !!notes && TAG.test(notes) && notes.includes(LINK);
}

export function hasOrderMarker(
  notes: string | null | undefined,
  orderId: string,
): boolean {
  if (!notes || !TAG.test(notes)) {
    return false;
  }
  // The id must end where the link ends, so 111-1 doesn't match 111-12
  const link = LINK + orderId;
  let at = notes.indexOf(link);
  while (at !== -1) {
    const next = notes[at + link.length];
    if (next === undefined || !/[\w-]/.test(next)) {
      return true;
    }
    at = notes.indexOf(link, at + 1);
  }
  return false;
}

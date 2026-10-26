import { countryName } from "@/lib/countries";
import {
  formatCents,
  formatOrderNumber,
  type CustomerOrderView,
  type OrderAddress,
} from "@/lib/order-types";

import { renderEmail, type EmailContent } from "./templates.server";

type Shop = { storeName: string; contactEmail: string };

const addressLines = (a: OrderAddress) =>
  [
    a.name,
    a.line1,
    a.line2,
    [a.city, a.region, a.postalCode].filter(Boolean).join(", "),
    countryName(a.country),
    a.phone,
  ].filter(Boolean);

const itemLines = (order: CustomerOrderView) =>
  order.lines.map(
    (line) =>
      `${line.quantity} × ${line.productTitle}${line.variantTitle ? ` (${line.variantTitle})` : ""} — ${formatCents(line.lineTotalCents, order.currency)}`,
  );

const totalLines = (order: CustomerOrderView) => [
  `Items: ${formatCents(order.itemsCents, order.currency)}`,
  `Delivery (${order.shippingMethod}): ${formatCents(order.shippingCents, order.currency)}`,
  ...(order.taxCents > 0 ? [`Tax: ${formatCents(order.taxCents, order.currency)}`] : []),
  `Total: ${formatCents(order.totalCents, order.currency)}`,
];

export function orderConfirmationEmail(
  shop: Shop,
  order: CustomerOrderView,
  orderUrl: string,
): EmailContent {
  const number = formatOrderNumber(order.number);
  return renderEmail({
    ...shop,
    subject: `Your order ${number} is confirmed`,
    heading: `Thank you, ${order.address.name.split(" ")[0] ?? "friend"}!`,
    paragraphs: [
      `We have received your payment and ${number} is confirmed. We will email you again as soon as it is on its way.`,
      "Order summary",
    ],
    details: [
      ...itemLines(order),
      "",
      ...totalLines(order),
      "",
      "Delivering to:",
      ...addressLines(order.address),
    ],
    button: { label: "View your order", url: orderUrl },
    footerNote: "Questions? Just reply to this email.",
  });
}

export function newOrderAlertEmail(
  shop: Shop,
  order: CustomerOrderView,
  adminUrl: string,
  note?: string,
): EmailContent {
  const number = formatOrderNumber(order.number);
  return renderEmail({
    ...shop,
    subject: `New order ${number} — ${formatCents(order.totalCents, order.currency)}`,
    heading: `New order ${number}`,
    paragraphs: [
      `${order.address.name} (${order.email}) has paid ${formatCents(order.totalCents, order.currency)}.`,
      ...(note ? [note] : []),
    ],
    details: [
      ...itemLines(order),
      "",
      ...totalLines(order),
      "",
      "Ship to:",
      ...addressLines(order.address),
    ],
    button: { label: "Open the order", url: adminUrl },
  });
}

export function orderShippedEmail(
  shop: Shop,
  order: CustomerOrderView,
  orderUrl: string,
): EmailContent {
  const number = formatOrderNumber(order.number);
  const tracking = [
    order.trackingCarrier && `Carrier: ${order.trackingCarrier}`,
    order.trackingNumber && `Tracking number: ${order.trackingNumber}`,
  ].filter((line): line is string => Boolean(line));
  return renderEmail({
    ...shop,
    subject: `Your order ${number} is on its way`,
    heading: "Your order has shipped",
    paragraphs: [`Good news — ${number} has left us and is on its way to you.`],
    details: [
      ...tracking,
      ...(tracking.length ? [""] : []),
      "Delivering to:",
      ...addressLines(order.address),
    ],
    button: { label: "View your order", url: orderUrl },
  });
}

export function orderRefundedEmail(
  shop: Shop,
  order: CustomerOrderView,
  orderUrl: string,
): EmailContent {
  const number = formatOrderNumber(order.number);
  return renderEmail({
    ...shop,
    subject: `Your order ${number} has been refunded`,
    heading: "Your refund is on its way",
    paragraphs: [
      `We have refunded ${formatCents(order.totalCents, order.currency)} for order ${number}. It usually appears on your statement within 5–10 business days, depending on your bank.`,
    ],
    button: { label: "View your order", url: orderUrl },
    footerNote: "Questions? Just reply to this email.",
  });
}

// Sent to the shop when something about an order needs a person to look at it.
export function orderAttentionEmail(
  shop: Shop,
  order: CustomerOrderView,
  adminUrl: string,
  problem: string,
): EmailContent {
  const number = formatOrderNumber(order.number);
  return renderEmail({
    ...shop,
    subject: `Needs attention: order ${number}`,
    heading: `Order ${number} needs a look`,
    paragraphs: [problem],
    details: [`${order.address.name} (${order.email})`, ...totalLines(order)],
    button: { label: "Open the order", url: adminUrl },
  });
}

// Plain, reliable HTML emails: one centred card, inline styles, a text version of everything.
// Every dynamic value goes through escapeHtml, so a customer's name or message cannot inject markup.

export type EmailContent = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Layout = {
  storeName: string;
  contactEmail: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  // Optional pre-formatted lines shown in a box, e.g. an order summary.
  details?: string[];
  button?: { label: string; url: string };
  footerNote?: string;
};

const GREEN = "#173a2b";

export function renderEmail(layout: Layout): EmailContent {
  const paragraphs = layout.paragraphs.map(
    (p) =>
      `<p style="margin:0 0 16px;line-height:1.6;font-size:15px;color:#2b2b2b;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
  );
  const details = layout.details?.length
    ? `<div style="margin:8px 0 20px;padding:14px 16px;background:#f6f5ef;border-radius:6px;font-size:14px;line-height:1.7;color:#2b2b2b;">${layout.details
        .map((line) => escapeHtml(line))
        .join("<br>")}</div>`
    : "";
  const button = layout.button
    ? `<p style="margin:8px 0 24px;"><a href="${escapeHtml(layout.button.url)}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:4px;font-size:14px;">${escapeHtml(layout.button.label)}</a></p>`
    : "";
  const footer = `${layout.footerNote ? `${escapeHtml(layout.footerNote)}<br>` : ""}${escapeHtml(layout.storeName)} · ${escapeHtml(layout.contactEmail)}`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f1f0e8;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${GREEN};padding:18px 28px;color:#ffffff;font-family:Georgia,serif;font-size:18px;letter-spacing:0.5px;">${escapeHtml(layout.storeName)}</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-weight:normal;font-size:22px;color:${GREEN};">${escapeHtml(layout.heading)}</h1>
${paragraphs.join("\n")}${details}${button}
</td></tr>
<tr><td style="padding:16px 28px;background:#faf9f4;font-size:12px;line-height:1.6;color:#777777;">${footer}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    layout.heading,
    "",
    ...layout.paragraphs.flatMap((p) => [p, ""]),
    ...(layout.details?.length ? [...layout.details, ""] : []),
    ...(layout.button ? [`${layout.button.label}: ${layout.button.url}`, ""] : []),
    "—",
    layout.footerNote ?? "",
    `${layout.storeName} · ${layout.contactEmail}`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");

  return { subject: layout.subject, text, html };
}

export function contactNotificationEmail(args: {
  storeName: string;
  contactEmail: string;
  topicLabel: string;
  name: string;
  email: string;
  body: string;
}): EmailContent {
  return renderEmail({
    storeName: args.storeName,
    contactEmail: args.contactEmail,
    subject: `New message from ${args.name}: ${args.topicLabel}`,
    heading: "You have a new message",
    paragraphs: [args.body],
    details: [`From: ${args.name} <${args.email}>`, `About: ${args.topicLabel}`],
    footerNote:
      "Reply to this email to answer them directly. You can also manage messages in the admin.",
  });
}

export function newsletterWelcomeEmail(args: {
  storeName: string;
  contactEmail: string;
  siteUrl: string;
  unsubscribeUrl: string;
}): EmailContent {
  return renderEmail({
    storeName: args.storeName,
    contactEmail: args.contactEmail,
    subject: `Welcome to ${args.storeName}`,
    heading: "Every thread tells a story",
    paragraphs: [
      "Thank you for joining us. You will be the first to hear about new collections, styling ideas and the stories behind the threads.",
    ],
    button: { label: "Explore the collection", url: `${args.siteUrl}/shop?category=All` },
    footerNote: `You are receiving this because you signed up on our website. Unsubscribe any time: ${args.unsubscribeUrl}`,
  });
}

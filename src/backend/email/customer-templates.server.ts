import { renderEmail, type EmailContent } from "./templates.server";

type Shop = { storeName: string; contactEmail: string };

export function activationEmail(shop: Shop, name: string, url: string): EmailContent {
  return renderEmail({
    ...shop,
    subject: `Finish creating your ${shop.storeName} account`,
    heading: `Welcome${name ? `, ${name.split(" ")[0]}` : ""}!`,
    paragraphs: [
      "Choose a password to finish creating your account. This link works once and expires in 24 hours.",
      "If you did not ask for an account, you can ignore this email — nothing will be created.",
    ],
    button: { label: "Choose my password", url },
  });
}

export function alreadyRegisteredEmail(
  shop: Shop,
  loginUrl: string,
  resetUrl: string,
): EmailContent {
  return renderEmail({
    ...shop,
    subject: `You already have a ${shop.storeName} account`,
    heading: "You already have an account",
    paragraphs: [
      "Someone (hopefully you) tried to create an account with this email address, but one already exists.",
      "You can log in, or choose a new password if you have forgotten yours.",
    ],
    button: { label: "Log in", url: loginUrl },
    footerNote: `Forgot your password? ${resetUrl}`,
  });
}

export function resetEmail(shop: Shop, url: string): EmailContent {
  return renderEmail({
    ...shop,
    subject: `Reset your ${shop.storeName} password`,
    heading: "Choose a new password",
    paragraphs: [
      "Use the button below to choose a new password. This link works once and expires in an hour.",
      "If you did not ask for this, you can ignore this email — your password has not changed.",
    ],
    button: { label: "Choose a new password", url },
  });
}

export function passwordChangedEmail(shop: Shop, resetUrl: string): EmailContent {
  return renderEmail({
    ...shop,
    subject: "Your password was changed",
    heading: "Your password was changed",
    paragraphs: [
      "The password on your account was just changed, and you were signed out everywhere else.",
      "If this was not you, reset your password straight away and contact us.",
    ],
    button: { label: "Reset my password", url: resetUrl },
  });
}

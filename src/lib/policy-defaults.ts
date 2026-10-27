// Starter text for the policy pages. Until an owner edits a page in the admin, the shop shows this.
// The privacy policy and terms are generic templates, not legal advice: have them reviewed against
// the laws of the country the business is registered in and the countries it sells to.

export const POLICY_SLUGS = ["privacy", "terms", "shipping-policy", "returns-policy"] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

export const isPolicySlug = (slug: string): slug is PolicySlug =>
  (POLICY_SLUGS as readonly string[]).includes(slug);

export type PolicyPageContent = { title: string; body: string };

export const POLICY_DEFAULTS: Record<PolicySlug, PolicyPageContent> = {
  privacy: {
    title: "Privacy Policy",
    body: `## Who we are
The Threads of Africa ("we", "us") sells clothing online through this website. You can reach us at any time using the contact details on our Contact page.

## What we collect
- **Orders:** your name, email address, delivery address, phone number (if you give one) and what you ordered.
- **Your account (optional):** your name, email address and password. Passwords are stored securely and we cannot read them.
- **Messages and newsletter:** what you write to us, and your email address if you subscribe.
- **Technical data:** basic server logs, such as your IP address and browser type, used to keep the site secure and working.

## How we use it
We use your information to take and deliver your orders, send order updates, answer your questions, run your account, and (only if you subscribe) send news about new collections. We do not sell your personal information.

## Payments
Card payments are handled by our payment provider. We never see or store your full card number.

## Cookies and local storage
We use your browser's storage to remember your shopping bag and favourites, and a secure cookie to keep you signed in if you have an account. We do not use advertising cookies.

## Who we share it with
Only the companies we need to run the shop: our payment provider, delivery companies, our email provider and our website host. They may only use your information to provide their service to us.

## How long we keep it
We keep order records for as long as we need them for accounting and legal reasons. You can unsubscribe from marketing emails at any time with the link at the bottom of each one.

## Your rights
Depending on where you live, you may have the right to see, correct or delete the personal information we hold about you, or to object to how we use it. Contact us and we will help.

## Changes to this policy
If we change this policy we will update this page.`,
  },
  terms: {
    title: "Terms & Conditions",
    body: `## About these terms
These terms apply to your use of this website and to every order you place with The Threads of Africa ("we", "us"). By placing an order you agree to them.

## Orders and acceptance
When you place an order we send you a confirmation email. A contract between us is formed when we confirm your order. We may decline or cancel an order, for example if an item is out of stock or a price is clearly wrong, and will refund anything you have paid.

## Prices and payment
Prices are shown in the currency on the product page. Delivery costs and any taxes are shown at checkout before you pay. Payment is taken when you place your order through our secure payment provider.

## Delivery
We deliver to the countries shown at checkout. Delivery times are estimates, not guarantees. See our Shipping & Delivery page for details.

## Returns and refunds
Our Returns & Exchanges page explains how to return an item and how refunds work. Nothing in these terms limits any rights you have under the law where you live.

## Product information
We take care to show our products accurately. Colours can look slightly different on different screens, and handmade or hand-dyed fabrics may vary a little in pattern, colour or texture; this is part of their character.

## Our content
The designs, photographs, text and logos on this website belong to us or our partners. Please do not copy or reuse them without our written permission.

## Our responsibility
We are responsible for the products we sell being as described and of satisfactory quality. We are not responsible for losses that were not reasonably foreseeable, or for delays caused by events outside our control. Nothing in these terms excludes liability that cannot be excluded by law.

## Changes and governing law
We may update these terms from time to time; the version on this page when you place an order is the one that applies. These terms are governed by the laws of the country where The Threads of Africa is registered.

## Contact
Questions about these terms? Use the details on our Contact page.`,
  },
  "shipping-policy": {
    title: "Shipping & Delivery",
    body: `## Shipping costs and countries
The countries we deliver to, the delivery options and what they cost are shown at checkout before you pay.

## Processing and delivery times
Processing times and estimated delivery times depend on the delivery option you choose and where you are. The estimate is shown next to each option at checkout. These are estimates, not guarantees.

## Tracking
When your order ships we email you a confirmation, including a tracking number when the carrier provides one.

## Customs, duties and taxes
Orders delivered outside the country they ship from may be subject to import duties or taxes charged by your country. These are not included in our prices unless stated at checkout, and are your responsibility.

## Problems with a delivery
If your order is late, damaged or missing, contact us as soon as you can and we will help.`,
  },
  "returns-policy": {
    title: "Returns & Exchanges",
    body: `## Our promise
We want you to be happy with your order. If something is not right, get in touch and we will work it out with you.

## Returning an item
Contact us through the Contact page to arrange a return. Items should be unworn, unwashed and in their original condition. Our returns window, who pays for return postage and how long refunds take are being finalised and will be confirmed on this page.

## Exchanges
If you need a different size, contact us and we will exchange it where we have stock.

## Damaged or incorrect items
If your item arrives damaged or is not what you ordered, tell us right away with a photo and we will put it right.

## Refunds
Approved refunds are paid back to the original payment method.`,
  },
};

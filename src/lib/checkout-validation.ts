import { isCountryCode } from "./countries";
import type { CheckoutForm } from "./order-types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\-\s]*$/;

export type CheckoutFieldError = { field: keyof CheckoutForm; message: string };

// Shared by the checkout form (to guide the shopper) and the server (which never trusts it).
export function checkCheckoutForm(form: CheckoutForm): CheckoutFieldError | null {
  const email = form.email.trim();
  if (!EMAIL.test(email) || email.length > 254) {
    return { field: "email", message: "Enter a valid email address — we send your receipt there." };
  }
  if (!form.name.trim() || form.name.trim().length > 100) {
    return { field: "name", message: "Enter the name of the person receiving the parcel." };
  }
  if (form.phone.length > 30 || !PHONE.test(form.phone)) {
    return { field: "phone", message: "Enter a phone number using digits only (a + is fine)." };
  }
  if (!isCountryCode(form.country)) {
    return { field: "country", message: "Choose a country to deliver to." };
  }
  if (!form.line1.trim() || form.line1.trim().length > 120) {
    return { field: "line1", message: "Enter the street address." };
  }
  if (form.line2.length > 120) {
    return { field: "line2", message: "The second address line can be up to 120 characters." };
  }
  if (!form.city.trim() || form.city.trim().length > 80) {
    return { field: "city", message: "Enter the town or city." };
  }
  if (form.region.length > 80) {
    return { field: "region", message: "The state or region can be up to 80 characters." };
  }
  if (form.postalCode.length > 20) {
    return { field: "postalCode", message: "The postal code can be up to 20 characters." };
  }
  return null;
}

// The form as it is stored: trimmed, with the email in the lower case the database requires.
export const normaliseCheckoutForm = (form: CheckoutForm): CheckoutForm => ({
  email: form.email.trim().toLowerCase(),
  name: form.name.trim(),
  phone: form.phone.trim(),
  country: form.country.trim().toUpperCase(),
  line1: form.line1.trim(),
  line2: form.line2.trim(),
  city: form.city.trim(),
  region: form.region.trim(),
  postalCode: form.postalCode.trim(),
});

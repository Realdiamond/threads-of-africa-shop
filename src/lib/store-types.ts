// Shapes shared by the settings, shipping, pages and forms server functions and their screens.

export type StoreSettings = {
  storeName: string;
  contactEmail: string;
  whatsappNumber: string;
  instagramUrl: string;
  tiktokUrl: string;
  facebookUrl: string;
  pinterestUrl: string;
  announcement: string;
  lowStockThreshold: number;
  shippingConfirmedAt: string | null;
};

// What every visitor may see: the owner-only fields are left out.
export type PublicSettings = Omit<StoreSettings, "lowStockThreshold" | "shippingConfirmedAt">;

export type ShippingRateInput = {
  name: string;
  priceCents: number;
  freeOverCents: number | null;
  estimate: string;
};

export type ShippingZoneInput = {
  id?: string | undefined;
  name: string;
  restOfWorld: boolean;
  taxBps: number;
  countries: string[];
  rates: ShippingRateInput[];
};

export type ShippingZoneView = {
  id: string;
  name: string;
  restOfWorld: boolean;
  taxBps: number;
  countries: string[];
  rates: Array<ShippingRateInput & { id: string }>;
};

export type ShippingOption = {
  rateId: string;
  name: string;
  priceCents: number;
  estimate: string;
};

export type SitePageView = {
  slug: string;
  title: string;
  body: string;
  // True while the page still shows the built-in starter text.
  isStarter: boolean;
  reviewedAt: string | null;
  updatedAt: string | null;
  updatedBy: string;
};

export type MessageTopic = "general" | "order" | "wholesale" | "collaboration" | "press";
export const MESSAGE_TOPICS: Array<{ value: MessageTopic; label: string }> = [
  { value: "general", label: "A general question" },
  { value: "order", label: "My order" },
  { value: "wholesale", label: "Wholesale / stocking the brand" },
  { value: "collaboration", label: "A collaboration" },
  { value: "press", label: "Press" },
];

export type MessageRow = {
  id: string;
  topic: MessageTopic;
  name: string;
  email: string;
  body: string;
  status: "new" | "handled";
  createdAt: string;
  handledAt: string | null;
};

export type SubscriberRow = {
  id: string;
  email: string;
  status: "subscribed" | "unsubscribed";
  source: string;
  subscribedAt: string;
  unsubscribedAt: string | null;
};

export const formatTaxRate = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

// Shown if the settings cannot be loaded, so static pages still render.
export const FALLBACK_SETTINGS: PublicSettings = {
  storeName: "The Threads of Africa",
  contactEmail: "info@thethreadsofafrica.com",
  whatsappNumber: "",
  instagramUrl: "",
  tiktokUrl: "",
  facebookUrl: "",
  pinterestUrl: "",
  announcement: "Welcome to The Threads of Africa — Every Thread Tells a Story.",
};

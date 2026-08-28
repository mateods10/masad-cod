export type FormBuilderSettings = {
  mode: "popup" | "embedded";
  offerTemplate: "classic" | "modern" | "vertical";
  offersInsideForm: boolean;
  offersAboveBuyButton: boolean;
  buttonText: string;
  buttonSubtitle: string;
  buttonBackground: string;
  buttonTextColor: string;
  buttonBorderColor: string;
  buttonRadius: number;
  formBackground: string;
  formTextColor: string;
  fieldBackground: string;
  fieldBorderColor: string;
  fieldRadius: number;
  hideLabels: boolean;
  disableAutocomplete: boolean;
  mobileFullscreen: boolean;
  hideClose: boolean;
  stickyButton: boolean;
  stickyPosition: "top" | "bottom";
  stickyDesktop: boolean;
  showReference: boolean;
  showEmail: boolean;
  requiredMessage: string;
  invalidMessage: string;
  soldOutLabel: string;
};

export type SalesToolsSettings = {
  quantityOffers: boolean;
  packages: boolean;
  orderBump: boolean;
  orderBumpLabel: string;
  orderBumpPrice: number;
  prePurchaseUpsell: boolean;
  downsell: boolean;
};

export type IntegrationSettings = {
  googleSheetsEnabled: boolean;
  googleSheetsWebhook: string;
  googlePlacesEnabled: boolean;
  googlePlacesApiKey: string;
};

export const DEFAULT_FORM_BUILDER: FormBuilderSettings = {
  mode: "popup",
  offerTemplate: "classic",
  offersInsideForm: true,
  offersAboveBuyButton: false,
  buttonText: "PAGA AL RECIBIR",
  buttonSubtitle: "",
  buttonBackground: "#0797e3",
  buttonTextColor: "#ffffff",
  buttonBorderColor: "#0797e3",
  buttonRadius: 14,
  formBackground: "#ffffff",
  formTextColor: "#0b2244",
  fieldBackground: "#f5f7fb",
  fieldBorderColor: "#d9e0eb",
  fieldRadius: 14,
  hideLabels: false,
  disableAutocomplete: false,
  mobileFullscreen: false,
  hideClose: false,
  stickyButton: true,
  stickyPosition: "bottom",
  stickyDesktop: false,
  showReference: true,
  showEmail: true,
  requiredMessage: "Este campo es obligatorio.",
  invalidMessage: "Este campo no es válido.",
  soldOutLabel: "Agotado",
};

export const DEFAULT_SALES_TOOLS: SalesToolsSettings = {
  quantityOffers: true,
  packages: true,
  orderBump: true,
  orderBumpLabel: "Preparación prioritaria",
  orderBumpPrice: 2.5,
  prePurchaseUpsell: false,
  downsell: false,
};

export const DEFAULT_INTEGRATIONS: IntegrationSettings = {
  googleSheetsEnabled: false,
  googleSheetsWebhook: "",
  googlePlacesEnabled: false,
  googlePlacesApiKey: "",
};

export function parseSettings<T extends object>(value: string | null | undefined, defaults: T): T {
  try {
    const parsed = JSON.parse(value || "{}") as Partial<T>;
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function safeColor(value: FormDataEntryValue | null, fallback: string) {
  const text = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

export function safeText(value: FormDataEntryValue | null, fallback: string, max = 160) {
  return String(value ?? fallback).trim().slice(0, max) || fallback;
}

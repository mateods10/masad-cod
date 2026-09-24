export type CartLine = {
  variantId: string;
  quantity: number;
  title?: string;
  variantTitle?: string;
  unitPrice?: number;
  properties?: Array<{ name: string; value: string }>;
};

export type RiskZoneLike = {
  province: string;
  city: string;
  sector: string;
};

export function hasEnoughInventory(input: {
  tracked: boolean;
  policy: string;
  available: number | null;
  requested: number;
}): boolean {
  if (!input.tracked || input.policy !== "DENY" || input.available == null) return true;
  return input.available >= input.requested;
}

export function sanitizeLineProperties(value: unknown): Array<{ name: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map((item) => {
      const property = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        name: String(property.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
        value: String(property.value ?? "").trim().replace(/\s+/g, " ").slice(0, 160),
      };
    })
    .filter((property) => property.name && property.value);
}

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeEcuadorPhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && !digits.startsWith("593")) return null;
  if (/^09\d{8}$/.test(digits)) return `+593${digits.slice(1)}`;
  if (/^5939\d{8}$/.test(digits)) return `+${digits}`;
  if (/^9\d{8}$/.test(digits)) return `+593${digits}`;
  return null;
}

export function splitFullName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "Cliente", lastName: "." };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}

export function nextAllowedSendAt(
  activityAt: Date,
  delayHours = 12,
  startHour = 8,
  endHour = 21,
): Date {
  const dueUtc = new Date(activityAt.getTime() + delayHours * 60 * 60 * 1000);
  const ecuadorOffsetMs = -5 * 60 * 60 * 1000;
  const local = new Date(dueUtc.getTime() + ecuadorOffsetMs);
  const localHour = local.getUTCHours();
  const localMinute = local.getUTCMinutes();
  const afterWindow = localHour > endHour || (localHour === endHour && localMinute > 0);

  if (localHour < startHour) {
    local.setUTCHours(startHour, 0, 0, 0);
  } else if (afterWindow) {
    local.setUTCDate(local.getUTCDate() + 1);
    local.setUTCHours(startHour, 0, 0, 0);
  }

  return new Date(local.getTime() - ecuadorOffsetMs);
}

export function isInsideSendWindow(now: Date, startHour = 8, endHour = 21): boolean {
  const ecuadorOffsetMs = -5 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + ecuadorOffsetMs);
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  return hour >= startHour && (hour < endHour || (hour === endHour && minute === 0));
}

function significantTokens(value: string): string[] {
  const ignored = new Set(["SECTOR", "BARRIO", "COOP", "COOPERATIVA", "DE", "DEL", "LA", "EL", "LOS", "LAS"]);
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !ignored.has(token));
}

export function findRiskZoneMatch(
  zones: RiskZoneLike[],
  input: { province?: string; city?: string; sector?: string; address?: string; reference?: string },
): { type: "CONFIRMED" | "POTENTIAL" | "NONE"; zone?: RiskZoneLike } {
  const province = normalizeText(input.province);
  const city = normalizeText(input.city);
  const explicitSector = normalizeText(input.sector);
  const searchable = normalizeText(`${input.sector ?? ""} ${input.address ?? ""} ${input.reference ?? ""}`);
  let potential: RiskZoneLike | undefined;

  for (const zone of zones) {
    if (normalizeText(zone.province) !== province || normalizeText(zone.city) !== city) continue;
    const normalizedSector = normalizeText(zone.sector);
    if (explicitSector && explicitSector === normalizedSector) return { type: "CONFIRMED", zone };
    if (normalizedSector.length >= 5 && searchable.includes(normalizedSector)) {
      return { type: "CONFIRMED", zone };
    }
    const tokens = significantTokens(zone.sector);
    const matches = tokens.filter((token) => searchable.includes(token));
    if ((tokens.length === 1 && matches.length === 1) || matches.length >= 2) potential ??= zone;
  }

  return potential ? { type: "POTENTIAL", zone: potential } : { type: "NONE" };
}

export function evaluateRisk(input: {
  lines: CartLine[];
  subtotal: number;
  maxQuantity: number;
  maxOrderValue: number;
  zoneMatch: "CONFIRMED" | "POTENTIAL" | "NONE";
}) {
  let score = 0;
  const reasons: string[] = [];
  const largestQuantity = Math.max(0, ...input.lines.map((line) => line.quantity));

  if (largestQuantity > input.maxQuantity) {
    score += 25;
    reasons.push(`Cantidad superior a ${input.maxQuantity} unidades del mismo producto`);
  }
  if (input.subtotal > input.maxOrderValue) {
    score += 25;
    reasons.push(`Valor superior a $${input.maxOrderValue.toFixed(2)}`);
  }
  if (input.zoneMatch === "CONFIRMED") {
    score += 50;
    reasons.push("Dirección coincidente con una zona de alto riesgo");
  } else if (input.zoneMatch === "POTENTIAL") {
    score += 15;
    reasons.push("Dirección posiblemente relacionada con una zona de alto riesgo");
  }

  return {
    score,
    reasons,
    level: score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW",
  } as const;
}

export const ECUADOR_PROVINCE_CODES: Record<string, string> = {
  AZUAY: "A",
  BOLIVAR: "B",
  CANAR: "F",
  CARCHI: "C",
  CHIMBORAZO: "H",
  COTOPAXI: "X",
  "EL ORO": "O",
  ESMERALDAS: "E",
  GALAPAGOS: "W",
  GUAYAS: "G",
  IMBABURA: "I",
  LOJA: "L",
  "LOS RIOS": "R",
  MANABI: "M",
  "MORONA SANTIAGO": "S",
  NAPO: "N",
  ORELLANA: "D",
  PASTAZA: "Y",
  PICHINCHA: "P",
  "SANTA ELENA": "SE",
  "SANTO DOMINGO DE LOS TSACHILAS": "SD",
  SUCUMBIOS: "U",
  TUNGURAHUA: "T",
  "ZAMORA CHINCHIPE": "Z",
};

export function provinceCode(province: string): string | undefined {
  return ECUADOR_PROVINCE_CODES[normalizeText(province)];
}

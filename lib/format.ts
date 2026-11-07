import type { Channel, Minutes, Skill } from "./types";

/** 1110 -> "6:30pm" */
export function formatTime(minutes: Minutes): string {
  const total = Math.round(minutes);
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${hour24 < 12 ? "am" : "pm"}`;
}

/** 18 -> "6pm" */
export function formatHour(hour: number): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${hour < 12 ? "am" : "pm"}`;
}

export function formatMoney(amount: number, decimals = 0): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const CHANNEL_NAMES: Record<Channel, string> = {
  doordash: "DoorDash",
  appB: "App B",
  direct: "Phone & walk-in",
};

export const SKILL_NAMES: Record<Skill, string> = {
  wok: "Wok",
  fryer: "Fryer",
  packing: "Packing",
  register: "Register",
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "o12" -> "#12", "r3" -> "#R3". Short enough to read across a kitchen. */
export function orderLabel(orderId: string): string {
  return orderId.startsWith("o") ? `#${orderId.slice(1)}` : `#${orderId.toUpperCase()}`;
}

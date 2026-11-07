// The shared contract. This is the only file all three tracks touch:
// keep changes small and tell the others when you change it.

/** Minutes since midnight on the demo day. 18:30 = 1110. Used for every time. */
export type Minutes = number;

export type Channel = "doordash" | "appB" | "direct";
export type Skill = "wok" | "fryer" | "packing" | "register";

// ---------- Restaurant data ----------

export interface RecipeLine {
  ingredientId: string;
  qty: number;
  unit: string;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  prepMinutes: number;
  station: Skill;
  recipe: RecipeLine[];
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  onHand: number;
  parLevel: number;
  packSize: number;
  supplierId: string;
  lastUnitPrice: number;
}

export interface OrderLine {
  menuItemId: string;
  qty: number;
}

export type OrderStatus = "queued" | "cooking" | "ready" | "pickedUp";

export interface Order {
  id: string;
  channel: Channel;
  placedAt: Minutes;
  items: OrderLine[];
  targetReadyAt: Minutes;
  /** Delivery orders only. When present, this is the ready time the queue uses. */
  driverEtaAt?: Minutes;
  status: OrderStatus;
}

export interface Shift {
  start: Minutes;
  end: Minutes;
}

export interface StaffMember {
  id: string;
  name: string;
  skills: Skill[];
  hourlyRate: number;
  /** Shifts on the demo day. Empty means off today. */
  availability: Shift[];
}

/** One past order. weekday: 0 = Sunday ... 6 = Saturday. */
export interface HistoricalOrder {
  date: string;
  weekday: number;
  hour: number;
  channel: Channel;
  items: OrderLine[];
  /** Conditions that day, so learnings can compare e.g. home-game Saturdays. */
  tags: DayTag[];
}

export type DayTag = "rain" | "homeGame";

// ---------- Forecast ----------

export interface ForecastModifier {
  tag: DayTag;
  label: string;
  /** Multiplies orders for fromHour <= hour < toHour. */
  multiplier: number;
  fromHour: number;
  toHour: number;
  /** Optional shift toward delivery channels, e.g. rain. Added to delivery share. */
  deliveryShareBoost?: number;
}

export interface ForecastHour {
  hour: number;
  orders: number;
  low: number;
  high: number;
  byItem: Record<string, number>;
  byChannel: Record<Channel, number>;
}

export interface Forecast {
  date: string;
  hourly: ForecastHour[];
  modifiers: string[];
  /** Set by reforecast(). 1.35 means remaining hours were scaled up by 35%. */
  scaledBy?: number;
}

export interface ActualHour {
  hour: number;
  orders: number;
}

// ---------- Morning outputs ----------

export interface PrepTask {
  ingredientId: string;
  label: string;
  qty: number;
  unit: string;
  dueBy: Minutes;
}

export interface SupplierOrderLine {
  ingredientId: string;
  supplierId: string;
  qty: number;
  packs: number;
  estimatedCost: number;
}

export interface RunOut {
  ingredientId: string;
  ingredientName: string;
  /** Null means it lasts through close. */
  runsOutAt: Minutes | null;
}

export interface StaffingHour {
  hour: number;
  required: Record<Skill, number>;
  scheduled: Record<Skill, number>;
  gaps: Skill[];
}

export interface SinglePointOfFailure {
  skill: Skill;
  onlyStaffId: string | null;
  message: string;
}

export interface StaffingPlan {
  hours: StaffingHour[];
  risks: SinglePointOfFailure[];
}

// ---------- Service ----------

export type QueueLabel = "FIRE NOW" | "UP NEXT" | "HOLD";

export interface QueueEntry {
  orderId: string;
  order: Order;
  /** Driver ETA if there is one, otherwise targetReadyAt. */
  readyAt: Minutes;
  /** readyAt - longest item prep time - PACKING_BUFFER_MINUTES */
  startAt: Minutes;
  label: QueueLabel;
}

export type Trigger =
  | { type: "rush"; atMinute: Minutes }
  | { type: "driverDelay"; atMinute: Minutes; orderId: string; delayMinutes: number }
  | { type: "payoutGap" }
  | { type: "invoice"; sample: InvoiceSample };

export type InvoiceSample = "clean" | "priceSpike" | "badScan";

/** Everything a tab needs to work out the same state. Stored in localStorage. */
export interface SimControl {
  /** Real clock time (ms) when the clock last started. Null while stopped. */
  startedAtMs: number | null;
  /** Simulated time at startedAtMs, or the frozen time while paused. */
  startMinute: Minutes;
  /** Simulated minutes per real second. */
  speed: number;
  paused: boolean;
  triggers: Trigger[];
}

export type AlertKind = "runOut" | "pauseItem" | "understaffed" | "reforecast" | "driverDelay";

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: "info" | "warning" | "urgent";
  /** Plain English, built by code. Every number comes from deterministic logic. */
  message: string;
  /** The computed facts behind the message. This is what the LLM may explain. */
  facts: Record<string, string | number>;
  /** "Why is this flagged?" Starts templated, optionally replaced by the LLM. */
  reason?: string;
}

export interface SimState {
  now: Minutes;
  /** Orders placed so far, with driver delays applied. */
  orders: Order[];
  queue: QueueEntry[];
  forecast: Forecast;
  actuals: ActualHour[];
  alerts: Alert[];
  /** True once the clock has passed closing time. */
  serviceOver: boolean;
}

// ---------- Close ----------

export interface InvoiceLine {
  ingredientId?: string;
  rawName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Invoice {
  id: string;
  vendor: string;
  date: string;
  lines: InvoiceLine[];
  total: number;
  confidence: number;
  flags: string[];
}

export interface PriceChange {
  ingredientId: string;
  ingredientName: string;
  oldPrice: number;
  newPrice: number;
  percentChange: number;
  /** Margin impact per dish, in dollars. */
  affectedDishes: { menuItemId: string; name: string; marginChangePerDish: number }[];
}

export interface Payout {
  channel: Channel;
  date: string;
  grossSales: number;
  fees: number;
  expectedNet: number;
  actualNet: number;
}

export interface PayoutGap {
  channel: Channel;
  expectedNet: number;
  actualNet: number;
  gap: number;
  /** The specific orders that don't match. */
  mismatchedOrderIds: string[];
}

/** A pattern code found in history. The LLM may cite it but never computes it. */
export interface Learning {
  id: string;
  text: string;
  facts: Record<string, string | number>;
}

/** The only JSON the recap LLM receives. */
export interface DaySummary {
  date: string;
  forecastOrders: number;
  actualOrders: number;
  revenueByChannel: Record<Channel, number>;
  feesByChannel: Record<Channel, number>;
  foodCostPercent: number;
  laborPercent: number;
  bestItems: { menuItemId: string; name: string; sold: number; revenue: number }[];
  worstItems: { menuItemId: string; name: string; sold: number; revenue: number }[];
  priceChanges: PriceChange[];
  payoutGaps: PayoutGap[];
  stockouts: RunOut[];
  learnings: Learning[];
}

export interface Recap {
  text: string;
  recommendations: string[];
  /** Where the text came from. Shown in /demo so the team knows what ran. */
  source: "live" | "cache" | "fallback";
}

// ---------- The whole dataset ----------

export interface RestaurantData {
  date: string;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  openHour: number;
  closeHour: number;
  menu: MenuItem[];
  ingredients: Ingredient[];
  staff: StaffMember[];
  history: HistoricalOrder[];
  modifiers: ForecastModifier[];
  /** Quantity already prepped this morning, by ingredient id. */
  prepped: Record<string, number>;
  /** The Saturday replay. */
  orders: Order[];
  /** Extra orders that only count after the rush trigger fires. */
  rushOrders: Order[];
  payouts: Payout[];
  /** Payout figures used instead of payouts once the payoutGap trigger fires. */
  payoutsWithGap: Payout[];
  /** Orders the payout report leaves out once the payoutGap trigger fires. */
  payoutGapOrderIds: string[];
  /** Earlier invoices, used to compare unit prices. */
  invoices: Invoice[];
}

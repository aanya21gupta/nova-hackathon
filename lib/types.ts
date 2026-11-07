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
  /** The time the re-forecast was made. */
  reforecastAt?: Minutes;
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
  /** runsOutAt to the nearest 5 minutes, e.g. "7:40pm". This is what screens show. */
  runsOutLabel: string | null;
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

/** The agent's tools. Every change Spine can make to the day goes through one of these. */
export type ToolCall =
  /** Stop selling an item on these channels, from now or a later time. */
  | { tool: "pauseItem"; itemId: string; channels: Channel[]; fromMinute?: Minutes }
  | { tool: "resumeItem"; itemId: string; channels: Channel[] }
  /** Add prep time to new orders until a set time. */
  | { tool: "setBusyMode"; channel: Channel | "all"; extraMinutes: number; untilTime: Minutes }
  /** Ask an off-shift staff member to come in. They stay until close. */
  | { tool: "requestStaff"; staffId: string; startTime: Minutes; station: Skill; reason: string }
  | { tool: "draftSupplierOrder"; supplierId: string; lines: { ingredientId: string; qty: number }[] }
  | { tool: "holdOrder"; orderId: string }
  | { tool: "fireOrder"; orderId: string }
  | { tool: "markOrderReady"; orderId: string }
  /** Beyond the prompt's list: a payout gap and a price spike need these. */
  | { tool: "disputePayout"; channel: Channel; orderIds: string[] }
  | { tool: "requestQuote"; supplierId: string; ingredientId: string };

export type ActionSource = "agent" | "owner" | "voice";

/** A tool call that has been approved and has changed the day. Stored, so it's in every tab. */
export interface AppliedAction {
  id: string;
  call: ToolCall;
  /** Time on the restaurant clock when it was approved. */
  atMinute: Minutes;
  by: ActionSource;
  /** Plain English, e.g. "Paused Pad Thai on DoorDash and App B from 7:40pm". */
  result: string;
  /** e.g. "Pad Thai noodles run-out: 8:15pm → no run-out today". */
  beforeAfter?: string;
  /** Clearly labeled calls to outside systems. All are simulated. */
  mockCalls: string[];
  /** Voice only: what was said, and whether the AI chose the tool rather than the keyword rules. */
  transcript?: string;
  viaAI?: boolean;
  /** Supplier orders only: when the stock can be used. Null means it arrives after today. */
  stockArrivesAt?: Minutes | null;
}

/** One step of the agent's plan, before approval. */
export interface PlannedAction {
  id: string;
  call: ToolCall;
  /** One line. May only cite numbers from the state the agent was given. */
  reason: string;
}

export type Trigger =
  | { type: "rush"; atMinute: Minutes }
  | { type: "driverDelay"; atMinute: Minutes; orderId: string; delayMinutes: number }
  | { type: "payoutGap" }
  /** An invoice that has been scanned and checked. Flagged ones don't change prices. */
  | { type: "invoice"; invoice: Invoice }
  /** Demo only: the next agent plan includes a bad suggestion, to show it being rejected. */
  | { type: "badSuggestion" };

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
  /** Things that happen to the restaurant: a rush, a late driver, an invoice. */
  triggers: Trigger[];
  /** Things approved in response. The same day replayed without these is "without Spine". */
  actions: AppliedAction[];
  /** Planned actions the owner skipped. */
  skipped: string[];
}

export type AlertKind = "runOut" | "understaffed" | "reforecast" | "driverDelay" | "cancelled";

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
  /** Orders the kitchen makes, with driver delays, busy mode and swaps applied. */
  orders: Order[];
  /** Every order customers tried to place, as they placed it. This is demand. */
  placed: Order[];
  /** Orders an app sold after the item had run out, so they were cancelled and refunded. */
  cancelledOrders: Order[];
  /** Value of the dishes customers couldn't get, including refunds. */
  lostSales: number;
  /** What actually ran out, and when. */
  stockouts: RunOut[];
  /** Approved actions in effect at this moment. */
  actions: AppliedAction[];
  /** Items paused or scheduled to pause, by channel. */
  pausedItems: { itemId: string; channels: Channel[]; fromMinute: Minutes }[];
  queue: QueueEntry[];
  /** The plan made this morning. Never changes during the day. */
  baseForecast: Forecast;
  /** The current plan: baseForecast, re-forecast if orders have drifted. */
  forecast: Forecast;
  actuals: ActualHour[];
  alerts: Alert[];
  /** Orders cooking right now. */
  cookingCount: number;
  /** Orders moved by a driver delay, keyed by order id, in minutes. */
  delayedOrders: Record<string, number>;
  /** Invoices scanned today, flagged or not. */
  invoices: Invoice[];
  payoutGapActive: boolean;
  /** The data with any extra stock added. Use this, not raw data, for stock maths. */
  effectiveData: RestaurantData;
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
  /** How this reading was produced. */
  source?: "live" | "cache" | "fallback";
}

export interface PriceChange {
  ingredientId: string;
  ingredientName: string;
  oldPrice: number;
  newPrice: number;
  percentChange: number;
  /** Margin impact per dish, in dollars. Negative means Mai keeps less. */
  affectedDishes: { menuItemId: string; name: string; marginChangePerDish: number; soldToday: number }[];
  /** Total margin impact on today's sales, in dollars. */
  marginChangeToday: number;
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
  /** Orders that couldn't be made at all. */
  lostOrders: number;
  /** Of those, the ones an app sold and then had to cancel and refund. */
  cancelledOrders: number;
  /** Value of the dishes customers couldn't get, including refunds. */
  lostSales: number;
  /** actualOrders - forecastOrders, so a recap can say "6 more than planned". */
  orderDifference: number;
  totalRevenue: number;
  revenueByChannel: Record<Channel, number>;
  feesByChannel: Record<Channel, number>;
  payouts: Payout[];
  foodCost: number;
  foodCostPercent: number;
  laborCost: number;
  laborPercent: number;
  /** The first re-forecast of the day: 35 means 35% above plan, -25 means 25% below. Null if none. */
  reforecastPercent: number | null;
  reforecastAtLabel: string | null;
  driverDelays: number;
  /** What was approved today, in plain English. */
  actionsTaken: string[];
  /** The same day replayed without Spine. Added after close. */
  spine?: {
    saved: number;
    /** True if nothing was approved, so this describes Spine's suggested plan. */
    usedSuggestedPlan: boolean;
    lostSalesWithout: number;
    lostSalesWith: number;
    foodWaitWithout: number;
    foodWaitWith: number;
    lateOrdersWithout: number;
    lateOrdersWith: number;
  };
  /** Invoices flagged for Mai to check, and not used for prices. */
  flaggedInvoices: { vendor: string; flags: string[] }[];
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
  /** Synthetic payout reports. Fee rates per channel come from fees / grossSales. */
  payouts: Payout[];
  /** Orders the payout report leaves out once the payoutGap trigger fires. */
  payoutGapOrderIds: string[];
  /** Earlier invoices, used to compare unit prices. */
  invoices: Invoice[];
}

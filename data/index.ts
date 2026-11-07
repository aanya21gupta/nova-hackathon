// Everyone reads restaurant data from here, so swapping the fake data for a real
// dataset is a one-line change. The dataset must match RestaurantData in lib/types.ts.
import { fakeData } from "./fake";
import type { RestaurantData } from "@/lib/types";

export function getData(): RestaurantData {
  return fakeData;
}

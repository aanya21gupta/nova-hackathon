// Everyone reads restaurant data from here, so swapping fixtures for the real seed
// is a one-line change for Track A at the checkpoint.
import { fixtureData } from "./fixtures";
import type { RestaurantData } from "@/lib/types";

export function getData(): RestaurantData {
  return fixtureData;
}

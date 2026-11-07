// Everyone reads restaurant data from here. The restaurant profile is the single place to
// swap in another restaurant: it must match RestaurantData in lib/types.ts.
import { restaurantProfile } from "./restaurant-profile";
import type { RestaurantData } from "@/lib/types";

export function getData(): RestaurantData {
  return restaurantProfile;
}

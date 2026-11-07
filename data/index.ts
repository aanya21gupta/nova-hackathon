// Everyone reads restaurant data from here, so swapping fixtures for the real seed
// is a one-line change for Track A at the checkpoint.
import { restaurantProfile } from "./restaurant-profile";
import type { RestaurantData } from "@/lib/types";

export function getData(): RestaurantData {
  return restaurantProfile;
}

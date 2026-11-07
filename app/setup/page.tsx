import { getData } from "@/data";
import SetupClient from "./setup-client";

export default function SetupPage() {
  const profile = getData();

  return <SetupClient restaurantName={profile.name} menu={profile.menu.map(({ id, name }) => ({ id, name }))} />;
}

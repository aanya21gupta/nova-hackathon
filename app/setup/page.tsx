import { getData } from "@/data";
import SetupClient from "./setup-client";

export default function SetupPage() {
  const profile = getData();

  return (
    <div className="px-4 py-6">
      <SetupClient restaurantName={profile.name} menu={profile.menu.map(({ id, name }) => ({ id, name }))} />
    </div>
  );
}

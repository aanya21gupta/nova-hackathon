// See CLAUDE.md 4.4. One person covers one station per hour.
import { SKILL_NAMES } from "./format";
import type { Forecast, RestaurantData, SinglePointOfFailure, Skill, StaffMember, StaffingHour, StaffingPlan } from "./types";

/** Orders one person can handle at a station per hour. */
export const ORDERS_PER_LABOR_HOUR: Record<Skill, number> = {
  wok: 60,
  fryer: 60,
  packing: 25,
  register: 60,
};

const SKILLS: Skill[] = ["wok", "fryer", "packing", "register"];

function onShift(member: StaffMember, hour: number): boolean {
  return member.availability.some((s) => s.start <= hour * 60 && s.end >= (hour + 1) * 60);
}

/** Fills the hardest-to-cover stations first, using the least flexible people first. */
function assign(staff: StaffMember[], required: Record<Skill, number>): Record<Skill, number> {
  const scheduled: Record<Skill, number> = { wok: 0, fryer: 0, packing: 0, register: 0 };
  const free = new Set(staff);
  const scarcest = [...SKILLS].sort(
    (a, b) => staff.filter((s) => s.skills.includes(a)).length - staff.filter((s) => s.skills.includes(b)).length,
  );

  for (const skill of scarcest) {
    while (scheduled[skill] < required[skill]) {
      const person = [...free]
        .filter((s) => s.skills.includes(skill))
        .sort((a, b) => a.skills.length - b.skills.length)[0];
      if (!person) break;
      free.delete(person);
      scheduled[skill] += 1;
    }
  }

  // Anyone left over helps where orders pile up first: packing, if they can.
  for (const person of free) {
    const skill = person.skills.includes("packing") ? "packing" : person.skills[0];
    if (skill) scheduled[skill] += 1;
  }
  return scheduled;
}

export function buildStaffingPlan(forecast: Forecast, data: RestaurantData): StaffingPlan {
  const hours: StaffingHour[] = forecast.hourly.map((h) => {
    const required = Object.fromEntries(
      SKILLS.map((skill) => [skill, Math.max(Math.ceil(h.orders / ORDERS_PER_LABOR_HOUR[skill]), 1)]),
    ) as Record<Skill, number>;
    const scheduled = assign(data.staff.filter((s) => onShift(s, h.hour)), required);
    return { hour: h.hour, required, scheduled, gaps: SKILLS.filter((skill) => scheduled[skill] < required[skill]) };
  });

  const risks: SinglePointOfFailure[] = [];
  for (const skill of SKILLS) {
    const qualified = data.staff.filter((s) => s.skills.includes(skill));
    const station = SKILL_NAMES[skill].toLowerCase();
    if (qualified.length === 0) {
      risks.push({ skill, onlyStaffId: null, message: `Nobody on the team can run the ${station}.` });
    } else if (qualified.length === 1) {
      const person = qualified[0];
      const offToday = person.availability.length === 0;
      risks.push({
        skill,
        onlyStaffId: person.id,
        message: offToday
          ? `Only ${person.name} can run the ${station}, and ${person.name} is off today.`
          : `Only ${person.name} can run the ${station}. There's no backup if ${person.name} is out.`,
      });
    }
  }

  return { hours, risks };
}

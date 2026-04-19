export const VET_CLINIC = {
  name: "ビンゴ動物病院",
  siteUrl: "https://www.bingo-ah.com/",
} as const;

export const VET_CALENDAR_TZ = "Asia/Tokyo";

export const VET_CALENDAR_IDS = [
  "rqg42c2pcd1l6tbtlshq69p9a8@group.calendar.google.com",
  "obpe42kp5ap96j0sctvfv2qd6k@group.calendar.google.com",
  "eehbi6dp9lsoidpi240d5uuogc@group.calendar.google.com",
  "2vlf0dl00g3ehagvn6d3j6upqo@group.calendar.google.com",
  "4i7vrukr5mg8q7bhbr5rhvbc20@group.calendar.google.com",
  "trqeun0taea00oi926ik1esh9s@group.calendar.google.com",
  "99qi5eklad869j8bfeog9oarp8@group.calendar.google.com",
  "ja.japanese#holiday@group.v.calendar.google.com",
] as const;

type EmbedMode = "MONTH" | "WEEK" | "AGENDA";

export function buildGoogleEmbedUrl(
  ids: readonly string[],
  opts: { tz?: string; mode?: EmbedMode; showTitle?: boolean } = {},
): string {
  const { tz = VET_CALENDAR_TZ, mode = "MONTH", showTitle = false } = opts;
  const params = new URLSearchParams();
  for (const id of ids) params.append("src", id);
  params.set("ctz", tz);
  params.set("mode", mode);
  params.set("showTitle", showTitle ? "1" : "0");
  params.set("showPrint", "0");
  params.set("showCalendars", "0");
  params.set("showTz", "0");
  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}

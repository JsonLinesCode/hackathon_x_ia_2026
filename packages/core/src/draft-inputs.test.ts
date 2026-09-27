import { describe, expect, it } from "vitest";
import { explicitDraftTimeWindows, normalizeDraftTime, resolveDraftDate } from "./draft-inputs";
const now = new Date("2026-09-27T10:00:00Z");
describe("messy date and time input", () => {
  it.each([["6/10", "2026-10-06"], ["le 6", "2026-10-06"], ["6 octobre", "2026-10-06"], ["6 October", "2026-10-06"], ["mardi prochain", "2026-09-29"], ["next Tuesday", "2026-09-29"], ["6/1", "2027-01-06"]])("resolves %s without a question", (text, date) => {
    expect(resolveDraftDate(text, now, "Europe/Berlin")).toBe(date);
  });
  it.each([["10h", "10:00"], ["10:00", "10:00"], ["10 h 30", "10:30"], ["10am", "10:00"], ["2pm", "14:00"], ["12am", "00:00"]])("normalizes %s", (text, time) => {
    expect(normalizeDraftTime(text)).toBe(time);
  });
});


describe("explicit clock filter preservation", () => {
  it.each(["pas de vol avant 7h", "no flights before 7am", "départ après 07:00", "ne pas partir avant 7 h"])("preserves %s", (message) => {
    expect(explicitDraftTimeWindows(message)).toEqual([{ field: "departure_window", value: { earliest: "07:00", latest: null, relative_to: "local_time" }, traveler_id: null }]);
  });
  it("keeps independent departure and arrival limits", () => {
    expect(explicitDraftTimeWindows("pas de vol avant 7h, arriver avant 09:30")).toHaveLength(2);
    expect(explicitDraftTimeWindows("arrive before 9am")[0].value).toMatchObject({ latest: "09:00" });
  });
  it("does not confuse a date or small talk with a time window", () => {
    expect(explicitDraftTimeWindows("vol avant 7 octobre, bonjour")).toEqual([]);
  });
});

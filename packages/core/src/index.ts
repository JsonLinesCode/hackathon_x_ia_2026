export const PRODUCT_NAME = "Travel Manager";

export function formatTravelerSummary(count: number, destination: string) {
  const travelerLabel = count === 1 ? "traveler" : "travelers";

  return `${count} ${travelerLabel} coordinated for ${destination}`;
}

export * from "./gate";
export * from "./policy";
export * from "./cancellation";
export * from "./scoring";
export * from "./state-machine";
export * from "./dates";
export * from "./signed-link";

export * from "./planning";

export * from "./calendar-file";

export * from "./coordination";

export * from "./disruptions";

export * from "./expenses";

export * from "./trip-draft";
export * from "./trip-cities";

export * from "./draft-inputs";

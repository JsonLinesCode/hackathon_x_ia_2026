export const PRODUCT_NAME = "Travel Manager";

export function formatTravelerSummary(count: number, destination: string) {
  const travelerLabel = count === 1 ? "traveler" : "travelers";

  return `${count} ${travelerLabel} coordinated for ${destination}`;
}

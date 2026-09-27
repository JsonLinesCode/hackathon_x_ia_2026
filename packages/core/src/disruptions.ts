import { HotelDetailsSchema, type TripOption, type Booking, type CancellationPreview } from "@repo/types";
import { computeCancellationCost } from "./cancellation";
export function cancellationEstimate(booking: Booking, now: Date) {
  return { booking_id: booking.id, ...computeCancellationCost(booking.cancellation_terms, now),
    source: booking.status === "quoted" ? "unpaid_quote_terms" : "stored_terms" };
}
export function cancellationTotal(previews: CancellationPreview[]) {
  return previews.some((p) => p.fee_eur === null) ? null : Math.round(previews.reduce((sum, p) => sum + p.fee_eur!, 0) * 100) / 100;
}
export function isLate(arrival: string | null, meetingStart: string | null) {
  return !!arrival && !!meetingStart && Date.parse(arrival) > Date.parse(meetingStart);
}

export function includeRetainedHotels(items: TripOption["per_traveler"], bookings: Booking[]) {
  return items.map((item) => {
    if (item.hotel) return item;
    const retained = bookings.find((b) => b.traveler_id === item.traveler_id && b.kind === "hotel" && ["quoted", "booked"].includes(b.status));
    if (!retained) return item;
    const hotel = HotelDetailsSchema.parse(retained.details), nights = Math.round((Date.parse(hotel.checkout) - Date.parse(hotel.checkin)) / 86400000);
    return { ...item, hotel: { nights, nightly_eur: retained.price_eur / nights, total_eur: retained.price_eur, details: hotel } };
  });
}

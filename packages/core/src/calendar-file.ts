import { FlightDetailsSchema, HotelDetailsSchema, type Booking, type Meeting } from "@repo/types";
export type ItineraryEvent = { id: string; start: string; end: string; allDay: boolean; title: string; location: string; tentative: boolean };
export function itineraryEvents(bookings: Omit<Booking, "raw">[], meeting: Meeting | null): ItineraryEvent[] {
  const events: ItineraryEvent[] = [];
  for (const booking of bookings) {
    if (!["quoted", "booked"].includes(booking.status)) continue;
    if (booking.kind === "flight") {
      const details = FlightDetailsSchema.parse(booking.details);
      for (const [legIndex, leg] of [details.outbound, details.inbound].entries()) {
        if (!leg) continue;
        const segments = leg.segments.length ? leg.segments : [{ origin: leg.origin, destination: leg.destination, departure: leg.departure, arrival: leg.arrival, flight_number: "", carrier: leg.carrier }];
        segments.forEach((segment, index) => events.push({ id: booking.id + "-" + legIndex + "-" + index,
          start: segment.departure, end: segment.arrival, allDay: false, title: segment.carrier + " " + segment.flight_number + " · " + segment.origin + " → " + segment.destination,
          location: segment.origin + " → " + segment.destination, tentative: booking.status !== "booked" }));
      }
    } else {
      const details = HotelDetailsSchema.parse(booking.details);
      events.push({ id: booking.id, start: details.checkin, end: details.checkout, allDay: true,
        title: details.name, location: details.address, tentative: booking.status !== "booked" });
    }
  }
  if (meeting && !meeting.cancelled) events.push({ id: "meeting", start: meeting.start, end: meeting.end, allDay: false, title: meeting.title, location: meeting.location, tentative: true });
  return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
function fold(line: string) {
  const lines: string[] = []; let current = ""; let size = 0;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (size + bytes > 75) { lines.push(current); current = " "; size = 1; }
    current += char; size += bytes;
  }
  lines.push(current);
  return lines.join("\r\n");
}
export function calendarFile(tripId: string, events: ItineraryEvent[], now: Date) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travel Manager//Itinerary//EN", "CALSCALE:GREGORIAN",
    ...events.flatMap((event) => ["BEGIN:VEVENT", "UID:" + tripId + "-" + event.id + "@travel-manager",
      "DTSTAMP:" + stamp(now.toISOString()),
      event.allDay ? "DTSTART;VALUE=DATE:" + event.start.replaceAll("-", "") : "DTSTART:" + stamp(event.start),
      event.allDay ? "DTEND;VALUE=DATE:" + event.end.replaceAll("-", "") : "DTEND:" + stamp(event.end),
      "SUMMARY:" + escapeText(event.title), "LOCATION:" + escapeText(event.location),
      "STATUS:" + (event.tentative ? "TENTATIVE" : "CONFIRMED"),
      "DESCRIPTION:" + (event.tentative ? "Unpaid quote or unverified meeting. Confirm separately before travel." : "Confirmed booking."),
      "END:VEVENT"]), "END:VCALENDAR"];
  return lines.map(fold).join("\r\n") + "\r\n";
}

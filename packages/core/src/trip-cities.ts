// Supported destination choices. Time zones and airport codes are application data,
// never guessed by the model. Extend this list to add another destination.
export const TRIP_CITIES = [
  ["Paris", "CDG", "Europe/Paris", "paris"], ["Berlin", "BER", "Europe/Berlin", "berlin"],
  ["London", "LHR", "Europe/London", "londres"], ["Madrid", "MAD", "Europe/Madrid", "madrid"],
  ["Barcelona", "BCN", "Europe/Madrid", "barcelone"], ["Rome", "FCO", "Europe/Rome", "roma"],
  ["Milan", "MXP", "Europe/Rome", "milano"], ["Amsterdam", "AMS", "Europe/Amsterdam", "amsterdam"],
  ["Brussels", "BRU", "Europe/Brussels", "bruxelles"], ["Lisbon", "LIS", "Europe/Lisbon", "lisbonne"],
  ["Vienna", "VIE", "Europe/Vienna", "vienne"], ["Zurich", "ZRH", "Europe/Zurich", "zurich"],
  ["Geneva", "GVA", "Europe/Zurich", "geneve"], ["Munich", "MUC", "Europe/Berlin", "munich"],
  ["Frankfurt", "FRA", "Europe/Berlin", "francfort"], ["Lyon", "LYS", "Europe/Paris", "lyon"],
  ["Marseille", "MRS", "Europe/Paris", "marseille"], ["Nice", "NCE", "Europe/Paris", "nice"],
  ["Toulouse", "TLS", "Europe/Paris", "toulouse"], ["Bordeaux", "BOD", "Europe/Paris", "bordeaux"],
  ["Copenhagen", "CPH", "Europe/Copenhagen", "copenhague"], ["Stockholm", "ARN", "Europe/Stockholm", "stockholm"],
  ["Dublin", "DUB", "Europe/Dublin", "dublin"], ["Prague", "PRG", "Europe/Prague", "prague"],
  ["New York", "JFK", "America/New_York", "new york"], ["Montreal", "YUL", "America/Toronto", "montreal"],
  ["Toronto", "YYZ", "America/Toronto", "toronto"], ["San Francisco", "SFO", "America/Los_Angeles", "san francisco"],
  ["Dubai", "DXB", "Asia/Dubai", "dubai"], ["Singapore", "SIN", "Asia/Singapore", "singapour"],
  ["Tokyo", "HND", "Asia/Tokyo", "tokyo"],
].map(([name, airport, timezone, alias]) => ({ name, airport, timezone, alias }));
export const normalizeName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const tripCity = (value: string) => TRIP_CITIES.find((c) => [c.name, c.alias, c.airport].some((name) => normalizeName(name) === normalizeName(value)));

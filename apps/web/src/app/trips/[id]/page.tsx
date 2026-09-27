import { notFound, redirect } from "next/navigation";
import { IdSchema } from "@repo/types";
import { AppShell } from "@/components/app-shell";
export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "berlin") redirect("/trips");
  if (!IdSchema.safeParse(id).success) notFound();
  return <AppShell screen="trip" tripId={id} />;
}

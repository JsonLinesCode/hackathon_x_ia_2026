import { notFound } from "next/navigation";
import { IdSchema } from "@repo/types";
import { AppShell } from "@/components/app-shell";
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!IdSchema.safeParse(id).success) notFound();
  return <AppShell screen="report" tripId={id} />;
}

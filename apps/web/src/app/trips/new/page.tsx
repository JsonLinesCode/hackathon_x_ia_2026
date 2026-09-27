import { AppShell } from "@/components/app-shell";
import { IdSchema } from "@repo/types";
export default async function CreateTripPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const { draft } = await searchParams;
  return <AppShell screen="create" tripId={IdSchema.safeParse(draft).success ? draft : undefined} />;
}

import { TravelerReply } from "@/components/traveler-reply";
export const metadata = { title: "Your travel plan", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <TravelerReply token={(await params).token} />;
}

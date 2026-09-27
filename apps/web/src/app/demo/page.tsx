import { DemoShowcase } from "@/components/demo-showcase";

export const metadata = {
  title: "Travel Manager Demo",
  description: "Deterministic presentation sequence for the Travel Manager hackathon demo.",
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ clean?: string }>;
}) {
  const { clean } = await searchParams;
  return <DemoShowcase clean={clean === "1"} />;
}

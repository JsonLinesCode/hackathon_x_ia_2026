import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { screens } from "@/lib/travel-data";

export function generateStaticParams() {
  return Object.keys(screens).map((path) => ({ path: path.split("/") }));
}

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const key = path.join("/");
  const screen = Object.hasOwn(screens, key) ? screens[key] : undefined;
  if (!screen) notFound();
  return <AppShell screen={screen} />;
}

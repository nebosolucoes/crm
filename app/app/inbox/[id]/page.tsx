import { redirect } from "next/navigation";
import { exigirRecurso } from "@/lib/entitlements/exigir";

export const dynamic = "force-dynamic";

export default async function InboxDeepLink({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("inbox");
  const { id } = await params;
  redirect(`/app/inbox?id=${id}`);
}

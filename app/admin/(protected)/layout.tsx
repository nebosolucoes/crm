import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { AdminShell } from "@/components/admin/AdminShell";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { ExibicaoDoCustoProvider } from "@/lib/ai/custo/ExibicaoDoCustoProvider";
import { exibicaoDoCusto } from "@/lib/ai/custo/exibicao-da-instalacao";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const { user } = await requirePlatformAdmin();
  // Mesmo padrão de `app/app/layout.tsx`: o idioma envolve a árvore inteira e
  // recebe o código PRONTO. Sem este Provider, `useT()` nos componentes do
  // admin cai no padrão do Context (pt-BR) e nenhuma tradução aparece, não
  // importa quantas entradas o dicionário tenha — um admin de plataforma é a
  // MESMA conta que o dono do tenant (o install.sh promove o dono a platform
  // admin), então o `user_metadata.locale` dele já existe e é o mesmo lido em
  // `lib/auth/server.ts`.
  const locale = (user.user_metadata?.locale as string | undefined) ?? null;
  // Quem administra a instalação vê o custo REAL ao lado do valor repassado
  // (`mostrarCustoReal`); a organização, em /app, vê só o repassado.
  const exibicaoCusto = await exibicaoDoCusto();
  return (
    <IdiomaProvider locale={locale}>
      <ExibicaoDoCustoProvider cfg={exibicaoCusto} mostrarCustoReal>
        <AdminShell userEmail={user.email ?? ""}>{children}</AdminShell>
      </ExibicaoDoCustoProvider>
    </IdiomaProvider>
  );
}

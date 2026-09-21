"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";
import { loginSchema, type LoginInput } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { CampoDaFachada } from "@/components/auth/fachada/CampoDaFachada";
import { CircleNotch, Envelope, Lock, SignIn } from "@/lib/ui/icons";
import { signInWithPassword } from "@/app/actions/auth/signInWithPassword";

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (values: LoginInput) => {
    setServerError(null);
    startTransition(async () => {
      // Server Action redirects on success — no return value reaches here.
      // On failure, an error discriminator is returned and rendered inline.
      const res = await signInWithPassword(values, next);
      if (!res) {
        // Should be unreachable (redirect throws), but guard anyway.
        router.replace(next || "/app");
        return;
      }
      if (res.error === "mfa_required") {
        const params = new URLSearchParams();
        if (next) params.set("next", next);
        if (res.challengeId) params.set("factor", res.challengeId);
        router.replace(`/login/mfa${params.toString() ? `?${params}` : ""}`);
        return;
      }
      if (res.error === "invalid_credentials") {
        setServerError(t("Email ou senha incorretos."));
      } else if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else {
        setServerError(t("Erro inesperado. Tente novamente."));
      }
    });
  };

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <CampoDaFachada
        id="email"
        rotulo={t("Email")}
        icone={<Envelope weight="regular" />}
        type="email"
        autoComplete="email"
        autoFocus
        placeholder={t("voce@empresa.com")}
        erro={errors.email ? t(errors.email.message ?? "") : null}
        {...register("email")}
      />
      <div className="space-y-3">
        <CampoDaFachada
          id="password"
          rotulo={t("Senha")}
          icone={<Lock weight="regular" />}
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          erro={errors.password ? t(errors.password.message ?? "") : null}
          {...register("password")}
        />
        <div className="text-right">
          <Link
            href="/login/forgot"
            className="text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("Esqueci minha senha")}
          </Link>
        </div>
      </div>
      {serverError && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {serverError}
        </div>
      )}
      <Button
        type="submit"
        className="auth-sombra-botao h-14 w-full rounded-full text-[15px] font-semibold lg:h-14"
        disabled={isPending}
      >
        {isPending ? <CircleNotch className="animate-spin" /> : <SignIn weight="bold" />}
        {isPending ? t("Entrando...") : t("Entrar")}
      </Button>
    </form>
  );
}

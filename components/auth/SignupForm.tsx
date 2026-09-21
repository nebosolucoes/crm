"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import {
  signupSchema,
  signupComConviteSchema,
  type SignupInput,
  type SignupComConviteInput,
} from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { CampoDaFachada } from "@/components/auth/fachada/CampoDaFachada";
import {
  ArrowRight,
  Buildings,
  CircleNotch,
  Envelope,
  Eye,
  EyeSlash,
  Lock,
  UserCircle,
} from "@/lib/ui/icons";
import { signUp } from "@/app/actions/auth/signUp";

/**
 * Convite em curso: a conta está sendo criada para ACEITAR um convite, não para
 * abrir uma empresa. Muda duas coisas na tela — some o campo "Nome da empresa"
 * (a empresa já existe; pedir seria mandar a pessoa batizar a organização de
 * outra gente) e o e-mail fica travado no do convite.
 */
export interface ConviteDoSignup {
  token: string;
  email: string;
}

export function SignupForm({ convite }: { convite?: ConviteDoSignup }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [contaExistente, setContaExistente] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupInput & { full_name: string }>({
    // O formulário tem UM tipo e DOIS contratos, e agora os dois contratos têm
    // um campo que o outro não tem: `org_name` só no caminho de quem abre
    // empresa, `full_name` só no de quem foi convidado. O resolver troca; o
    // tipo do form é a união larga dos dois, e cada campo só é renderizado —
    // e só é enviado — no modo a que pertence. O `as unknown as` existe porque
    // os dois contratos deixaram de se sobrepor o bastante para o TypeScript
    // aceitar a conversão direta.
    resolver: (convite
      ? zodResolver(signupComConviteSchema)
      : zodResolver(signupSchema)) as unknown as Resolver<SignupInput & { full_name: string }>,
    defaultValues: {
      full_name: "",
      org_name: "",
      email: convite?.email ?? "",
      password: "",
      password_confirm: "",
    },
  });

  const onSubmit = (values: SignupInput & { full_name: string }) => {
    setServerError(null);
    startTransition(async () => {
      // No modo convite o e-mail do formulário é readonly, e readonly no
      // cliente não vale nada: quem confere de novo é o servidor.
      const entrada: SignupInput | SignupComConviteInput = convite
        ? {
            full_name: values.full_name,
            email: convite.email,
            password: values.password,
            password_confirm: values.password_confirm,
          }
        : values;
      const res = await signUp(entrada, convite?.token);
      if (res.ok) {
        /**
         * ⚠️ O PROVEDOR JÁ DEIXOU A PESSOA ENTRAR — não existe e-mail para ela
         * esperar. Acontece quando "Confirm email" está desligado no provedor
         * de auth, que é uma escolha do operador da instalação e não um defeito
         * dele; o defeito é a tela abaixo, que manda "abra o e-mail e clique no
         * link" para quem já está autenticado. Sem este desvio a pessoa fica
         * parada nessa instrução para sempre: logada, sem organização, e sem
         * motivo nenhum para descobrir sozinha que a saída existe em
         * `/get-started`. Medido com um cliente real travado — achado de
         * @KIRAzinx566.
         *
         * O destino separa as duas naturezas de cadastro, com o dado que esta
         * tela já tem em mãos: quem veio de um convite vai ACEITAR o convite
         * (dar organização própria a essa pessoa é o erro que
         * `decidirConviteDoSignup` existe para evitar); quem se cadastrou por
         * conta própria vai à recuperação, que é o caminho auditado e com teto
         * de tentativas — e não uma segunda porta de provisionamento.
         */
        if (res.sessao_ativa) {
          router.replace(
            convite ? `/team/accept-invite/${convite.token}` : "/get-started",
          );
          return;
        }
        setSentTo(values.email);
        return;
      }
      if (res.error === "rate_limited") {
        setServerError(t("Muitas tentativas. Aguarde alguns minutos."));
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else if (res.error === "conta_ja_existe" && convite) {
        // Ramo próprio porque o `else` mandava "Tente novamente" — e tentar de
        // novo nunca funciona quando a conta já existe. Em vez da mensagem,
        // a SAÍDA: entrar levando o convite pendurado, para cair no aceite e
        // não na tela inicial (que, para quem foi revogado, é a tela de acesso
        // revogado, com um botão Sair e mais nada).
        setContaExistente(true);
      } else if (res.error === "somente_convite") {
        // Ramo próprio porque o `else` diria "Tente novamente", e aqui tentar
        // de novo nunca vai funcionar — é política, não falha transitória.
        setServerError(
          t(
            "Esta instalação aceita cadastro apenas por convite. Se você foi convidado, use o link que chegou no seu e-mail.",
          ),
        );
      } else {
        setServerError(t("Não foi possível criar a conta. Tente novamente."));
      }
    });
  };

  if (contaExistente && convite) {
    const destino = `/login?next=${encodeURIComponent(`/team/accept-invite/${convite.token}`)}`;
    return (
      <div className="space-y-4 rounded-md border bg-muted/40 px-4 py-6 text-center" role="status">
        <p className="text-sm font-medium">{t("Você já tem uma conta com este e-mail")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Entre com ela para aceitar o convite — não é preciso criar outra.")}
        </p>
        <Button asChild className="w-full">
          <Link href={destino}>{t("Entrar e aceitar o convite")}</Link>
        </Button>
      </div>
    );
  }

  if (sentTo) {
    return (
      <div
        className="space-y-2 rounded-md border bg-muted/40 px-4 py-6 text-center"
        role="status"
      >
        <p className="text-sm font-medium">{t("Confirme seu e-mail")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Enviamos um link de confirmação para")} <strong>{sentTo}</strong>.{" "}
          {t("Abra o e-mail e clique no link para ativar sua conta.")}
        </p>
      </div>
    );
  }

  const tipoDaSenha = mostrarSenha ? "text" : "password";

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-5 sm:grid-cols-2"
      noValidate
    >
      {/*
        Só no modo CONVITE. Quem abre a própria empresa dá o nome no onboarding;
        quem é convidado pula o onboarding e ficava sem nome para sempre —
        aparecendo como um pedaço do identificador interno em toda tela que o
        nomeia (medido no diálogo de transferir conversa, em produção).
      */}
      {convite && (
        <div className="sm:col-span-2">
          <CampoDaFachada
            id="full_name"
            rotulo={t("Seu nome")}
            icone={<UserCircle weight="regular" />}
            type="text"
            autoComplete="name"
            autoFocus
            placeholder={t("Seu nome")}
            erro={errors.full_name ? t(errors.full_name.message ?? "") : null}
            {...register("full_name")}
          />
        </div>
      )}
      {!convite && (
        <div className="sm:col-span-2">
          <CampoDaFachada
            id="org_name"
            rotulo={t("Nome da empresa")}
            icone={<Buildings weight="regular" />}
            type="text"
            autoComplete="organization"
            autoFocus
            placeholder={t("Nome da empresa")}
            erro={errors.org_name ? t(errors.org_name.message ?? "") : null}
            {...register("org_name")}
          />
        </div>
      )}
      <div className="sm:col-span-2">
        <CampoDaFachada
          id="email"
          rotulo="Email"
          icone={<Envelope weight="regular" />}
          type="email"
          autoComplete="email"
          placeholder={t("voce@empresa.com")}
          // O convite vale para UM endereço. Deixar editável convidaria a
          // trocar e receber "email_divergente" depois de preencher tudo.
          readOnly={Boolean(convite)}
          erro={errors.email ? t(errors.email.message ?? "") : null}
          {...register("email")}
        />
      </div>
      <CampoDaFachada
        id="password"
        rotulo={t("Senha")}
        icone={<Lock weight="regular" />}
        type={tipoDaSenha}
        autoComplete="new-password"
        placeholder={t("Digite sua senha")}
        erro={errors.password ? t(errors.password.message ?? "") : null}
        acessorio={
          <button
            type="button"
            className="text-text-muted transition-colors hover:text-text [&_svg]:size-5"
            aria-label={mostrarSenha ? t("Ocultar senha") : t("Mostrar senha")}
            aria-pressed={mostrarSenha}
            onClick={() => setMostrarSenha((atual) => !atual)}
          >
            {mostrarSenha ? <EyeSlash weight="regular" /> : <Eye weight="regular" />}
          </button>
        }
        {...register("password")}
      />
      <CampoDaFachada
        id="password_confirm"
        rotulo={t("Confirmar senha")}
        icone={<Lock weight="regular" />}
        type={tipoDaSenha}
        autoComplete="new-password"
        placeholder={t("Repita sua senha")}
        erro={errors.password_confirm ? t(errors.password_confirm.message ?? "") : null}
        {...register("password_confirm")}
      />
      {serverError && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2"
          role="alert"
        >
          {serverError}
        </div>
      )}
      <div className="sm:col-span-2">
        <Button
          type="submit"
          className="auth-sombra-botao mt-1 h-14 w-full rounded-full text-[15px] font-semibold lg:h-14"
          disabled={isPending}
        >
          {isPending ? <CircleNotch className="animate-spin" /> : <ArrowRight weight="bold" />}
          {isPending ? t("Criando conta...") : t("Criar conta")}
        </Button>
      </div>
    </form>
  );
}

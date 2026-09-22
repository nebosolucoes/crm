"use client";

import { TEMA_ESCURO_HABILITADO } from "@/lib/tema-escuro";
import { useTheme } from "@/lib/theme";
import { useHotkeys } from "react-hotkeys-hook";
import { Sun, Moon, MonitorPlay } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

export function ThemeToggle() {
  // Com o escuro desligado (`lib/tema-escuro.ts`) o botão não existe: um botão
  // que cicla entre três temas e só entrega um seria uma promessa falsa. O
  // `ThemeToggleInterno` continua montado para o dia em que a chave religar.
  if (!TEMA_ESCURO_HABILITADO) return null;
  return <ThemeToggleInterno />;
}

function ThemeToggleInterno() {
  const t = useT();
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  useHotkeys("mod+shift+l", cycle, { preventDefault: true }, [theme]);

  const Icon = theme === "dark" ? Moon : theme === "system" ? MonitorPlay : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={t(`Tema: ${theme}. Cmd+Shift+L para alternar.`)}
    >
      <Icon size={16} aria-hidden />
    </Button>
  );
}

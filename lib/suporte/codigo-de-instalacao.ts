/**
 * Lê o "Código para instalar" que a central de chamados mostra na tela do
 * widget e devolve o que esta instalação guarda: o endereço do script e a chave
 * pública. O resto do código (o `identify` com valores de exemplo) é ignorado de
 * propósito — quem monta a identidade é o servidor, com o usuário logado.
 *
 * Puro e sem dependências: a tela de `/admin/suporte` chama a cada colagem.
 */

export interface CodigoDeInstalacaoLido {
  readonly scriptUrl: string | null;
  readonly publicKey: string | null;
}

export function lerCodigoDeInstalacao(codigo: string): CodigoDeInstalacaoLido {
  // Só a tag que carrega o script: a primeira `<script ... src=...>`.
  const tag = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(codigo);
  const scriptUrl = tag?.[1]?.trim() || null;
  const chave = tag ? /\sdata-key\s*=\s*["']([^"']+)["']/i.exec(tag[0]) : null;
  const publicKey = chave?.[1]?.trim() || null;
  return { scriptUrl, publicKey };
}

/** O navegador recusa script `http://` numa tela `https://`; a tela avisa antes. */
export function enderecoEhSeguro(url: string): boolean {
  return /^https:\/\//i.test(url.trim());
}

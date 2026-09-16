import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'), 'utf8');

describe('rascunho assistido', () => {
  it('termina depois da resposta proposta, antes do checkpoint que não usa', () => {
    const inicioAssistido = source.indexOf("if (preview?.kind === 'assisted')");
    const fimAssistido = source.indexOf("    // Fechamento imposto pelo runtime", inicioAssistido);
    const checkpoint = source.indexOf("purpose: 'checkpoint'", fimAssistido);

    expect(inicioAssistido).toBeGreaterThanOrEqual(0);
    expect(fimAssistido).toBeGreaterThan(inicioAssistido);
    expect(source.slice(inicioAssistido, fimAssistido)).toContain('return;');
    expect(checkpoint).toBeGreaterThan(fimAssistido);
  });
});

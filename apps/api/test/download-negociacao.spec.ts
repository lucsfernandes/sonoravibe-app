import { describe, expect, it } from 'vitest';
import { querJson } from '../src/songs/songs.controller';

/**
 * A regra que decide entre `{ url }` e o 302 para o R2.
 *
 * Bug real em produção: a interface não mandava `Accept` nenhum. O padrão do
 * navegador é o coringa `* / *`, que não contém "application/json", então a API
 * respondia 302; o `fetch` seguia o redirect para o R2, que não manda cabeçalho
 * de CORS, e rejeitava com um "Failed to fetch" sem status nem corpo. O usuário
 * via "convertendo..." e depois um erro genérico — para um arquivo que já
 * estava pronto no bucket.
 *
 * Os dois lados precisam concordar. Aqui fica pinado o lado do servidor.
 */

describe('querJson', () => {
  it('reconhece o Accept que a interface manda', () => {
    expect(querJson('application/json')).toBe(true);
  });

  it('reconhece dentro de uma lista com qualidade', () => {
    // Um cliente HTTP real raramente manda o tipo sozinho.
    expect(querJson('application/json, text/plain, */*')).toBe(true);
    expect(querJson('text/html;q=0.9, application/json;q=1.0')).toBe(true);
  });

  it('ignora a caixa das letras', () => {
    expect(querJson('Application/JSON')).toBe(true);
  });

  it('NÃO trata o coringa como pedido de JSON', () => {
    // Este é o caso do bug. O coringa é o que um `<a href>` manda, e para ele
    // o redirect é o comportamento certo — por isso a regra tem que ser
    // específica, não permissiva.
    expect(querJson('*/*')).toBe(false);
  });

  it('NÃO casa com quem só aceita HTML', () => {
    expect(querJson('text/html,application/xhtml+xml,image/webp,*/*;q=0.8')).toBe(false);
  });

  it('aguenta o cabeçalho ausente', () => {
    // `headers.accept` é opcional no Express; sem o `?? false` isto seria
    // `undefined` e o `if` escolheria o redirect por acidente, não por regra.
    expect(querJson(undefined)).toBe(false);
    expect(querJson('')).toBe(false);
  });
});

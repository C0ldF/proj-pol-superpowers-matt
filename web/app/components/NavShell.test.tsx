import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavShell } from './NavShell';

describe('NavShell', () => {
  it('renderiza os 2 links de navegação e o children', () => {
    const html = renderToStaticMarkup(
      <NavShell>
        <p>conteudo-de-teste</p>
      </NavShell>,
    );
    expect(html).toContain('href="/mapa-calor"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('conteudo-de-teste');
  });
});

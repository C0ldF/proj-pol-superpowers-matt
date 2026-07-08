'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

async function sair() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
}

const LINKS = [
  { href: '/mapa-calor', label: 'Mapa de Calor' },
  { href: '/dashboard', label: 'Dashboard' },
];

const focoVisivel =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

// NavShell é o layout estrutural das telas autenticadas (sidebar + área
// principal), não só uma barra de navegação — /dashboard e /mapa-calor
// dependem dele pra essa estrutura inteira.
export function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-row items-center justify-between gap-4 border-b border-outline-variant bg-surface-container-low px-6 py-4 md:w-[240px] md:flex-shrink-0 md:flex-col md:items-stretch md:justify-between md:border-b-0 md:border-r md:px-6 md:py-6">
        <div className="flex flex-row items-center gap-4 md:flex-col md:items-start md:gap-6">
          <p className="text-headline-md text-on-surface">Sistema Campanha</p>
          <nav aria-label="Navegação principal" className="flex flex-row gap-2 md:flex-col">
            {LINKS.map((link) => {
              const ativo = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={ativo ? 'page' : undefined}
                  className={`rounded px-4 py-2 text-body-md transition-colors ${focoVisivel} ${
                    ativo
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <button
          type="button"
          onClick={sair}
          className={`rounded px-4 py-2 text-left text-body-md text-on-surface-variant transition-colors hover:text-on-surface ${focoVisivel}`}
        >
          Sair
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}

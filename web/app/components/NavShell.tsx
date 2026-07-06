'use client';
import Link from 'next/link';

async function sair() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
}

export function NavShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header>
        <nav>
          <Link href="/mapa-calor">Mapa de Calor</Link>
          {' '}
          <Link href="/dashboard">Dashboard</Link>
          {' '}
          <button type="button" onClick={sair}>Sair</button>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

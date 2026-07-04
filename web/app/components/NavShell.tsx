import Link from 'next/link';

export function NavShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header>
        <nav>
          <Link href="/mapa-calor">Mapa de Calor</Link>
          {' '}
          <Link href="/dashboard">Dashboard</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

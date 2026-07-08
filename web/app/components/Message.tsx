interface MessageProps {
  variant: 'error' | 'success';
  children: React.ReactNode;
}

export function Message({ variant, children }: MessageProps) {
  // error → role="alert" (anúncio assertivo, correto pra erro);
  // success → role="status" (anúncio "polite", não-assertivo — mais
  // correto pra confirmação não-urgente do que "alert" seria).
  // Decisão de acessibilidade (ARIA), não só estilo.
  const role = variant === 'error' ? 'alert' : 'status';
  const colorClasses =
    variant === 'error'
      ? 'bg-error-container text-on-error-container'
      : 'bg-secondary-container text-on-secondary-container';

  // <p>, não <div>/<section>: preserva exatamente a semântica e o DOM
  // que já existia no banner de erro inline do /login (mesma tag).
  return (
    <p role={role} className={`rounded px-4 py-3 text-body-md ${colorClasses}`}>
      {children}
    </p>
  );
}

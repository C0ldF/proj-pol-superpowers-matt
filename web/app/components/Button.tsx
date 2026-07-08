'use client';
import type { ComponentProps } from 'react';

export function Button({ className = '', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center rounded bg-primary px-6 py-3 text-body-md text-on-primary transition-colors hover:bg-primary/90 active:bg-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary ${className}`}
    />
  );
}

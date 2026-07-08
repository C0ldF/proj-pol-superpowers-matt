'use client';
import { useId, type ComponentProps } from 'react';

interface InputProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string;
  error?: boolean;
  id?: string;
}

export function Input({ label, error = false, id, className = '', ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className={`text-label-md ${error ? 'text-error' : 'text-on-surface-variant'}`}
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        {...props}
        className={`rounded border px-4 py-3 text-body-lg text-on-surface placeholder:text-on-surface-variant bg-surface-container-lowest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${error ? 'border-error hover:border-error' : 'border-outline hover:border-on-surface-variant'} ${className}`}
      />
    </div>
  );
}

'use client';

/** Campo de formulário das telas de conta e checkout. */
export function CampoAuth({
  rotulo,
  valor,
  onChange,
  tipo = 'text',
  dica,
  ...resto
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
  dica?: string;
  // `onChange` é omitido de propósito: o nosso recebe a string pronta, e o do
  // DOM recebe o evento — deixar os dois no mesmo nome cria um tipo impossível.
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-texto-suave">{rotulo}</span>
      <input
        {...resto}
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-borda bg-fundo px-3.5 py-3 text-sm outline-none transition-colors placeholder:text-texto-fraco focus:border-acento"
      />
      {dica && <span className="mt-1.5 block text-xs text-texto-fraco">{dica}</span>}
    </label>
  );
}

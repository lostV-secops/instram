import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  // ─── Charte graphique : vert #9CC43D UNIQUEMENT sur variant="action" ──────────

  it('applique la classe bg-action sur variant="action"', () => {
    render(<Button variant="action">Réserver</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-action');
  });

  it('n\'applique pas bg-action sur variant="primary"', () => {
    render(<Button variant="primary">Accueil</Button>);
    expect(screen.getByRole('button')).not.toHaveClass('bg-action');
    expect(screen.getByRole('button')).toHaveClass('bg-brand');
  });

  it('n\'applique pas bg-action sur variant="secondary"', () => {
    render(<Button variant="secondary">Secondaire</Button>);
    expect(screen.getByRole('button')).not.toHaveClass('bg-action');
  });

  it('n\'applique pas bg-action sur variant="ghost"', () => {
    render(<Button variant="ghost">Annuler</Button>);
    expect(screen.getByRole('button')).not.toHaveClass('bg-action');
  });

  it('n\'applique pas bg-action sur variant="danger"', () => {
    render(<Button variant="danger">Supprimer</Button>);
    expect(screen.getByRole('button')).not.toHaveClass('bg-action');
    expect(screen.getByRole('button')).toHaveClass('bg-red-600');
  });

  // ─── variant par défaut ───────────────────────────────────────────────────────

  it('utilise "primary" comme variant par défaut', () => {
    render(<Button>Cliquer</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-brand');
  });

  // ─── État chargement ──────────────────────────────────────────────────────────

  it('désactive le bouton et affiche le spinner en isLoading', () => {
    render(<Button isLoading>Payer</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn.querySelector('svg')).toBeInTheDocument();
  });

  it('n\'affiche pas le spinner sans isLoading', () => {
    render(<Button>Payer</Button>);
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'false');
    expect(btn.querySelector('svg')).toBeNull();
  });

  // ─── Prop disabled ────────────────────────────────────────────────────────────

  it('désactive le bouton via prop disabled', () => {
    render(<Button disabled>Indisponible</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  // ─── fullWidth ────────────────────────────────────────────────────────────────

  it('applique w-full en fullWidth', () => {
    render(<Button fullWidth>Plein</Button>);
    expect(screen.getByRole('button')).toHaveClass('w-full');
  });

  // ─── Tailles ─────────────────────────────────────────────────────────────────

  it('applique les classes sm, md, lg correctement', () => {
    const { rerender } = render(<Button size="sm">Petit</Button>);
    expect(screen.getByRole('button')).toHaveClass('text-sm');

    rerender(<Button size="lg">Grand</Button>);
    expect(screen.getByRole('button')).toHaveClass('text-lg');
  });

  // ─── Clic ─────────────────────────────────────────────────────────────────────

  it('appelle onClick quand le bouton est actif', async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Clic</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ne déclenche pas onClick sur un bouton désactivé', async () => {
    const onClick = jest.fn();
    render(<Button disabled onClick={onClick}>Désactivé</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  // ─── Ref forwarding ──────────────────────────────────────────────────────────

  it('transmet la ref au bouton DOM', () => {
    const ref = { current: null } as React.RefObject<HTMLButtonElement>;
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

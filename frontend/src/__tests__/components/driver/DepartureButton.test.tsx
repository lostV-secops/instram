import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartureButton } from '@/components/driver/DepartureButton';

// Mock fetch global
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('DepartureButton', () => {
  const tripId = 'trip-uuid-123';

  // ─── État initial ────────────────────────────────────────────────────────────

  it('affiche le bouton "Signaler le départ" à l\'état idle', () => {
    render(<DepartureButton tripInstanceId={tripId} />);
    expect(screen.getByRole('button', { name: /signaler le départ/i })).toBeInTheDocument();
  });

  it('le bouton départ utilise variant="action" (vert transactionnel)', () => {
    render(<DepartureButton tripInstanceId={tripId} />);
    expect(screen.getByRole('button', { name: /signaler le départ/i })).toHaveClass('bg-action');
  });

  it('affiche "Départ signalé" si alreadyDeparted=true', () => {
    render(
      <DepartureButton
        tripInstanceId={tripId}
        alreadyDeparted
        departedAt="2024-06-01T08:30:00.000Z"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/départ signalé/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  // ─── Machine à états : idle → confirming ─────────────────────────────────────

  it('ouvre la modale de confirmation au clic', async () => {
    render(<DepartureButton tripInstanceId={tripId} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/confirmer le départ \?/i)).toBeInTheDocument();
  });

  it('le bouton de confirmation dans la modale utilise variant="action"', async () => {
    render(<DepartureButton tripInstanceId={tripId} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    expect(screen.getByRole('button', { name: /confirmer le départ/i })).toHaveClass('bg-action');
  });

  it('ferme la modale en cliquant sur "Annuler"', async () => {
    render(<DepartureButton tripInstanceId={tripId} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /annuler/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /signaler le départ/i })).toBeInTheDocument();
  });

  // ─── Machine à états : confirming → loading → done ──────────────────────────

  it('passe en état "done" après un POST réussi', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'DEPARTED' }),
    });

    render(<DepartureButton tripInstanceId={tripId} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmer le départ/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/départ signalé/i);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/proxy/v1/driver/trips/${tripId}/depart`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('appelle onDeparted avec l\'heure après succès', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'DEPARTED' }),
    });
    const onDeparted = jest.fn();

    render(<DepartureButton tripInstanceId={tripId} onDeparted={onDeparted} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmer le départ/i }));

    await waitFor(() => {
      expect(onDeparted).toHaveBeenCalledTimes(1);
    });
    expect(typeof onDeparted.mock.calls[0][0]).toBe('string'); // ISO string
  });

  // ─── Machine à états : confirming → loading → error ─────────────────────────

  it('passe en état "error" si le POST échoue (HTTP 500)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Erreur serveur interne' }),
    });

    render(<DepartureButton tripInstanceId={tripId} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmer le départ/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('Erreur serveur interne')).toBeInTheDocument();
  });

  it('passe en état "error" en cas d\'erreur réseau', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<DepartureButton tripInstanceId={tripId} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmer le départ/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/erreur réseau/i)).toBeInTheDocument();
  });

  it('revient à l\'état idle en cliquant "Réessayer" après erreur', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    render(<DepartureButton tripInstanceId={tripId} />);
    await userEvent.click(screen.getByRole('button', { name: /signaler le départ/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmer le départ/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(screen.getByRole('button', { name: /signaler le départ/i })).toBeInTheDocument();
  });
});

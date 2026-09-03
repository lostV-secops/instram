/**
 * Tests pour WalkInForm — règles métier RG-02 (walk-in gratuit) et RG-03 (pas d'annulation).
 * Le composant charge les trajets via fetch au montage — on mock global.fetch.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalkInForm } from '@/components/coop/WalkInForm';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockTrip = {
  id: 'trip-1',
  routeId: 'route-1',
  departureAt: '2024-06-01T08:00:00Z',
  status: 'OPEN_FOR_BOOKING',
  routeName: 'Tana → Tamatave',
};

const mockSeat = {
  seatDefinitionId: 's1',
  code: 'A1',
  category: 'CLASSIC',
  status: 'AVAILABLE',
  priceMga: 15000,
  row: 1,
  column: 1,
};

function makeTripsResponse(trips = [mockTrip]) {
  return { ok: true, json: async () => ({ items: trips }) };
}

function makeSeatsResponse(seats = [mockSeat]) {
  return { ok: true, json: async () => ({ seats }) };
}

beforeEach(() => {
  mockFetch.mockReset();
  // Réponse par défaut : liste de trajets vide (chargement rapide)
  mockFetch.mockResolvedValue(makeTripsResponse([]));
});

describe('WalkInForm — RG-02 : walk-in gratuit', () => {
  it('affiche le bandeau RG-02 immédiatement (avant même la fin du chargement)', () => {
    // Fetch qui ne résout jamais — on teste que le bandeau est présent pendant le chargement
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<WalkInForm />);
    expect(screen.getByText(/RG-02/i)).toBeInTheDocument();
  });

  it('affiche "aucune commission" dans le bandeau RG-02', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<WalkInForm />);
    expect(screen.getByText(/aucune commission/i)).toBeInTheDocument();
  });

  it('affiche "Chargement des trajets..." pendant le chargement', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<WalkInForm />);
    expect(screen.getByText(/chargement des trajets/i)).toBeInTheDocument();
  });

  it('appelle /api/proxy/v1/coop/trips au montage', async () => {
    render(<WalkInForm />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/proxy/v1/coop/trips'),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('n\'affiche pas de bouton "Annuler" (RG-03 — zéro annulation dans l\'app)', async () => {
    // On attend la fin du chargement (liste vide)
    render(<WalkInForm />);
    await waitFor(() => {
      expect(screen.queryByText(/chargement des trajets/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /annul/i })).toBeNull();
  });

  it('affiche le select de trajet après chargement', async () => {
    mockFetch.mockResolvedValueOnce(makeTripsResponse([mockTrip]));
    render(<WalkInForm />);
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /Tana/i })).toBeInTheDocument();
  });

  it('affiche le bouton "Charger les sièges" après sélection d\'un trajet', async () => {
    mockFetch.mockResolvedValueOnce(makeTripsResponse([mockTrip]));
    render(<WalkInForm />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole('combobox'), 'trip-1');

    expect(screen.getByRole('button', { name: /charger les sièges/i })).toBeInTheDocument();
  });

  it('charge les sièges puis affiche le bouton submit avec variant=action', async () => {
    mockFetch
      .mockResolvedValueOnce(makeTripsResponse([mockTrip]))  // trajets
      .mockResolvedValueOnce(makeSeatsResponse([mockSeat])); // sièges

    render(<WalkInForm />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole('combobox'), 'trip-1');
    await userEvent.click(screen.getByRole('button', { name: /charger les sièges/i }));

    // Cliquer sur le siège pour l'activer
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('A1'));

    // Le bouton submit apparaît avec variant=action (bg-action)
    const submitBtn = await screen.findByRole('button', { name: /enregistrer/i });
    expect(submitBtn).toHaveClass('bg-action');
  });

  it('envoie POST /api/proxy/v1/coop/bookings/walk-in avec tripInstanceId et seatDefinitionIds', async () => {
    mockFetch
      .mockResolvedValueOnce(makeTripsResponse([mockTrip]))
      .mockResolvedValueOnce(makeSeatsResponse([mockSeat]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reference: 'WI-001' }) });

    render(<WalkInForm />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole('combobox'), 'trip-1');
    await userEvent.click(screen.getByRole('button', { name: /charger les sièges/i }));

    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await userEvent.click(screen.getByText('A1'));

    // Remplir les champs obligatoires (prénom et nom)
    const inputs = screen.getAllByRole('textbox');
    const prenomInput = inputs.find((el) => (el as HTMLInputElement).autocomplete === 'given-name' || el.getAttribute('autocomplete') === 'given-name');
    const nomInput = inputs.find((el) => el.getAttribute('autocomplete') === 'family-name');

    if (prenomInput) await userEvent.type(prenomInput, 'Jean');
    if (nomInput) await userEvent.type(nomInput, 'Rakoto');

    // Soumettre
    const submitBtn = screen.getByRole('button', { name: /enregistrer/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('/coop/bookings/walk-in'),
      );
      expect(postCall).toBeDefined();
      if (postCall) {
        const body = JSON.parse(postCall[1].body);
        expect(body.tripInstanceId).toBe('trip-1');
        expect(body.seatDefinitionIds).toContain('s1');
      }
    });
  });
});

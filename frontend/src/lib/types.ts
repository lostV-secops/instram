// Types TypeScript correspondant aux schémas du contrat-api.yaml

export type Lang = 'fr' | 'mg';

export type SeatCategory = 'VIP' | 'PREMIUM' | 'CLASSIC' | 'STANDARD';
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD';
export type SeatDisplayStatus = SeatStatus | 'HELD_BY_ME';

export type BookingStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PAYMENT_EXPIRED'
  | 'PAYMENT_FAILED'
  | 'CANCELLED_AT_COUNTER'
  | 'COMPLETED'
  | 'NO_SHOW';

export type BookingChannel = 'ONLINE' | 'WALK_IN';
export type BoardingStatus = 'NOT_BOARDED' | 'BOARDED' | 'ABSENT';

export type PaymentProvider = 'MVOLA' | 'ORANGE_MONEY' | 'AIRTEL_MONEY' | 'CASH';
export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED_AT_COUNTER';

export type TripStatus =
  | 'DRAFT'
  | 'OPEN_FOR_BOOKING'
  | 'CLOSED_FOR_BOOKING'
  | 'DEPARTED'
  | 'COMPLETED'
  | 'CANCELLED';

export type CooperativeStatus =
  | 'PENDING_VALIDATION'
  | 'VALIDATED'
  | 'SUSPENDED'
  | 'REJECTED';

// ─── Catalog ─────────────────────────────────────────────────────────────────
export interface City {
  id: string;
  code: string;
  name: string;
  district: string;
  region: string;
}

export interface CityList {
  items: City[];
  nextCursor: string | null;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export interface Me {
  id: string;
  email: string | null;
  phone: string | null;
  preferredLang: Lang;
  roles: string[];
  cooperatives: Array<{
    id: string;
    displayName: string;
    role: string;
  }>;
  traveler: {
    firstName: string;
    lastName: string;
    mobileMoneyPhone: string | null;
  } | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Me;
}

// ─── Cooperative ──────────────────────────────────────────────────────────────
export interface Cooperative {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  status: CooperativeStatus;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  description: string | null;
  ratingAverage: number;
  ratingCount: number;
}

// ─── Route / Trip ─────────────────────────────────────────────────────────────
export interface Route {
  id: string;
  originCity: City;
  destinationCity: City;
  estimatedDurationMin?: number;
}

export interface Fare {
  category: SeatCategory;
  priceMga: number;
}

export interface Policy {
  textFr: string;
  textMg: string;
}

export interface Vehicle {
  id: string;
  model: string | null;
  capacity: number;
  plate?: string;
}

export interface TripInstanceDetail {
  id: string;
  cooperative: Cooperative;
  route: Route;
  vehicle: Vehicle;
  departureAt: string;
  arrivalEstimatedAt: string | null;
  status: TripStatus;
  policy: Policy | null;
  fares: Fare[];
}

// ─── Search ───────────────────────────────────────────────────────────────────
export interface TripSearchResult {
  tripInstanceId: string;
  cooperative: {
    id: string;
    displayName: string;
    ratingAverage: number;
    ratingCount: number;
  };
  route: {
    originCity: City;
    destinationCity: City;
    estimatedDurationMin: number;
  };
  departureAt: string;
  arrivalEstimatedAt: string | null;
  fareMinMga: number;
  fareMaxMga: number;
  seatsAvailable: number;
  vehicle: {
    model: string | null;
    capacity: number;
  };
}

export interface TripSearchResponse {
  items: TripSearchResult[];
  nextCursor: string | null;
}

// ─── Seats ────────────────────────────────────────────────────────────────────
export interface Seat {
  seatDefinitionId: string;
  code: string;
  category: SeatCategory;
  row: number | null;
  column: number | null;
  status: SeatDisplayStatus;
  priceMga: number;
}

export interface TripSeatMap {
  tripInstanceId: string;
  layout: Record<string, unknown>;
  seats: Seat[];
}

export interface SeatHoldResponse {
  holdId: string;
  tripInstanceId: string;
  seats: Array<{
    seatDefinitionId: string;
    code: string;
    priceMga: number;
  }>;
  expiresAt: string;
}

export interface SeatConflictResponse {
  code: 'SEAT_UNAVAILABLE';
  message: string;
  conflictingSeats: Array<{
    seatDefinitionId: string;
    code: string;
    status: 'HELD' | 'SOLD';
  }>;
}

// ─── Bookings ─────────────────────────────────────────────────────────────────
export interface PassengerRequest {
  firstName: string;
  lastName: string;
  phone?: string;
  nationalIdRef?: string;
  seatCode: string;
}

export interface Booking {
  id: string;
  reference: string;
  status: BookingStatus;
  channel: BookingChannel;
  totalAmountMga: number;
  seatSubtotalMga: number;
  platformFeeMga: number;
  tripInstanceId: string;
  createdAt: string;
  buyer?: { phone: string; email: string | null; firstName: string | null; lastName: string | null } | null;
  tripInstance?: { departureAt: string; route: { origin: string; destination: string } } | null;
}

export interface BookingList {
  items: Booking[];
  nextCursor: string | null;
}

export interface Ticket {
  reference: string;
  qrPayload: string;
  qrImageUrl: string;
  issuedAt: string;
}

export interface Payment {
  id: string;
  bookingId: string;
  provider: PaymentProvider;
  amountMga: number;
  status: PaymentStatus;
  providerTransactionId: string | null;
  initiatedAt: string;
  confirmedAt: string | null;
}

export interface BookingDetail extends Booking {
  trip: TripInstanceDetail;
  passengers: Array<{
    firstName: string;
    lastName: string;
    seatCode: string;
    boardingStatus: BoardingStatus;
  }>;
  payments: Payment[];
  ticket: Ticket | null;
  canRate: boolean;
  hasRated: boolean;
}

// ─── Directory (annuaire public) ─────────────────────────────────────────────
// Endpoints : GET /v1/directory/cooperatives
//             GET /v1/directory/cooperatives/{slug}
// Source : docs/contrat-api.yaml — schemas DirectoryEntry, DirectoryEntryDetail
// Note : RatingStatus et Rating sont définis plus bas (section admin/ratings).

/** Entrée dans l'annuaire public (schema DirectoryEntry) */
export interface DirectoryEntry {
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  /** Régions desservies (ex. ["Analamanga", "Vakinankaratra"]) */
  regionsServed: string[];
  ratingAverage: number;
  ratingCount: number;
}

/** Ligne desservie dans la fiche détail */
export interface DirectoryRoute {
  displayName: string;
  originCity: City;
  destinationCity: City;
}

/** Fiche détail d'une coopérative (schema DirectoryEntryDetail) */
export interface DirectoryEntryDetail extends DirectoryEntry {
  routes: DirectoryRoute[];
  /** Politique d'annulation — utilise CoopPolicy défini plus bas */
  policy: CoopPolicy | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

// ─── Paiement ─────────────────────────────────────────────────────────────────
export interface PaymentInitiation {
  paymentId: string;
  status: PaymentStatus;
  instructions: {
    messageFr: string;
    messageMg: string;
    ussdCode: string | null;
    expiresAt: string;
  };
}

// ─── WebSocket events ─────────────────────────────────────────────────────────
export type WsEventType =
  | 'SEAT_HELD'
  | 'SEAT_SOLD'
  | 'SEAT_RELEASED'
  | 'DRIVER_BOARDING_UPDATE'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'BOOKING_CANCELLED'
  // Canaux driver (embarquement, départ) — noms d'événements du canal driver:{tripId}
  | 'BOARDING_CONFIRMED'
  | 'PASSENGER_BOARDED'
  | 'PASSENGER_ABSENT'
  | 'TRIP_DEPARTED';

export interface WsEvent {
  event: WsEventType;
  channel: string;
  payload: Record<string, unknown>;
}

// ─── Erreurs ──────────────────────────────────────────────────────────────────
export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

// ─── Driver — App conducteur ──────────────────────────────────────────────────

export interface DriverTripSummary {
  tripInstanceId: string;
  route: {
    origin: string;
    destination: string;
    originName?: string;
    destinationName?: string;
  };
  departureAt: string;
  vehicleRegistration?: string;
  passengersCount?: number;
  totalPassengers?: number;
  boardedCount: number;
  /** Extension optionnelle — peut être absent selon l'implémentation backend */
  status?: TripStatus;
}

export interface ManifestPassenger {
  bookingId: string;
  /** Référence réservation (contrat: bookingReference, backend actuel: reference) */
  bookingReference?: string;
  reference?: string;
  /** Prénom direct ou imbriqué dans passenger.firstName */
  firstName?: string;
  lastName?: string;
  passenger?: { firstName: string; lastName: string };
  seatCode: string;
  phone?: string | null;
  boardingStatus: BoardingStatus;
  channel?: BookingChannel;
  paymentMethod?: string;
}

export interface Manifest {
  tripInstanceId: string;
  departureAt?: string;
  passengers: ManifestPassenger[];
  totalPassengers?: number;
  boarded?: number;
  absent?: number;
  pending?: number;
}

export interface BoardingRequest {
  qrPayload?: string;
  bookingReference?: string;
}

export interface BoardingEvent {
  bookingId: string;
  reference: string;
  passenger: { firstName: string; lastName: string };
  seatCode: string;
  boardedAt: string;
}

export interface AbsenceEvent {
  id: string;
  bookingId: string;
  tripInstanceId: string;
  reason: string | null;
  markedAt: string;
}

/** Retour minimal du endpoint /driver/trips/:id/depart */
export interface TripInstanceStatus {
  id: string;
  status: TripStatus;
}

// ─── Coopérative — back-office ────────────────────────────────────────────────

export type CooperativeRole =
  | 'COOP_ADMIN'
  | 'COOP_ASSISTANT'
  | 'COOP_DRIVER'
  | 'COOP_CONTROLLER';

export interface Member {
  id: string;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  role: CooperativeRole;
  active: boolean;
  createdAt: string;
}

/** Route enrichie telle que retournée par GET /coop/routes */
export interface CoopRouteDetail {
  id: string;
  cooperativeId: string;
  displayName: string;
  originCity: City;
  destinationCity: City;
  distanceKm: number | null;
  estimatedDurationMin: number | null;
  isActive: boolean;
}

/** Instance de trajet (TripInstance) telle que retournée par GET /coop/trips */
export interface TripInstance {
  id: string;
  cooperativeId: string;
  routeId: string;
  scheduleId: string | null;
  vehicleId: string;
  departureAt: string;
  arrivalEstimatedAt: string | null;
  status: TripStatus;
  openedForBookingAt: string | null;
  route?: { originCity?: { nameFr: string; nameMg?: string }; destinationCity?: { nameFr: string; nameMg?: string } } | null;
}

export interface TripInstanceList {
  items: TripInstance[];
  nextCursor: string | null;
}

/** Détail d'un trajet avec statistiques — GET /coop/trips/{id} */
export interface TripInstanceCoopDetail extends TripInstanceDetail {
  stats: {
    seatsSold: number;
    seatsHeld: number;
    revenueMga: number;
  };
}

/** Tableau de bord coopérative — GET /coop/dashboard */
export interface CooperativeDashboard {
  periodStart: string;
  periodEnd: string;
  bookingsOnline: number;
  bookingsWalkIn: number;
  revenueGrossMga: number;
  revenueNetMga: number;
  occupancyRate: number;
  upcomingTrips: number;
}

export type ExportType = 'MANIFEST' | 'FINANCIAL_REPORT' | 'BOOKINGS' | 'RATINGS';
export type ExportJobStatus = 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';

export interface ExportJob {
  id: string;
  type: ExportType;
  format: string;
  status: ExportJobStatus;
  resultUrl: string | null;
  downloadUrl?: string | null;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CoopVehicle {
  id: string;
  cooperativeId: string;
  registration: string;
  displayName: string;
  model: string | null;
  capacity: number;
  isActive: boolean;
}

export interface SeatDefinition {
  id: string;
  code: string;
  category: SeatCategory;
  row: number | null;
  column: number | null;
}

export interface CoopVehicleDetail extends CoopVehicle {
  createdAt: string;
  updatedAt: string;
  seatMap: {
    id: string;
    name: string;
    capacity: number;
    layout: { rows: number; cols: number };
    seats: SeatDefinition[];
  };
}

// ─── Admin — Console InsTRAM ─────────────────────────────────────────────────

export type AdminRole = 'ADMIN_SUPER' | 'ADMIN_OPS' | 'ADMIN_MODERATOR';

export interface AdminDashboard {
  cooperativesActive: number;
  cooperativesPending: number;
  bookingsToday: number;
  revenueToday: number;
  platformFeeToday: number;
  incidents: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
}

export type AdminUserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface AdminUserSummary {
  id: string;
  email: string | null;
  phone: string | null;
  status: AdminUserStatus;
  roles: string[];
  createdAt: string;
}

export type RatingStatus = 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED';

export interface Rating {
  id: string;
  bookingId: string;
  cooperativeId: string;
  score: number;
  /** Backend renvoie commentFr/commentMg, pas comment */
  commentFr?: string | null;
  commentMg?: string | null;
  comment?: string | null;
  status: RatingStatus;
  createdAt: string;
}

/** Politique d'annulation enrichie (coop back-office) */
export interface CoopPolicy {
  id: string;
  titleFr: string;
  titleMg: string;
  bodyFr: string;
  bodyMg: string;
  version: number;
  isActive: boolean;
}

// ─── Plans tarifaires coopérative ─────────────────────────────────────────────
export type PricingPlanType = 'COMMISSION' | 'SUBSCRIPTION';

export interface CoopPricingPlan {
  id: string;
  cooperativeId: string;
  type: PricingPlanType;
  commissionRate: number | null;
  monthlyFeeMga: number | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  createdAt: string;
}

// ─── Abonnements coopérative ──────────────────────────────────────────────────
export type SubscriptionStatus = 'MANUAL' | 'PAID';

export interface CoopSubscription {
  id: string;
  cooperativeId: string;
  periodStart: string;
  periodEnd: string;
  amountMga: number;
  status: SubscriptionStatus;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

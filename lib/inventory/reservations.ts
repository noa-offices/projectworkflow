import { canManageInventory } from './access';
type ReservationState = { status: string; expires_at: string | null; quantity: number };
export function isActiveReservation(reservation: ReservationState, now = new Date()): boolean {
 return reservation.status === 'active' && (!reservation.expires_at || new Date(reservation.expires_at).getTime() > now.getTime());
}
export function reservationTotals(quantity: number, reservations: readonly ReservationState[], now = new Date()) {
 const reserved_quantity = reservations.filter(row => isActiveReservation(row, now)).reduce((sum,row) => sum + row.quantity,0);
 return { reserved_quantity, available_quantity: quantity - reserved_quantity };
}
export function canReleaseReservation(role: string | null | undefined, userId: string | null | undefined, creatorId: string | null) {
 return canManageInventory(role) || Boolean(userId && userId === creatorId);
}

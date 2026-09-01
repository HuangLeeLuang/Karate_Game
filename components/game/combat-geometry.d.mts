export type AttackLevel = 'HIGH' | 'MID' | 'LOW';
export interface CombatRect { x: number; y: number; w: number; h: number }

export const ATTACK_LEVELS: readonly AttackLevel[];
export const HURTBOX_OFFSETS: Record<'standing' | 'crouching', Record<AttackLevel, CombatRect>>;
export const MELEE_HITBOX_OFFSETS: Record<AttackLevel, Pick<CombatRect, 'y' | 'h'>>;
export const PLAYER_MELEE_REACH_BONUS: Record<'PUNCH' | 'KICK', number>;
export const PROJECTILE_Y_OFFSETS: Record<AttackLevel, number>;
export function rectsOverlap(a: CombatRect, b: CombatRect): boolean;
export function translatedRect(originX: number, baseY: number, offset: CombatRect): CombatRect;
export function overlappingLevels(box: CombatRect, hurtboxes: Record<AttackLevel, CombatRect>): AttackLevel[];

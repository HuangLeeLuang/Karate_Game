export const ATTACK_LEVELS = ['HIGH', 'MID', 'LOW'];

export const HURTBOX_OFFSETS = {
  standing: {
    HIGH: { x: -29, y: -320, w: 58, h: 88 },
    MID: { x: -43, y: -232, w: 86, h: 134 },
    LOW: { x: -38, y: -98, w: 76, h: 98 },
  },
  crouching: {
    HIGH: { x: -27, y: -190, w: 54, h: 56 },
    MID: { x: -42, y: -134, w: 84, h: 64 },
    LOW: { x: -38, y: -70, w: 76, h: 70 },
  },
};

export const MELEE_HITBOX_OFFSETS = {
  HIGH: { y: -304, h: 70 },
  MID: { y: -134, h: 31 },
  LOW: { y: -70, h: 38 },
};

export const PROJECTILE_Y_OFFSETS = {
  HIGH: -270,
  MID: -120,
  LOW: -54,
};

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function translatedRect(originX, baseY, offset) {
  return {
    x: originX + offset.x,
    y: baseY + offset.y,
    w: offset.w,
    h: offset.h,
  };
}

export function overlappingLevels(box, hurtboxes) {
  return ATTACK_LEVELS.filter((level) => rectsOverlap(box, hurtboxes[level]));
}

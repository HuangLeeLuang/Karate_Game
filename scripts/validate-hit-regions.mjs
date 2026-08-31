import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ATTACK_LEVELS,
  HURTBOX_OFFSETS,
  MELEE_HITBOX_OFFSETS,
  PROJECTILE_Y_OFFSETS,
  overlappingLevels,
  translatedRect,
} from '../components/game/combat-geometry.mjs';

const attacks = JSON.parse(
  await readFile(new URL('../public/game-data/attacks.json', import.meta.url), 'utf8'),
);
const groundY = 620;
const attackerX = 400;
const defenderX = 500;
const hurtboxesByStance = Object.fromEntries(
  Object.entries(HURTBOX_OFFSETS).map(([stance, offsets]) => [
    stance,
    Object.fromEntries(
      ATTACK_LEVELS.map((level) => [
        level,
        translatedRect(defenderX, groundY, offsets[level]),
      ]),
    ),
  ]),
);

for (const attack of attacks) {
  let hitbox;
  if (attack.attackType === 'GUN') {
    hitbox = {
      x: defenderX - 13,
      y: groundY + PROJECTILE_Y_OFFSETS[attack.attackLevel] - 8,
      w: 26,
      h: 16,
    };
  } else {
    const geometry = MELEE_HITBOX_OFFSETS[attack.attackLevel];
    const extension = attack.range + (attack.attackType === 'KICK' ? 26 : 10);
    hitbox = {
      x: attackerX + 22,
      y: groundY + geometry.y,
      w: extension,
      h: geometry.h,
    };
  }

  for (const [stance, hurtboxes] of Object.entries(hurtboxesByStance)) {
    const levels = overlappingLevels(hitbox, hurtboxes);
    const expected = stance === 'crouching' && attack.attackLevel === 'HIGH'
      ? []
      : [attack.attackLevel];
    assert.deepEqual(
      levels,
      expected,
      `${attack.name} (${attack.id}) ${stance} expected ${expected.join(', ') || 'a clean miss'}, got ${levels.join(', ') || 'no region'}`,
    );
  }
  console.log(
    `✓ ${attack.name.padEnd(5)} ${attack.attackType.padEnd(5)} → ${attack.attackLevel} (standing / crouching)`,
  );
}

const highPunch = attacks.find((attack) => attack.id === 'punch-high');
assert.ok(highPunch, 'Expected punch-high attack data');
const highPunchDistance = 128;
const highPunchDefenderX = attackerX + highPunchDistance;
const highPunchGeometry = MELEE_HITBOX_OFFSETS.HIGH;
const highPunchBox = {
  x: attackerX + 22,
  y: groundY + highPunchGeometry.y,
  w: highPunch.range + 10,
  h: highPunchGeometry.h,
};
const highPunchTarget = Object.fromEntries(
  ATTACK_LEVELS.map((level) => [
    level,
    translatedRect(highPunchDefenderX, groundY, HURTBOX_OFFSETS.standing[level]),
  ]),
);
assert.deepEqual(
  overlappingLevels(highPunchBox, highPunchTarget),
  ['HIGH'],
  `Upper punch should reach a standing opponent at ${highPunchDistance}px`,
);
console.log(`✓ 上段拳 reaches a standing opponent at ${highPunchDistance}px`);

console.log(`Validated ${attacks.length} attacks across HIGH / MID / LOW regions and both stances.`);

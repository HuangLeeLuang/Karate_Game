'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Bug,
  Crosshair,
  Download,
  HeartPulse,
  Play,
  RotateCcw,
  ShoppingCart,
  Smartphone,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ATTACK_LEVELS,
  HURTBOX_OFFSETS,
  MELEE_HITBOX_OFFSETS,
  PLAYER_GUN_MUZZLE_OFFSETS,
  PLAYER_MELEE_REACH_BONUS,
  PROJECTILE_Y_OFFSETS,
  overlappingLevels,
  rectsOverlap,
  translatedRect,
} from './combat-geometry.mjs';

const WIDTH = 1280;
const HEIGHT = 720;
const GROUND_Y = 620;
const FIGHTER_STAGE_MARGIN = 248;
const FPS = 60;

type AttackLevel = 'HIGH' | 'MID' | 'LOW';
type AttackType = 'PUNCH' | 'KICK' | 'GUN';
type AttackPhase = 'STARTUP' | 'ACTIVE' | 'RECOVERY' | null;
type GameStatus = 'LOADING' | 'READY' | 'FIGHTING' | 'KO' | 'PAUSED' | 'ERROR';
type Direction = -1 | 1;
type PlayerCharacter = 'fio' | 'kai';
type JourneyPhase =
  | 'TRAVEL'
  | 'COMBAT'
  | 'CLEAR'
  | 'CHECKPOINT'
  | 'SHOP'
  | 'COMPLETE';

interface AttackData {
  id: string;
  name: string;
  input: string;
  attackType: AttackType;
  attackLevel: AttackLevel;
  startupFrames: number;
  activeFrames: number;
  recoveryFrames: number;
  range: number;
  damage: number;
  staminaCost: number;
  hitStunFrames: number;
  blockStunFrames: number;
  knockback: number;
  canTriggerGrapple: boolean;
  projectile?: boolean;
  projectileSpeed?: number;
}

interface AIData {
  id: string;
  name: string;
  archetype: string;
  description: string;
  accent: string;
  preferredMinRange: number;
  preferredMaxRange: number;
  aggression: number;
  defense: number;
  counterRate: number;
  grappleRate: number;
  highAttackRate: number;
  midAttackRate: number;
  lowAttackRate: number;
  punchRate: number;
  kickRate: number;
  retreatRate: number;
  reactionFrames: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AttackRuntime {
  data: AttackData;
  frame: number;
  hitResolved: boolean;
  startupMultiplier: number;
  recoveryMultiplier: number;
}

interface Impact {
  x: number;
  y: number;
  life: number;
  color: string;
}

interface Banner {
  text: string;
  subtext?: string;
  color: string;
  life: number;
}

interface GrappleState {
  timer: number;
  playerChoice: Direction | null;
  aiChoice: Direction;
}

interface Projectile {
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  previousX: number;
  velocityX: number;
  lifetime: number;
  data: AttackData;
}

interface JourneyView {
  encounter: number;
  total: number;
  ammo: number;
  cash: number;
  energyDrinks: number;
  minionsDefeated: number;
  phase: JourneyPhase;
  complete: boolean;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface World {
  player: Fighter;
  enemy: Fighter;
  attacks: AttackData[];
  meleeAttackByInput: Map<string, AttackData>;
  gunAttackByInput: Map<string, AttackData>;
  ais: AIData[];
  ai: AIData;
  aiIndex: number;
  stage: HTMLImageElement;
  actionSheet: HTMLImageElement;
  playerReactionSheet: HTMLImageElement;
  enemySheets: HTMLImageElement[];
  playerGuardSheet: HTMLImageElement;
  maleActionSheet: HTMLImageElement;
  gunSheets: Record<PlayerCharacter, HTMLImageElement>;
  walkSheets: Record<PlayerCharacter, HTMLImageElement>;
  status: GameStatus;
  previousStatus: GameStatus;
  keys: Set<string>;
  justPressed: Set<string>;
  grapple: GrappleState | null;
  projectiles: Projectile[];
  impacts: Impact[];
  banner: Banner | null;
  aiDecisionTimer: number;
  aiRetreatTimer: number;
  playerCharacter: PlayerCharacter;
  encounterIndex: number;
  encounterTotal: number;
  journeyPhase: JourneyPhase;
  phaseTimer: number;
  stageScroll: number;
  animationTime: number;
  ammo: number;
  maxAmmo: number;
  cash: number;
  energyDrinks: number;
  minionsDefeated: number;
  encounterResolved: boolean;
  matchOver: boolean;
  hitStop: number;
  shake: number;
  debug: boolean;
  showBoxes: boolean;
  sound: boolean;
  gunMode: boolean;
  audio: AudioContext | null;
  lastTime: number;
  frameHandle: number;
  onStatus: (status: GameStatus) => void;
  onGunMode: (enabled: boolean) => void;
  onAIChange: (index: number) => void;
  onJourneyChange: (journey: JourneyView) => void;
}

const levelIndex: Record<AttackLevel, number> = { HIGH: 0, MID: 1, LOW: 2 };
const PLAYER_ACTION_SIZE = 382;
const PLAYER_REACTION_SIZE = 448;
const PLAYER_GUARD_SIZE = 420;
const PLAYER_GUN_SIZE = 359;
const PLAYER_GUN_GROUND_OFFSET = 3;
const PLAYER_WALK_SIZE = 405;
const ENEMY_ACTION_SIZES = [372, 367, 375] as const;
const ENEMY_FRAME_RECTS = [
  [
    [132, 15, 192, 289],
    [538, 16, 257, 287],
    [990, 19, 234, 285],
    [1370, 106, 298, 196],
    [105, 326, 264, 253],
    [518, 320, 279, 260],
    [963, 412, 279, 161],
    [1419, 328, 187, 250],
    [127, 598, 188, 256],
    [559, 615, 164, 238],
    [1019, 667, 153, 186],
    [1365, 753, 304, 105],
  ],
  [
    [112, 11, 201, 331],
    [449, 13, 321, 327],
    [895, 25, 305, 315],
    [1260, 124, 331, 218],
    [94, 358, 276, 294],
    [468, 353, 286, 298],
    [869, 454, 357, 191],
    [1359, 342, 171, 306],
    [56, 662, 267, 245],
    [454, 676, 196, 232],
    [912, 708, 183, 202],
    [1227, 792, 415, 125],
  ],
  [
    [141, 17, 214, 317],
    [543, 17, 310, 315],
    [942, 32, 297, 302],
    [1377, 134, 278, 198],
    [112, 343, 260, 264],
    [531, 337, 265, 272],
    [912, 421, 333, 188],
    [1365, 377, 278, 234],
    [154, 627, 224, 229],
    [558, 644, 200, 212],
    [937, 665, 297, 190],
    [1323, 729, 353, 128],
  ],
] as const;
const PLAYER_ACTION_GROUND_OFFSETS = [15, 17, 16, 18, 37, 36, 34, 32] as const;
const PLAYER_REACTION_GROUND_OFFSETS = [35, 34, 35, 37] as const;
const PLAYER_GUARD_GROUND_OFFSETS = [25, 31, 28, 31] as const;
const PLAYER_FRAME_RECTS = [
  [149, 16, 207, 412],
  [528, 26, 278, 398],
  [955, 37, 279, 388],
  [1320, 149, 342, 274],
  [91, 456, 299, 388],
  [514, 452, 314, 393],
  [966, 600, 335, 247],
  [1322, 460, 346, 390],
] as const;
const attackInputByLevel: Record<
  'PUNCH' | 'KICK' | 'GUN',
  Record<AttackLevel, string>
> = {
  PUNCH: { HIGH: 'q', MID: 'a', LOW: 'z' },
  KICK: { HIGH: 'w', MID: 's', LOW: 'x' },
  GUN: { HIGH: 'q', MID: 'a', LOW: 'z' },
};
const MINION_TOTAL = 10;
const ENCOUNTER_TOTAL = MINION_TOTAL + 1;
const ENCOUNTER_HP = [26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 100] as const;
const FIO_ENEMY_ROSTER = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2] as const;
const KAI_ENEMY_ROSTER = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 2] as const;
const MINION_REWARD = 10;
const ENERGY_DRINK_COST = 20;
const ENERGY_DRINK_HEAL = 35;
const AMMO_PACK_COST = 20;
const AMMO_PACK_SIZE = 6;
const PLAYER_NAMES: Record<PlayerCharacter, string> = {
  fio: 'FIO // 白閃',
  kai: 'KAI // 瞬拳',
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

class Fighter {
  readonly id: 'player' | 'enemy';
  displayName: string;
  x: number;
  direction: Direction;
  hp = 100;
  stamina = 100;
  state = 'IDLE';
  crouching = false;
  moveIntent = 0;
  attack: AttackRuntime | null = null;
  stunFrames = 0;

  constructor(
    id: 'player' | 'enemy',
    displayName: string,
    x: number,
    direction: Direction,
  ) {
    this.id = id;
    this.displayName = displayName;
    this.x = x;
    this.direction = direction;
  }

  reset(x: number, direction: Direction) {
    this.x = x;
    this.direction = direction;
    this.hp = 100;
    this.stamina = 100;
    this.state = 'IDLE';
    this.crouching = false;
    this.moveIntent = 0;
    this.attack = null;
    this.stunFrames = 0;
  }

  get busy() {
    return (
      Boolean(this.attack) ||
      this.stunFrames > 0 ||
      this.state === 'GRAPPLE' ||
      this.state === 'KNOCKDOWN'
    );
  }

  get phase(): AttackPhase {
    if (!this.attack) return null;
    const { data, frame, startupMultiplier, recoveryMultiplier } = this.attack;
    const startup = data.startupFrames * startupMultiplier;
    const activeEnd = startup + data.activeFrames;
    const recoveryEnd = activeEnd + data.recoveryFrames * recoveryMultiplier;
    if (frame < startup) return 'STARTUP';
    if (frame < activeEnd) return 'ACTIVE';
    if (frame < recoveryEnd) return 'RECOVERY';
    return null;
  }

  get attackProgress() {
    if (!this.attack) return 0;
    const data = this.attack.data;
    const total =
      data.startupFrames * this.attack.startupMultiplier +
      data.activeFrames +
      data.recoveryFrames * this.attack.recoveryMultiplier;
    return clamp(this.attack.frame / total, 0, 1);
  }

  get guardLevel(): AttackLevel | null {
    if (!this.state.startsWith('GUARD_')) return null;
    const level = this.state.slice('GUARD_'.length) as AttackLevel;
    return ATTACK_LEVELS.includes(level) ? level : null;
  }

  beginAttack(data: AttackData) {
    if (this.busy || this.stamina < data.staminaCost) return false;
    const exhausted = this.stamina < 20;
    this.stamina = Math.max(0, this.stamina - data.staminaCost);
    this.attack = {
      data,
      frame: 0,
      hitResolved: false,
      startupMultiplier: exhausted ? 1.1 : 1,
      recoveryMultiplier: exhausted ? 1.15 : 1,
    };
    this.crouching = false;
    this.state = `${data.attackType}_${data.attackLevel}`;
    return true;
  }

  update(dt: number) {
    const frames = dt * FPS;
    if (this.stunFrames > 0) {
      this.stunFrames = Math.max(0, this.stunFrames - frames);
      if (this.stunFrames === 0) {
        this.state = 'IDLE';
        this.attack = null;
      }
      return;
    }

    if (this.attack) {
      this.attack.frame += frames;
      if (this.phase === null) {
        this.attack = null;
        this.state = 'IDLE';
      }
      return;
    }

    const exhausted = this.stamina < 20;
    const speed = this.moveIntent > 0 ? 180 : 155;
    if (!this.crouching && this.moveIntent !== 0) {
      this.x += this.moveIntent * speed * (exhausted ? 0.9 : 1) * dt;
      this.state =
        this.moveIntent === this.direction ? 'MOVE_FORWARD' : 'MOVE_BACKWARD';
    } else if (this.crouching) {
      this.state = 'CROUCH';
    } else {
      this.state = 'IDLE';
    }

    this.stamina = Math.min(
      100,
      this.stamina + (this.crouching ? 15 : 22) * dt,
    );
  }

  hurtboxes(): Record<AttackLevel, Rect> {
    const stance = this.crouching ? 'crouching' : 'standing';
    return Object.fromEntries(
      ATTACK_LEVELS.map((level) => [
        level,
        translatedRect(this.x, GROUND_Y, HURTBOX_OFFSETS[stance][level]),
      ]),
    ) as Record<AttackLevel, Rect>;
  }

  attackBox(): Rect | null {
    if (!this.attack || this.phase !== 'ACTIVE') return null;
    const { data } = this.attack;
    if (data.attackType === 'GUN') return null;
    const geometry = MELEE_HITBOX_OFFSETS[data.attackLevel];
    const playerReachBonus =
      this.id === 'player' ? PLAYER_MELEE_REACH_BONUS[data.attackType] : 0;
    const extension =
      data.range + (data.attackType === 'KICK' ? 26 : 10) + playerReachBonus;
    return {
      x: this.direction === 1 ? this.x + 22 : this.x - 22 - extension,
      y: GROUND_Y + geometry.y,
      w: extension,
      h: geometry.h,
    };
  }

  canAutoGuard(level: AttackLevel) {
    if (this.busy) return false;
    return this.crouching ? level !== 'HIGH' : level !== 'LOW';
  }

  receiveHit(
    data: AttackData,
    direction: Direction,
    counter: boolean,
    guarded: boolean,
  ) {
    if (guarded) {
      this.hp = Math.max(
        0,
        this.hp - Math.max(1, Math.round(data.damage * 0.18)),
      );
      this.stamina = Math.max(0, this.stamina - data.staminaCost * 0.55);
      this.stunFrames = data.blockStunFrames;
      this.state = `GUARD_${data.attackLevel}`;
      this.x += direction * data.knockback * 0.25;
      return;
    }

    const multiplier = counter ? 1.5 : 1;
    this.hp = Math.max(0, this.hp - Math.round(data.damage * multiplier));
    this.stunFrames = data.hitStunFrames + (counter ? 6 : 0);
    this.state = `HIT_${data.attackLevel}`;
    this.attack = null;
    this.crouching = false;
    this.x += direction * data.knockback * (counter ? 1.35 : 1);
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function playTone(
  world: World,
  frequency: number,
  duration = 0.06,
  gain = 0.04,
) {
  if (!world.sound || !world.audio) return;
  const oscillator = world.audio.createOscillator();
  const volume = world.audio.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(frequency, world.audio.currentTime);
  volume.gain.setValueAtTime(gain, world.audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(
    0.0001,
    world.audio.currentTime + duration,
  );
  oscillator.connect(volume).connect(world.audio.destination);
  oscillator.start();
  oscillator.stop(world.audio.currentTime + duration);
}

function setStatus(world: World, status: GameStatus) {
  if (world.status === status) return;
  world.status = status;
  world.onStatus(status);
}

function emitJourney(world: World) {
  world.onJourneyChange({
    encounter: Math.min(world.encounterIndex + 1, world.encounterTotal),
    total: world.encounterTotal,
    ammo: world.ammo,
    cash: world.cash,
    energyDrinks: world.energyDrinks,
    minionsDefeated: world.minionsDefeated,
    phase: world.journeyPhase,
    complete: world.matchOver,
  });
}

function consumeEnergyDrink(world: World) {
  if (world.energyDrinks <= 0 || world.player.hp >= 100 || world.matchOver)
    return;
  const recovered = Math.min(ENERGY_DRINK_HEAL, 100 - world.player.hp);
  world.energyDrinks -= 1;
  world.player.hp += recovered;
  world.banner = {
    text: `ENERGY +${recovered}`,
    subtext: `剩餘 ${world.energyDrinks} 罐`,
    color: '#4ade80',
    life: 1,
  };
  world.impacts.push({
    x: world.player.x,
    y: GROUND_Y - 150,
    life: 0.5,
    color: '#4ade80',
  });
  emitJourney(world);
  playTone(world, 660, 0.13, 0.04);
}

function enterShop(world: World) {
  if (world.journeyPhase !== 'CHECKPOINT') return;
  world.journeyPhase = 'SHOP';
  world.banner = null;
  emitJourney(world);
  playTone(world, 520, 0.09, 0.03);
}

function continueJourney(world: World) {
  if (world.journeyPhase !== 'CHECKPOINT' && world.journeyPhase !== 'SHOP')
    return;
  world.journeyPhase = 'TRAVEL';
  world.phaseTimer = 1.65;
  world.encounterResolved = false;
  world.banner = {
    text: 'ADVANCE',
    subtext: `下一戰 ${world.encounterIndex + 1}/${world.encounterTotal}`,
    color: '#67e8f9',
    life: 0.85,
  };
  emitJourney(world);
  playTone(world, 420, 0.08, 0.03);
}

function buyEnergyDrink(world: World) {
  if (world.journeyPhase !== 'SHOP' || world.cash < ENERGY_DRINK_COST) return;
  world.cash -= ENERGY_DRINK_COST;
  world.energyDrinks += 1;
  world.banner = {
    text: 'ENERGY DRINK +1',
    subtext: `現金 $${world.cash}`,
    color: '#4ade80',
    life: 0.9,
  };
  emitJourney(world);
  playTone(world, 740, 0.08, 0.03);
}

function buyAmmoPack(world: World) {
  if (world.journeyPhase !== 'SHOP' || world.cash < AMMO_PACK_COST) return;
  world.cash -= AMMO_PACK_COST;
  world.ammo += AMMO_PACK_SIZE;
  world.banner = {
    text: `AMMO +${AMMO_PACK_SIZE}`,
    subtext: `共 ${world.ammo} 發 // 現金 $${world.cash}`,
    color: '#22d3ee',
    life: 0.9,
  };
  emitJourney(world);
  playTone(world, 820, 0.08, 0.03);
}

function setGunMode(world: World, enabled: boolean) {
  if (enabled && world.ammo <= 0) {
    world.gunMode = false;
    world.onGunMode(false);
    world.banner = {
      text: 'NO AMMO',
      subtext: '射擊鍵已自動改回拳擊',
      color: '#fbbf24',
      life: 1.1,
    };
    return;
  }
  world.gunMode = enabled;
  world.onGunMode(enabled);
  world.banner = {
    text: enabled ? 'WEAPON READY' : 'BARE HANDS',
    subtext: enabled ? `Q 射擊 · 剩餘 ${world.ammo} 發` : 'Q 拳 · W 腳',
    color: enabled ? '#22d3ee' : '#fbbf24',
    life: 0.85,
  };
  playTone(world, enabled ? 620 : 330, 0.06, 0.03);
}

function toggleWeapon(world: World) {
  setGunMode(world, !world.gunMode);
}

function encounterAIIndex(world: World) {
  const roster =
    world.playerCharacter === 'kai' ? KAI_ENEMY_ROSTER : FIO_ENEMY_ROSTER;
  return roster[world.encounterIndex] ?? roster[roster.length - 1];
}

function beginEncounter(world: World) {
  const nextIndex = encounterAIIndex(world);
  const nextAI = world.ais[nextIndex] ?? world.ais[0];
  if (!nextAI) return;
  world.aiIndex = nextIndex;
  world.ai = nextAI;
  world.onAIChange(nextIndex);
  world.player.x = 350;
  world.player.direction = 1;
  world.player.moveIntent = 0;
  world.player.state = 'IDLE';
  world.enemy.reset(930, -1);
  world.enemy.hp = ENCOUNTER_HP[world.encounterIndex] ?? 100;
  world.journeyPhase = 'COMBAT';
  world.encounterResolved = false;
  world.aiDecisionTimer = 0.65;
  world.aiRetreatTimer = 0;
  const boss = world.encounterIndex === world.encounterTotal - 1;
  world.banner = {
    text: boss ? 'FINAL BOSS' : `ENEMY ${world.encounterIndex + 1}`,
    subtext: boss
      ? `${nextAI.name} // 決戰`
      : `${nextAI.name} // HP ${world.enemy.hp}`,
    color: boss ? '#fb7185' : '#ffe08a',
    life: 1.15,
  };
  emitJourney(world);
  playTone(world, boss ? 120 : 420, boss ? 0.22 : 0.1, boss ? 0.055 : 0.03);
}

function resetWorld(world: World) {
  world.encounterIndex = 0;
  world.encounterResolved = false;
  world.matchOver = false;
  world.journeyPhase = 'TRAVEL';
  world.phaseTimer = 1.75;
  world.stageScroll = 0;
  world.animationTime = 0;
  world.ammo = world.maxAmmo;
  world.cash = 0;
  world.energyDrinks = 0;
  world.minionsDefeated = 0;
  world.gunMode = false;
  world.onGunMode(false);
  world.player.displayName = PLAYER_NAMES[world.playerCharacter];
  world.player.reset(350, 1);
  world.enemy.reset(930, -1);
  world.enemy.hp = 0;
  world.grapple = null;
  world.projectiles = [];
  world.impacts = [];
  world.banner = {
    text: 'MOVE OUT',
    subtext: `${PLAYER_NAMES[world.playerCharacter]} // 前往最終決戰`,
    color: '#67e8f9',
    life: 1.1,
  };
  world.aiDecisionTimer = 0.45;
  world.aiRetreatTimer = 0;
  world.hitStop = 0;
  world.shake = 0;
  world.keys.clear();
  world.justPressed.clear();
  emitJourney(world);
  setStatus(world, 'FIGHTING');
  playTone(world, 420, 0.12, 0.035);
}

function selectPlayerCharacter(world: World, character: PlayerCharacter) {
  if (world.status === 'FIGHTING' || world.status === 'PAUSED') return;
  world.playerCharacter = character;
  world.player.displayName = PLAYER_NAMES[character];
  world.player.reset(350, 1);
  world.enemy.reset(930, -1);
  world.enemy.hp = 0;
  world.journeyPhase = 'TRAVEL';
  world.encounterIndex = 0;
  world.stageScroll = 0;
  world.animationTime = 0;
  world.ammo = world.maxAmmo;
  world.cash = 0;
  world.energyDrinks = 0;
  world.minionsDefeated = 0;
  world.matchOver = false;
  world.gunMode = false;
  world.onGunMode(false);
  world.banner = null;
  emitJourney(world);
  setStatus(world, 'READY');
  playTone(world, character === 'fio' ? 410 : 310, 0.08, 0.025);
}

function beginGrapple(world: World) {
  world.player.attack = null;
  world.enemy.attack = null;
  world.player.state = 'GRAPPLE';
  world.enemy.state = 'GRAPPLE';
  world.player.x = (world.player.x + world.enemy.x) / 2 - 34;
  world.enemy.x = world.player.x + 68;
  world.grapple = {
    timer: 0.5,
    playerChoice: null,
    aiChoice: Math.random() > 0.5 ? 1 : -1,
  };
  world.banner = {
    text: 'GRAPPLE!',
    subtext: '立刻按 ← 或 →',
    color: '#fbbf24',
    life: 0.7,
  };
  world.hitStop = 0.09;
  playTone(world, 190, 0.1, 0.05);
}

function resolveGrapple(world: World) {
  if (!world.grapple) return;
  const grapple = world.grapple;
  const playerTiming = grapple.playerChoice ? 14 + grapple.timer * 28 : -12;
  const directionRead = grapple.playerChoice !== grapple.aiChoice ? 9 : -4;
  const playerPower =
    world.player.stamina * 0.035 +
    playerTiming +
    directionRead +
    Math.random() * 1.5;
  const enemyPower = world.enemy.stamina * 0.035 + 15 + Math.random() * 1.5;
  const playerWins = playerPower >= enemyPower;
  const winner = playerWins ? world.player : world.enemy;
  const loser = playerWins ? world.enemy : world.player;
  const throwDirection: Direction = playerWins
    ? (grapple.playerChoice ?? winner.direction)
    : grapple.aiChoice;

  loser.hp = Math.max(0, loser.hp - 20);
  loser.state = 'KNOCKDOWN';
  loser.stunFrames = 54;
  loser.attack = null;
  loser.crouching = false;
  loser.x += throwDirection * 92;
  winner.state = 'THROW';
  winner.stunFrames = 22;
  world.banner = {
    text: playerWins ? 'THROW!' : 'REVERSED!',
    subtext: playerWins ? '擒拿成功' : '對手反摔',
    color: playerWins ? '#67e8f9' : '#fb7185',
    life: 1,
  };
  world.impacts.push({
    x: loser.x,
    y: GROUND_Y - 30,
    life: 0.55,
    color: '#fbbf24',
  });
  world.hitStop = 0.13;
  world.shake = 12;
  world.grapple = null;
  playTone(world, 86, 0.16, 0.065);
}

function tryGrapple(world: World) {
  if (world.encounterIndex < world.encounterTotal - 1) return false;
  const playerAttack = world.player.attack;
  const enemyAttack = world.enemy.attack;
  if (!playerAttack || !enemyAttack) return false;
  if (world.player.phase !== 'ACTIVE' || world.enemy.phase !== 'ACTIVE')
    return false;
  if (
    playerAttack.data.attackType !== 'PUNCH' ||
    enemyAttack.data.attackType !== 'PUNCH'
  )
    return false;
  if (
    !playerAttack.data.canTriggerGrapple ||
    !enemyAttack.data.canTriggerGrapple
  )
    return false;
  const levelGap = Math.abs(
    levelIndex[playerAttack.data.attackLevel] -
      levelIndex[enemyAttack.data.attackLevel],
  );
  if (levelGap > 1 || Math.abs(world.player.x - world.enemy.x) > 128)
    return false;
  const playerBox = world.player.attackBox();
  const enemyBox = world.enemy.attackBox();
  if (!playerBox || !enemyBox || !rectsOverlap(playerBox, enemyBox))
    return false;
  beginGrapple(world);
  return true;
}

function resolveAttack(world: World, attacker: Fighter, defender: Fighter) {
  const runtime = attacker.attack;
  if (!runtime || runtime.hitResolved || attacker.phase !== 'ACTIVE') return;
  const attackBox = attacker.attackBox();
  if (!attackBox) return;
  const hurtboxes = defender.hurtboxes();
  const reachedLevels = overlappingLevels(attackBox, hurtboxes);
  if (!reachedLevels.includes(runtime.data.attackLevel)) return;
  const targetBox = hurtboxes[runtime.data.attackLevel];

  runtime.hitResolved = true;
  const counter = defender.phase === 'RECOVERY';
  const guarded = defender.canAutoGuard(runtime.data.attackLevel);
  defender.receiveHit(runtime.data, attacker.direction, counter, guarded);

  const impactY = targetBox.y + targetBox.h / 2;
  world.impacts.push({
    x: attacker.direction === 1 ? attackBox.x + attackBox.w : attackBox.x,
    y: impactY,
    life: guarded ? 0.22 : 0.38,
    color: guarded
      ? '#7dd3fc'
      : runtime.data.attackType === 'KICK'
        ? '#fb7185'
        : '#fbbf24',
  });
  world.hitStop = guarded
    ? 0.035
    : counter
      ? 0.085
      : runtime.data.attackType === 'KICK'
        ? 0.065
        : 0.04;
  world.shake = guarded
    ? 2
    : counter
      ? 9
      : runtime.data.attackType === 'KICK'
        ? 6
        : 4;
  if (counter) playTone(world, 760, 0.09, 0.055);
  else if (guarded) playTone(world, 260, 0.05, 0.025);
  else {
    playTone(
      world,
      runtime.data.attackType === 'KICK' ? 120 : 180,
      0.065,
      0.04,
    );
  }
}

function chooseAIAttack(world: World, distance: number) {
  const ai = world.ai;
  const progress = world.encounterIndex / Math.max(1, world.encounterTotal - 1);
  if (world.encounterIndex < 2) {
    return world.attacks.find(
      (attack) => attack.attackType === 'PUNCH' && attack.attackLevel === 'MID',
    );
  }
  const playerAttack = world.player.attack?.data;
  if (
    playerAttack?.attackType === 'PUNCH' &&
    (world.player.phase === 'STARTUP' || world.player.phase === 'ACTIVE') &&
    distance < 132 &&
    progress > 0.65 &&
    Math.random() < ai.grappleRate
  ) {
    const matchingPunch = world.attacks.find(
      (attack) =>
        attack.attackType === 'PUNCH' &&
        attack.attackLevel === playerAttack.attackLevel,
    );
    if (matchingPunch) return matchingPunch;
  }

  if (world.player.phase === 'RECOVERY' && Math.random() < ai.counterRate) {
    const counterPunch = world.attacks.find(
      (attack) => attack.attackType === 'PUNCH' && attack.attackLevel === 'MID',
    );
    if (counterPunch && distance <= counterPunch.range + 78)
      return counterPunch;
  }

  const wantsKick = Math.random() < ai.kickRate;
  const candidates = world.attacks.filter((attack) =>
    wantsKick ? attack.attackType === 'KICK' : attack.attackType === 'PUNCH',
  );
  const roll = Math.random();
  const level: AttackLevel =
    roll < ai.highAttackRate
      ? 'HIGH'
      : roll < ai.highAttackRate + ai.midAttackRate
        ? 'MID'
        : 'LOW';
  return (
    candidates.find((attack) => attack.attackLevel === level) ?? candidates[1]
  );
}

function updateAI(world: World, dt: number) {
  const enemy = world.enemy;
  const player = world.player;
  if (enemy.busy) {
    enemy.moveIntent = 0;
    return;
  }
  enemy.crouching = false;
  const incoming = world.projectiles.find(
    (projectile) =>
      projectile.owner === 'player' &&
      Math.abs(projectile.x - enemy.x) < 430 &&
      Math.sign(projectile.velocityX) === Math.sign(enemy.x - projectile.x),
  );
  if (incoming) {
    if (incoming.data.attackLevel === 'HIGH') {
      enemy.crouching = true;
      enemy.moveIntent = 0;
      return;
    }
    if (incoming.data.attackLevel === 'LOW') {
      enemy.crouching = true;
      enemy.moveIntent = 0;
      return;
    }
    enemy.moveIntent = enemy.direction;
  }
  const distance = Math.abs(enemy.x - player.x);
  world.aiDecisionTimer -= dt;
  world.aiRetreatTimer = Math.max(0, world.aiRetreatTimer - dt);

  if (world.aiRetreatTimer > 0) {
    enemy.moveIntent = -enemy.direction;
  } else if (distance > world.ai.preferredMaxRange) {
    enemy.moveIntent = enemy.direction;
  } else if (distance < world.ai.preferredMinRange) {
    enemy.moveIntent =
      Math.random() < world.ai.retreatRate ? -enemy.direction : 0;
  } else {
    enemy.moveIntent = 0;
  }

  const incomingPunch = player.attack?.data;
  if (
    incomingPunch?.attackType === 'PUNCH' &&
    player.phase === 'STARTUP' &&
    distance < 132 &&
    world.ai.grappleRate > 0.75 &&
    Math.random() < world.ai.grappleRate * 0.18
  ) {
    const matchingPunch = world.attacks.find(
      (attack) =>
        attack.attackType === 'PUNCH' &&
        attack.attackLevel === incomingPunch.attackLevel,
    );
    if (matchingPunch && enemy.beginAttack(matchingPunch)) {
      enemy.moveIntent = 0;
      playTone(world, 185, 0.04, 0.016);
      return;
    }
  }

  if (world.aiDecisionTimer > 0) return;
  const progress = world.encounterIndex / Math.max(1, world.encounterTotal - 1);
  world.aiDecisionTimer =
    (world.ai.reactionFrames / FPS) *
    (1.35 - progress * 0.5) *
    (0.85 + Math.random() * 0.55);
  const playerAttack = player.attack?.data;
  if (
    playerAttack &&
    player.phase === 'STARTUP' &&
    distance <= playerAttack.range + 105 &&
    Math.random() < world.ai.defense
  ) {
    if (playerAttack.attackLevel === 'HIGH') {
      enemy.crouching = true;
      enemy.moveIntent = 0;
    } else if (playerAttack.attackLevel === 'LOW') {
      enemy.crouching = true;
      enemy.moveIntent = 0;
    } else {
      world.aiRetreatTimer = 0.22;
      enemy.moveIntent = -enemy.direction;
    }
    return;
  }
  const encounterAggression = world.ai.aggression * (0.42 + progress * 0.58);
  if (
    distance > world.ai.preferredMaxRange + 72 ||
    Math.random() > encounterAggression
  )
    return;

  const attack = chooseAIAttack(world, distance);
  if (!attack) return;
  const practicalRange =
    attack.range + (attack.attackType === 'KICK' ? 88 : 78);
  if (distance <= practicalRange) {
    enemy.beginAttack(attack);
    playTone(world, attack.attackType === 'KICK' ? 145 : 220, 0.035, 0.012);
    if (attack.attackType === 'KICK' && Math.random() < world.ai.retreatRate)
      world.aiRetreatTimer = 0.3;
  }
}

function handlePlayer(world: World) {
  const player = world.player;
  const left = world.keys.has('arrowleft');
  const right = world.keys.has('arrowright');
  const up = world.keys.has('arrowup');
  const down = world.keys.has('arrowdown');
  player.moveIntent = player.busy ? 0 : left === right ? 0 : left ? -1 : 1;
  player.crouching = !player.busy && down;

  for (const input of ['q', 'w']) {
    if (!world.justPressed.has(input)) continue;
    const level: AttackLevel = up === down ? 'MID' : up ? 'HIGH' : 'LOW';
    if (input === 'q' && world.gunMode && world.ammo <= 0)
      setGunMode(world, false);
    const type =
      input === 'q'
        ? world.gunMode && world.ammo > 0
          ? 'GUN'
          : 'PUNCH'
        : 'KICK';
    const mappedInput = attackInputByLevel[type][level];
    const attack =
      type === 'GUN'
        ? world.gunAttackByInput.get(mappedInput)
        : world.meleeAttackByInput.get(mappedInput);
    if (attack && player.beginAttack(attack)) {
      playTone(
        world,
        attack.attackType === 'GUN'
          ? 430
          : attack.attackType === 'KICK'
            ? 150
            : 240,
        0.04,
        0.016,
      );
    }
  }
}

function spawnProjectiles(world: World) {
  for (const fighter of [world.player, world.enemy]) {
    const runtime = fighter.attack;
    if (
      !runtime ||
      runtime.hitResolved ||
      fighter.phase !== 'ACTIVE' ||
      runtime.data.attackType !== 'GUN' ||
      !runtime.data.projectile
    )
      continue;

    runtime.hitResolved = true;
    if (fighter.id === 'player') {
      if (world.ammo <= 0) continue;
      world.ammo -= 1;
      if (world.ammo === 0) {
        world.gunMode = false;
        world.onGunMode(false);
        world.banner = {
          text: 'MAGAZINE EMPTY',
          subtext: 'Q 已自動改為拳擊',
          color: '#fbbf24',
          life: 1.05,
        };
      }
      emitJourney(world);
    }
    const speed = runtime.data.projectileSpeed ?? 1400;
    const muzzle =
      fighter.id === 'player'
        ? PLAYER_GUN_MUZZLE_OFFSETS[runtime.data.attackLevel]
        : { x: 96, y: PROJECTILE_Y_OFFSETS[runtime.data.attackLevel] };
    const startX = fighter.x + fighter.direction * muzzle.x;
    world.projectiles.push({
      owner: fighter.id,
      x: startX,
      previousX: startX,
      y: GROUND_Y + muzzle.y,
      velocityX: speed * fighter.direction,
      lifetime: Math.min(1, runtime.data.range / speed + 0.12),
      data: runtime.data,
    });
    world.shake = Math.max(world.shake, 4);
    playTone(world, 96, 0.08, 0.055);
    playTone(world, 880, 0.045, 0.022);
  }
}

function updateProjectiles(world: World, dt: number) {
  spawnProjectiles(world);
  for (const projectile of world.projectiles) {
    projectile.previousX = projectile.x;
    projectile.x += projectile.velocityX * dt;
    projectile.lifetime -= dt;
    const defender = projectile.owner === 'player' ? world.enemy : world.player;
    const collider: Rect = {
      x: Math.min(projectile.previousX, projectile.x) - 13,
      y: projectile.y - 8,
      w: Math.abs(projectile.x - projectile.previousX) + 26,
      h: 16,
    };
    const targetBox = defender.hurtboxes()[projectile.data.attackLevel];
    const crossedTarget =
      collider.x < targetBox.x + targetBox.w &&
      collider.x + collider.w > targetBox.x;
    const evadedByStance =
      projectile.data.attackLevel === 'HIGH' && defender.crouching;
    if (!crossedTarget || evadedByStance) continue;

    const direction = Math.sign(projectile.velocityX) as Direction;
    const guarded = defender.canAutoGuard(projectile.data.attackLevel);
    defender.receiveHit(projectile.data, direction, false, guarded);
    projectile.lifetime = -1;
    world.impacts.push({
      x: projectile.x,
      y: projectile.y,
      life: guarded ? 0.28 : 0.48,
      color: guarded ? '#7dd3fc' : '#22d3ee',
    });
    world.hitStop = guarded ? 0.035 : 0.075;
    world.shake = guarded ? 3 : 8;
    playTone(world, guarded ? 260 : 110, 0.07, 0.045);
  }
  world.projectiles = world.projectiles.filter(
    (projectile) =>
      projectile.lifetime > 0 &&
      projectile.x > -60 &&
      projectile.x < WIDTH + 60,
  );
}

function checkKO(world: World) {
  if (world.encounterResolved || (world.player.hp > 0 && world.enemy.hp > 0))
    return;
  const playerWon = world.enemy.hp <= 0;
  const loser = playerWon ? world.enemy : world.player;
  world.encounterResolved = true;
  loser.state = 'KNOCKDOWN';
  loser.stunFrames = 9999;
  world.projectiles = [];
  world.hitStop = 0;
  world.shake = 0;
  world.impacts = [];

  if (!playerWon) {
    world.matchOver = true;
    world.journeyPhase = 'COMPLETE';
    world.banner = {
      text: 'JOURNEY ENDED',
      subtext: `抵達第 ${world.encounterIndex + 1} 戰 // 按 R 重新出發`,
      color: '#fb7185',
      life: 999,
    };
    emitJourney(world);
    setStatus(world, 'KO');
    playTone(world, 96, 0.3, 0.06);
    return;
  }

  const bossDefeated = world.encounterIndex >= world.encounterTotal - 1;
  if (!bossDefeated) {
    world.cash += MINION_REWARD;
    world.minionsDefeated += 1;
  }
  world.matchOver = bossDefeated;
  world.journeyPhase = bossDefeated ? 'COMPLETE' : 'CLEAR';
  world.phaseTimer = 1.25;
  world.banner = {
    text: bossDefeated ? 'BOSS DEFEATED' : 'ENEMY DOWN',
    subtext: bossDefeated
      ? '城市道場制霸 // 按 R 再闖一次'
      : `+$${MINION_REWARD} // 現金 $${world.cash}`,
    color: '#67e8f9',
    life: bossDefeated ? 999 : 1.15,
  };
  emitJourney(world);
  if (bossDefeated) setStatus(world, 'KO');
  playTone(world, bossDefeated ? 620 : 520, bossDefeated ? 0.35 : 0.2, 0.055);
}

function updateWorld(world: World, dt: number) {
  if (world.status !== 'FIGHTING') return;

  world.animationTime += dt;

  if (world.hitStop > 0) {
    world.hitStop = Math.max(0, world.hitStop - dt);
    return;
  }

  world.banner &&= { ...world.banner, life: world.banner.life - dt };
  if (world.banner && world.banner.life <= 0) world.banner = null;
  world.impacts = world.impacts
    .map((impact) => ({ ...impact, life: impact.life - dt }))
    .filter((impact) => impact.life > 0);
  world.shake = Math.max(0, world.shake - 28 * dt);

  if (world.journeyPhase === 'TRAVEL') {
    world.phaseTimer -= dt;
    world.stageScroll += 105 * dt;
    world.player.direction = 1;
    world.player.crouching = false;
    world.player.moveIntent = 1;
    world.player.update(dt);
    world.player.x = 350 + Math.sin(world.stageScroll * 0.025) * 10;
    if (world.phaseTimer <= 0) beginEncounter(world);
    world.justPressed.clear();
    return;
  }

  if (world.journeyPhase === 'CLEAR') {
    world.phaseTimer -= dt;
    world.player.moveIntent = 0;
    world.player.update(dt);
    if (world.phaseTimer <= 0) {
      world.encounterIndex += 1;
      world.player.stamina = 100;
      world.enemy.hp = 0;
      const reachedCheckpoint = world.minionsDefeated % 5 === 0;
      world.journeyPhase = reachedCheckpoint ? 'CHECKPOINT' : 'TRAVEL';
      world.phaseTimer = reachedCheckpoint ? 0 : 1.65;
      world.encounterResolved = reachedCheckpoint;
      world.banner = reachedCheckpoint
        ? {
            text: 'CHECKPOINT',
            subtext: '進入商店，或直接繼續前進',
            color: '#fbbf24',
            life: 999,
          }
        : {
            text: 'ADVANCE',
            subtext: `下一戰 ${world.encounterIndex + 1}/${world.encounterTotal}`,
            color: '#67e8f9',
            life: 0.85,
          };
      emitJourney(world);
    }
    world.justPressed.clear();
    return;
  }

  if (world.journeyPhase === 'CHECKPOINT' || world.journeyPhase === 'SHOP') {
    world.player.moveIntent = 0;
    world.player.crouching = false;
    world.player.state = 'IDLE';
    world.justPressed.clear();
    return;
  }

  if (world.journeyPhase !== 'COMBAT') {
    world.justPressed.clear();
    return;
  }

  world.player.direction = world.player.x <= world.enemy.x ? 1 : -1;
  world.enemy.direction = world.enemy.x <= world.player.x ? 1 : -1;

  if (world.grapple) {
    world.grapple.timer -= dt;
    if (world.justPressed.has('arrowleft')) world.grapple.playerChoice = -1;
    if (world.justPressed.has('arrowright')) world.grapple.playerChoice = 1;
    if (world.grapple.playerChoice || world.grapple.timer <= 0)
      resolveGrapple(world);
    world.justPressed.clear();
    checkKO(world);
    return;
  }

  handlePlayer(world);
  updateAI(world, dt);
  world.player.update(dt);
  world.enemy.update(dt);
  updateProjectiles(world, dt);

  world.player.x = clamp(
    world.player.x,
    FIGHTER_STAGE_MARGIN,
    WIDTH - FIGHTER_STAGE_MARGIN,
  );
  world.enemy.x = clamp(
    world.enemy.x,
    FIGHTER_STAGE_MARGIN,
    WIDTH - FIGHTER_STAGE_MARGIN,
  );
  const separation = Math.abs(world.player.x - world.enemy.x);
  if (separation < 68) {
    const midpoint = (world.player.x + world.enemy.x) / 2;
    world.player.x = midpoint - 34 * world.player.direction;
    world.enemy.x = midpoint + 34 * world.player.direction;
  }

  const leftmost = Math.min(world.player.x, world.enemy.x);
  if (leftmost < FIGHTER_STAGE_MARGIN) {
    const correction = FIGHTER_STAGE_MARGIN - leftmost;
    world.player.x += correction;
    world.enemy.x += correction;
  }
  const rightmost = Math.max(world.player.x, world.enemy.x);
  if (rightmost > WIDTH - FIGHTER_STAGE_MARGIN) {
    const correction = rightmost - (WIDTH - FIGHTER_STAGE_MARGIN);
    world.player.x -= correction;
    world.enemy.x -= correction;
  }

  if (!tryGrapple(world)) {
    resolveAttack(world, world.player, world.enemy);
    resolveAttack(world, world.enemy, world.player);
  }

  checkKO(world);
  world.justPressed.clear();
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  value: number,
  color: string,
  alignRight = false,
) {
  roundedRect(ctx, x, y, width, 18, 9);
  ctx.fillStyle = 'rgba(2, 8, 18, .78)';
  ctx.fill();
  const fillWidth = Math.max(0, (width - 4) * (value / 100));
  roundedRect(
    ctx,
    alignRight ? x + width - 2 - fillWidth : x + 2,
    y + 2,
    fillWidth,
    14,
    7,
  );
  ctx.fillStyle = color;
  ctx.fill();
}

function actionFrameFor(fighter: Fighter) {
  if (fighter.state === 'KNOCKDOWN' || fighter.state.startsWith('HIT_'))
    return 0;
  if (fighter.state === 'THROW') return 2;
  if (!fighter.attack) return 0;

  const { data, frame } = fighter.attack;
  if (data.attackType === 'GUN') return 0;
  const actionFrame =
    data.attackType === 'PUNCH'
      ? { HIGH: 1, MID: 2, LOW: 3 }[data.attackLevel]
      : { HIGH: 4, MID: 5, LOW: 6 }[data.attackLevel];
  const activeEnd = data.startupFrames + data.activeFrames;
  const total = activeEnd + data.recoveryFrames;
  if (
    frame < data.startupFrames * 0.42 ||
    frame > total - data.recoveryFrames * 0.36
  )
    return 0;
  return actionFrame;
}

function reactionFrameFor(fighter: Fighter) {
  if (fighter.state === 'KNOCKDOWN') return 3;
  if (fighter.state === 'HIT_HIGH') return 0;
  if (fighter.state === 'HIT_MID') return 1;
  if (fighter.state === 'HIT_LOW') return 2;
  return null;
}

function guardFrameFor(fighter: Fighter) {
  const level = fighter.guardLevel;
  if (!level) return null;
  return { HIGH: 1, MID: 2, LOW: 3 }[level];
}

function drawActionFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  size: number,
  xOffset = 0,
  rows = 2,
  groundOffset = 0,
) {
  const sourceWidth = sheet.width / 4;
  const sourceHeight = sheet.height / rows;
  const column = frame % 4;
  const row = Math.floor(frame / 4);
  const drawWidth = size * (sourceWidth / sourceHeight);
  ctx.drawImage(
    sheet,
    column * sourceWidth,
    row * sourceHeight,
    sourceWidth,
    sourceHeight,
    -drawWidth / 2 + xOffset,
    -size + groundOffset,
    drawWidth,
    size,
  );
}

function drawPlayerActionFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  size: number,
  rect: readonly [number, number, number, number],
  groundOffset = 0,
) {
  const [rawX, rawY, rawWidth, rawHeight] = rect;
  const padding = 2;
  const sourceX = Math.max(0, rawX - padding);
  const sourceY = Math.max(0, rawY - padding);
  const sourceRight = Math.min(sheet.width, rawX + rawWidth + padding);
  const sourceBottom = Math.min(sheet.height, rawY + rawHeight + padding);
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  const nominalCellWidth = sheet.width / 4;
  const nominalCellHeight = sheet.height / 2;
  const scale = size / nominalCellHeight;
  const column = frame % 4;
  const row = Math.floor(frame / 4);
  const drawX =
    (-nominalCellWidth * scale) / 2 +
    (sourceX - column * nominalCellWidth) * scale;
  const drawY =
    -size + (sourceY - row * nominalCellHeight) * scale + groundOffset;

  ctx.drawImage(
    sheet,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    drawX,
    drawY,
    sourceWidth * scale,
    sourceHeight * scale,
  );
}

function drawEnemyActionFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  size: number,
  rect: readonly [number, number, number, number],
  xOffset = 0,
) {
  const [rawX, rawY, rawWidth, rawHeight] = rect;
  const padding = 2;
  const sourceX = Math.max(0, rawX - padding);
  const sourceY = Math.max(0, rawY - padding);
  const sourceRight = Math.min(sheet.width, rawX + rawWidth + padding);
  const sourceBottom = Math.min(sheet.height, rawY + rawHeight + padding);
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  const nominalCellWidth = sheet.width / 4;
  const nominalCellHeight = sheet.height / 3;
  const scale = size / nominalCellHeight;
  const column = frame % 4;
  const drawX =
    (-nominalCellWidth * scale) / 2 +
    (sourceX - column * nominalCellWidth) * scale +
    xOffset;
  const drawY = -(rawY + rawHeight - sourceY) * scale;

  ctx.drawImage(
    sheet,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    drawX,
    drawY,
    sourceWidth * scale,
    sourceHeight * scale,
  );
}

function gunFrameFor(fighter: Fighter) {
  if (!fighter.attack || fighter.attack.data.attackType !== 'GUN') return 0;
  const { data, frame } = fighter.attack;
  const activeEnd = data.startupFrames + data.activeFrames;
  const total = activeEnd + data.recoveryFrames;
  if (
    frame < data.startupFrames * 0.38 ||
    frame > total - data.recoveryFrames * 0.32
  )
    return 0;
  return { HIGH: 1, MID: 2, LOW: 3 }[data.attackLevel];
}

function drawGunFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  height: number,
) {
  const sourceWidth = sheet.width / 4;
  const width = height * (sourceWidth / sheet.height);
  ctx.drawImage(
    sheet,
    frame * sourceWidth,
    0,
    sourceWidth,
    sheet.height,
    -width / 2,
    -height + PLAYER_GUN_GROUND_OFFSET,
    width,
    height,
  );
}

function drawWalkFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  height: number,
) {
  const sourceWidth = sheet.width / 4;
  const sourceY = sheet.height * 0.1;
  const sourceHeight = sheet.height * 0.76;
  const width = height * (sourceWidth / sourceHeight);
  ctx.drawImage(
    sheet,
    frame * sourceWidth,
    sourceY,
    sourceWidth,
    sourceHeight,
    -width / 2,
    -height + 3,
    width,
    height,
  );
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  world: World,
  fighter: Fighter,
) {
  const isEnemy = fighter.id === 'enemy';
  const isKai = !isEnemy && world.playerCharacter === 'kai';
  const attack = fighter.attack?.data;
  const frame = actionFrameFor(fighter);
  const reactionFrame = reactionFrameFor(fighter);
  const guardFrame = guardFrameFor(fighter);
  const guardLevel = fighter.guardLevel;
  const gunFrame = gunFrameFor(fighter);
  const isHitPose = reactionFrame !== null;
  const isGuardPose = guardFrame !== null && guardLevel !== null;
  const baseY = GROUND_Y;
  const isCrouchPose =
    fighter.crouching && !isHitPose && !isGuardPose && !attack;
  const isWalking =
    fighter.id === 'player' &&
    !attack &&
    !isHitPose &&
    !isGuardPose &&
    !isCrouchPose &&
    (fighter.state === 'MOVE_FORWARD' || fighter.state === 'MOVE_BACKWARD');
  const useGunPose =
    fighter.id === 'player' &&
    (world.gunMode || attack?.attackType === 'GUN') &&
    !isHitPose &&
    !isGuardPose &&
    !isCrouchPose &&
    (!attack || attack.attackType === 'GUN');
  const combatSheet = isEnemy
    ? world.enemySheets[world.aiIndex]
    : isKai
      ? world.maleActionSheet
      : world.actionSheet;
  const attackTotal = attack
    ? attack.startupFrames + attack.activeFrames + attack.recoveryFrames
    : 1;
  const attackProgress = fighter.attack
    ? clamp(fighter.attack.frame / attackTotal, 0, 1)
    : 0;
  const actionPulse = attack ? Math.sin(Math.PI * attackProgress) : 0;
  const activeThrust =
    attack && attack.attackType !== 'GUN'
      ? actionPulse * (attack.attackType === 'KICK' ? 42 : 28)
      : 0;
  const attackRotation =
    attack && attack.attackType !== 'GUN'
      ? fighter.direction *
        actionPulse *
        (attack.attackType === 'KICK' ? -0.055 : -0.025)
      : 0;
  const spriteIndex = isEnemy ? world.aiIndex : 0;
  const enemyActionSize =
    ENEMY_ACTION_SIZES[spriteIndex] ?? ENEMY_ACTION_SIZES[0];
  const enemyFrameRects =
    ENEMY_FRAME_RECTS[spriteIndex] ?? ENEMY_FRAME_RECTS[0];
  const actionSize = isEnemy || isKai ? enemyActionSize : PLAYER_ACTION_SIZE;
  const actionGroundOffset =
    PLAYER_ACTION_GROUND_OFFSETS[frame] ?? PLAYER_ACTION_GROUND_OFFSETS[0];

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = isEnemy ? '#fb7185' : '#67e8f9';
  ctx.beginPath();
  ctx.ellipse(fighter.x, GROUND_Y + 5, 72, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(fighter.x + fighter.direction * activeThrust, baseY);
  ctx.rotate(attackRotation);
  ctx.scale(fighter.direction, 1);
  if (isHitPose && reactionFrame !== null) {
    if (isEnemy || isKai) {
      const enemyReactionFrame = reactionFrame + 8;
      drawEnemyActionFrame(
        ctx,
        combatSheet,
        enemyReactionFrame,
        enemyActionSize,
        enemyFrameRects[enemyReactionFrame],
      );
    } else {
      drawActionFrame(
        ctx,
        world.playerReactionSheet,
        reactionFrame,
        PLAYER_REACTION_SIZE,
        0,
        1,
        PLAYER_REACTION_GROUND_OFFSETS[reactionFrame] ?? 0,
      );
    }
  } else if (isGuardPose && guardFrame !== null) {
    if (isEnemy || isKai) {
      const enemyGuardFrame = guardFrame + 7;
      drawEnemyActionFrame(
        ctx,
        combatSheet,
        enemyGuardFrame,
        enemyActionSize,
        enemyFrameRects[enemyGuardFrame],
      );
    } else {
      drawActionFrame(
        ctx,
        world.playerGuardSheet,
        guardFrame,
        PLAYER_GUARD_SIZE,
        0,
        1,
        PLAYER_GUARD_GROUND_OFFSETS[guardFrame] ?? 0,
      );
    }
  } else if (isCrouchPose) {
    if (isEnemy || isKai)
      drawEnemyActionFrame(
        ctx,
        combatSheet,
        10,
        enemyActionSize,
        enemyFrameRects[10],
      );
    else
      drawActionFrame(
        ctx,
        world.playerGuardSheet,
        3,
        PLAYER_GUARD_SIZE,
        0,
        1,
        PLAYER_GUARD_GROUND_OFFSETS[3],
      );
  } else if (isWalking) {
    const walkFrame = Math.floor(world.animationTime * 7.5) % 4;
    drawWalkFrame(
      ctx,
      world.walkSheets[world.playerCharacter],
      walkFrame,
      PLAYER_WALK_SIZE,
    );
  } else if (useGunPose)
    drawGunFrame(
      ctx,
      world.gunSheets[world.playerCharacter],
      gunFrame,
      PLAYER_GUN_SIZE,
    );
  else if (isEnemy || isKai)
    drawEnemyActionFrame(
      ctx,
      combatSheet,
      frame,
      enemyActionSize,
      enemyFrameRects[frame],
    );
  else
    drawPlayerActionFrame(
      ctx,
      combatSheet,
      frame,
      actionSize,
      PLAYER_FRAME_RECTS[frame] ?? PLAYER_FRAME_RECTS[0],
      actionGroundOffset,
    );
  ctx.restore();

  if (world.showBoxes) {
    const boxes = fighter.hurtboxes();
    const colors = { HIGH: '#f472b6', MID: '#fbbf24', LOW: '#34d399' };
    for (const level of ATTACK_LEVELS) {
      const box = boxes[level];
      ctx.strokeStyle = colors[level];
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }
    const attackBox = fighter.attackBox();
    if (attackBox) {
      ctx.fillStyle = 'rgba(239, 68, 68, .22)';
      ctx.fillRect(attackBox.x, attackBox.y, attackBox.w, attackBox.h);
      ctx.strokeStyle = '#ef4444';
      ctx.strokeRect(attackBox.x, attackBox.y, attackBox.w, attackBox.h);
    }
  }
}

function drawWorld(ctx: CanvasRenderingContext2D, world: World) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  const shakeX = world.shake > 0 ? (Math.random() - 0.5) * world.shake : 0;
  const shakeY =
    world.shake > 0 ? (Math.random() - 0.5) * world.shake * 0.45 : 0;
  ctx.translate(shakeX, shakeY);
  const stageOffset = -(world.stageScroll % WIDTH);
  ctx.drawImage(world.stage, stageOffset, 0, WIDTH, HEIGHT);
  if (stageOffset < 0)
    ctx.drawImage(world.stage, stageOffset + WIDTH, 0, WIDTH, HEIGHT);
  const stageShade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  stageShade.addColorStop(0, 'rgba(2, 6, 23, .1)');
  stageShade.addColorStop(0.62, 'rgba(2, 6, 23, .05)');
  stageShade.addColorStop(1, 'rgba(2, 6, 23, .46)');
  ctx.fillStyle = stageShade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (world.journeyPhase === 'COMBAT' || world.journeyPhase === 'CLEAR')
    drawFighter(ctx, world, world.enemy);
  drawFighter(ctx, world, world.player);

  for (const impact of world.impacts) {
    const strength = clamp(impact.life / 0.48, 0, 1);
    ctx.save();
    ctx.translate(impact.x, impact.y);
    ctx.strokeStyle = impact.color;
    ctx.fillStyle = impact.color;
    ctx.globalAlpha = strength;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 9 + (1 - strength) * 14, 0, Math.PI * 2);
    ctx.stroke();
    for (let ray = 0; ray < 6; ray += 1) {
      const angle = (Math.PI * 2 * ray) / 6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 7, Math.sin(angle) * 7);
      ctx.lineTo(
        Math.cos(angle) * (15 + strength * 10),
        Math.sin(angle) * (15 + strength * 10),
      );
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  const topGradient = ctx.createLinearGradient(0, 0, 0, 125);
  topGradient.addColorStop(0, 'rgba(1, 5, 16, .94)');
  topGradient.addColorStop(1, 'rgba(1, 5, 16, .18)');
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, WIDTH, 140);

  ctx.font = '700 17px ui-monospace, monospace';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(PLAYER_NAMES[world.playerCharacter], 54, 38);
  ctx.textAlign = 'right';
  ctx.fillText(
    world.journeyPhase === 'TRAVEL'
      ? 'NEXT ENEMY…'
      : world.journeyPhase === 'CHECKPOINT' || world.journeyPhase === 'SHOP'
        ? 'SUPPLY CHECKPOINT'
        : world.ai.name.toUpperCase(),
    WIDTH - 54,
    38,
  );
  ctx.textAlign = 'left';
  drawBar(ctx, 54, 52, 430, world.player.hp, '#22d3ee');
  drawBar(
    ctx,
    WIDTH - 484,
    52,
    430,
    world.journeyPhase === 'TRAVEL' ? 0 : world.enemy.hp,
    '#fb7185',
    true,
  );
  drawBar(ctx, 54, 79, 282, world.player.stamina, '#fbbf24');
  drawBar(ctx, WIDTH - 336, 79, 282, world.enemy.stamina, '#fbbf24', true);
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(226, 232, 240, .8)';
  ctx.fillText(
    `HP ${Math.ceil(world.player.hp)}   ST ${Math.ceil(world.player.stamina)}`,
    54,
    111,
  );
  ctx.textAlign = 'right';
  ctx.fillText(
    world.journeyPhase === 'TRAVEL'
      ? '前進中…'
      : `ST ${Math.ceil(world.enemy.stamina)}   HP ${Math.ceil(world.enemy.hp)}`,
    WIDTH - 54,
    111,
  );
  ctx.textAlign = 'center';
  ctx.font = '900 22px ui-monospace, monospace';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('NEON KARATE', WIDTH / 2, 47);
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.fillStyle = '#67e8f9';
  ctx.fillText(
    world.gunMode
      ? `PISTOL // ${world.ammo} SHOTS`
      : `BARE HANDS // $${world.cash} // DRINK ${world.energyDrinks}`,
    WIDTH / 2,
    68,
  );
  const clearedMarks = '◆'.repeat(world.encounterIndex);
  const remainingMarks = '◇'.repeat(
    Math.max(0, world.encounterTotal - world.encounterIndex),
  );
  ctx.font = '900 13px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(226, 232, 240, .86)';
  ctx.fillText(
    `${clearedMarks}${remainingMarks}   STAGE ${Math.min(world.encounterIndex + 1, world.encounterTotal)}/${world.encounterTotal}`,
    WIDTH / 2,
    96,
  );

  if (world.banner) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowColor = world.banner.color;
    ctx.shadowBlur = 24;
    ctx.font = '900 54px ui-sans-serif, system-ui';
    ctx.fillStyle = world.banner.color;
    ctx.fillText(world.banner.text, WIDTH / 2, 222);
    ctx.shadowBlur = 0;
    if (world.banner.subtext) {
      ctx.font = '700 18px ui-monospace, monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(world.banner.subtext, WIDTH / 2, 252);
    }
    ctx.restore();
  }

  if (world.status === 'READY' || world.status === 'LOADING') {
    ctx.fillStyle = 'rgba(1, 4, 14, .68)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center';
    ctx.font = '900 66px ui-sans-serif, system-ui';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('NEON KARATE', WIDTH / 2, 285);
    ctx.font = '700 20px ui-monospace, monospace';
    ctx.fillStyle = '#67e8f9';
    ctx.fillText(
      world.status === 'LOADING'
        ? 'LOADING FIGHT DATA…'
        : world.gunMode
          ? 'PISTOL READY // 按下開始'
          : '按下開始，一路迎戰到最終 Boss',
      WIDTH / 2,
      330,
    );
    if (world.status === 'READY') {
      ctx.font = '700 14px ui-monospace, monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('10 MINIONS // 2 SHOPS // FINAL BOSS', WIDTH / 2, 365);
      ctx.fillStyle = 'rgba(226, 232, 240, .7)';
      ctx.fillText(
        'E 切換拳槍 · V 使用飲料 · 子彈用完自動出拳',
        WIDTH / 2,
        392,
      );
      ctx.font = '900 20px ui-sans-serif, system-ui';
      ctx.fillStyle = world.playerCharacter === 'fio' ? '#67e8f9' : '#fbbf24';
      ctx.fillText(
        `${PLAYER_NAMES[world.playerCharacter]} // READY`,
        WIDTH / 2,
        435,
      );
      ctx.font = '700 14px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(226, 232, 240, .72)';
      ctx.fillText('普通敵人血量較少，攻勢會隨路程逐步增強', WIDTH / 2, 464);
    }
  }

  if (world.debug) {
    const distance = Math.round(Math.abs(world.player.x - world.enemy.x));
    roundedRect(ctx, 20, 132, 322, 342, 14);
    ctx.fillStyle = 'rgba(2, 6, 23, .84)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(103, 232, 249, .4)';
    ctx.stroke();
    const lines = [
      `AI      ${world.ai.id}`,
      `AI ZONE ${world.ai.preferredMinRange}–${world.ai.preferredMaxRange}px`,
      `STAGE   ${world.encounterIndex + 1}/${world.encounterTotal} ${world.journeyPhase}`,
      `JOURNEY ${world.matchOver ? 'OVER' : 'LIVE'}`,
      `PLAYER  ${world.player.state}`,
      `ENEMY   ${world.enemy.state}`,
      `DIST    ${distance}px`,
      `P ATK   ${world.player.attack?.data.name ?? '—'}`,
      `P PHASE ${world.player.phase ?? '—'}`,
      `E ATK   ${world.enemy.attack?.data.name ?? '—'}`,
      `E PHASE ${world.enemy.phase ?? '—'}`,
      `LEVEL   ${world.player.attack?.data.attackLevel ?? '—'}`,
      `GRAPPLE ${world.grapple ? `${Math.max(0, world.grapple.timer).toFixed(2)}s` : 'OFF'}`,
      `GUN     ${world.gunMode ? 'ON' : 'OFF'}`,
      `AMMO    ${world.ammo}/${world.maxAmmo}`,
      `CASH    $${world.cash}`,
      `DRINK   ${world.energyDrinks}`,
      `BOXES   ${world.showBoxes ? 'ON' : 'OFF'}`,
    ];
    ctx.textAlign = 'left';
    ctx.font = '700 14px ui-monospace, monospace';
    ctx.fillStyle = '#bae6fd';
    lines.forEach((line, index) => ctx.fillText(line, 38, 162 + index * 19));
  }
}

const meleeKeyLabels = [
  { input: 'Q', label: '拳', tone: 'punch' },
  { input: 'W', label: '腳', tone: 'kick' },
] as const;

const gunKeyLabels = [
  { input: 'Q', label: '射擊', tone: 'shot' },
  { input: 'W', label: '腳', tone: 'kick' },
] as const;

export function KarateGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [status, setReactStatus] = useState<GameStatus>('LOADING');
  const [debug, setDebug] = useState(false);
  const [showBoxes, setShowBoxes] = useState(false);
  const [sound, setSound] = useState(true);
  const [gunMode, setGunMode] = useState(false);
  const [playerCharacter, setPlayerCharacter] =
    useState<PlayerCharacter>('fio');
  const [opponents, setOpponents] = useState<AIData[]>([]);
  const [activeOpponentIndex, setActiveOpponentIndex] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [journeyView, setJourneyView] = useState<JourneyView>({
    encounter: 1,
    total: ENCOUNTER_TOTAL,
    ammo: 6,
    cash: 0,
    energyDrinks: 0,
    minionsDefeated: 0,
    phase: 'TRAVEL',
    complete: false,
  });
  const activeKeyLabels = gunMode ? gunKeyLabels : meleeKeyLabels;
  const activeOpponent = opponents[activeOpponentIndex];
  const startLabel =
    status === 'LOADING'
      ? '載入中…'
      : status === 'ERROR'
        ? '載入失敗'
        : status === 'FIGHTING' || status === 'PAUSED'
          ? '重新闖關'
          : status === 'KO'
            ? '重新出發'
            : '開始闖關';

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const navigatorWithStandalone = navigator as Navigator & {
      standalone?: boolean;
    };
    const updateInstalledState = () => {
      setIsInstalled(
        standaloneQuery.matches || navigatorWithStandalone.standalone === true,
      );
    };
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setShowInstallHelp(false);
    };

    const frame = window.requestAnimationFrame(updateInstalledState);
    standaloneQuery.addEventListener('change', updateInstalledState);
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', markInstalled);
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      standaloneQuery.removeEventListener('change', updateInstalledState);
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const renderContext = context;

    async function boot() {
      const [
        attacksResponse,
        aiResponse,
        stage,
        actionSheet,
        playerReactionSheet,
        quickFistSheet,
        longKickSheet,
        grapplerSheet,
        playerGuardSheet,
        fioGunSheet,
        kaiGunSheet,
        fioWalkSheet,
        kaiWalkSheet,
      ] = await Promise.all([
        fetch('/game-data/attacks.json'),
        fetch('/game-data/ai.json'),
        loadImage('/urban-stage.png'),
        loadImage('/fio-actions-v3.png'),
        loadImage('/fio-hit-reactions-v3.png'),
        loadImage('/enemy-quick-fist-v3.png'),
        loadImage('/enemy-long-kick-v3.png'),
        loadImage('/enemy-grappler-v3.png'),
        loadImage('/fio-guards-v2.png'),
        loadImage('/fio-gun-actions-v6.png'),
        loadImage('/kai-gun-actions-v2.png'),
        loadImage('/fio-walk-v1.png'),
        loadImage('/kai-walk-v1.png'),
      ]);
      const attacks = (await attacksResponse.json()) as AttackData[];
      const aiPayload = (await aiResponse.json()) as AIData[] | AIData;
      const ais = Array.isArray(aiPayload) ? aiPayload : [aiPayload];
      const ai = ais[0];
      if (!ai) throw new Error('No AI profiles were loaded.');
      if (cancelled) return;
      const world: World = {
        player: new Fighter('player', 'FIO // 白閃', 350, 1),
        enemy: new Fighter('enemy', ai.name, 930, -1),
        attacks,
        meleeAttackByInput: new Map(
          attacks
            .filter((attack) => attack.attackType !== 'GUN')
            .map((attack) => [attack.input.toLowerCase(), attack]),
        ),
        gunAttackByInput: new Map(
          attacks
            .filter((attack) => attack.attackType === 'GUN')
            .map((attack) => [attack.input.toLowerCase(), attack]),
        ),
        ais,
        ai,
        aiIndex: 0,
        stage,
        actionSheet,
        playerReactionSheet,
        enemySheets: [quickFistSheet, longKickSheet, grapplerSheet],
        playerGuardSheet,
        maleActionSheet: quickFistSheet,
        gunSheets: { fio: fioGunSheet, kai: kaiGunSheet },
        walkSheets: { fio: fioWalkSheet, kai: kaiWalkSheet },
        status: 'READY',
        previousStatus: 'READY',
        keys: new Set(),
        justPressed: new Set(),
        grapple: null,
        projectiles: [],
        impacts: [],
        banner: null,
        aiDecisionTimer: 0,
        aiRetreatTimer: 0,
        playerCharacter: 'fio',
        encounterIndex: 0,
        encounterTotal: ENCOUNTER_TOTAL,
        journeyPhase: 'TRAVEL',
        phaseTimer: 0,
        stageScroll: 0,
        animationTime: 0,
        ammo: 6,
        maxAmmo: 6,
        cash: 0,
        energyDrinks: 0,
        minionsDefeated: 0,
        encounterResolved: false,
        matchOver: false,
        hitStop: 0,
        shake: 0,
        debug: false,
        showBoxes: false,
        sound: true,
        gunMode: false,
        audio: null,
        lastTime: performance.now(),
        frameHandle: 0,
        onStatus: setReactStatus,
        onGunMode: setGunMode,
        onAIChange: setActiveOpponentIndex,
        onJourneyChange: setJourneyView,
      };
      worldRef.current = world;
      setOpponents(ais);
      setActiveOpponentIndex(0);
      setJourneyView({
        encounter: 1,
        total: ENCOUNTER_TOTAL,
        ammo: 6,
        cash: 0,
        energyDrinks: 0,
        minionsDefeated: 0,
        phase: 'TRAVEL',
        complete: false,
      });
      setReactStatus('READY');

      const loop = (time: number) => {
        const dt = Math.min((time - world.lastTime) / 1000, 1 / 20);
        world.lastTime = time;
        updateWorld(world, dt);
        drawWorld(renderContext, world);
        world.frameHandle = requestAnimationFrame(loop);
      };
      world.frameHandle = requestAnimationFrame(loop);
    }

    boot().catch((error) => {
      console.error('Failed to load game assets.', error);
      setReactStatus('ERROR');
    });
    return () => {
      cancelled = true;
      const world = worldRef.current;
      if (world) cancelAnimationFrame(world.frameHandle);
    };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const world = worldRef.current;
      if (!world) return;
      const key = event.key.toLowerCase();
      const gameKeys = [
        'arrowleft',
        'arrowright',
        'arrowup',
        'arrowdown',
        'q',
        'w',
        'e',
        'v',
      ];
      if (gameKeys.includes(key)) event.preventDefault();
      if (!world.keys.has(key)) {
        world.justPressed.add(key);
      }
      world.keys.add(key);
      if (key === 'enter' && world.status === 'READY') resetWorld(world);
      if (key === 'r') resetWorld(world);
      if (key === 'e' && !event.repeat) toggleWeapon(world);
      if (key === 'v' && !event.repeat) consumeEnergyDrink(world);
      if (key === 'p' && world.status === 'FIGHTING') {
        world.previousStatus = world.status;
        setStatus(world, 'PAUSED');
      } else if (key === 'p' && world.status === 'PAUSED') {
        setStatus(world, 'FIGHTING');
      }
      if (key === 'd') {
        world.debug = !world.debug;
        setDebug(world.debug);
      }
      if (key === 'h') {
        world.showBoxes = !world.showBoxes;
        setShowBoxes(world.showBoxes);
      }
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      worldRef.current?.keys.delete(key);
    };
    const releaseAll = () => {
      worldRef.current?.keys.clear();
      worldRef.current?.justPressed.clear();
    };
    const releaseWhenHidden = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseWhenHidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', releaseWhenHidden);
    };
  }, []);

  const ensureAudio = useCallback(() => {
    const world = worldRef.current;
    if (!world || world.audio) return;
    world.audio = new AudioContext();
  }, []);

  const start = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    ensureAudio();
    resetWorld(world);
    canvasRef.current?.focus();
  }, [ensureAudio]);

  const chooseCharacter = useCallback((character: PlayerCharacter) => {
    const world = worldRef.current;
    if (!world) return;
    selectPlayerCharacter(world, character);
    setPlayerCharacter(character);
    canvasRef.current?.focus();
  }, []);

  const press = useCallback((key: string) => {
    const world = worldRef.current;
    if (!world) return;
    if (!world.keys.has(key)) {
      world.justPressed.add(key);
    }
    world.keys.add(key);
  }, []);

  const release = useCallback(
    (key: string) => worldRef.current?.keys.delete(key),
    [],
  );

  const toggleWeaponControl = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    toggleWeapon(world);
    canvasRef.current?.focus();
  }, []);

  const useDrinkControl = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    consumeEnergyDrink(world);
    canvasRef.current?.focus();
  }, []);

  const enterShopControl = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    enterShop(world);
  }, []);

  const continueJourneyControl = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    continueJourney(world);
    canvasRef.current?.focus();
  }, []);

  const buyDrinkControl = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    buyEnergyDrink(world);
  }, []);

  const buyAmmoControl = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    buyAmmoPack(world);
  }, []);

  const toggleDebug = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.debug = !world.debug;
    setDebug(world.debug);
  }, []);

  const toggleBoxes = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.showBoxes = !world.showBoxes;
    setShowBoxes(world.showBoxes);
  }, []);

  const toggleSound = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.sound = !world.sound;
    setSound(world.sound);
    ensureAudio();
  }, [ensureAudio]);

  const installGame = useCallback(async () => {
    if (!installPrompt) {
      setShowInstallHelp(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setIsInstalled(true);
    setInstallPrompt(null);
  }, [installPrompt]);

  const holdProps = (key: string) => {
    const finishPress = (event: ReactPointerEvent) => {
      release(key);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };
    return {
      onPointerDown: (event: ReactPointerEvent) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press(key);
      },
      onPointerUp: finishPress,
      onPointerCancel: finishPress,
    };
  };

  return (
    <section className="game-shell mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-3 py-4 sm:px-6 lg:px-8">
      <header className="game-header flex flex-col gap-3 border-b border-cyan-300/15 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300/75">
            Journey 01 · Final Boss Route
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-50 sm:text-4xl">
            NEON KARATE <span className="text-cyan-300">{'// 城市道場'}</span>
          </h1>
          <p
            className={`mr-2 mt-2 inline-flex rounded-full border px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] ${gunMode ? 'border-cyan-300/35 bg-cyan-300/10 text-cyan-200' : 'border-amber-300/25 bg-amber-300/10 text-amber-200'}`}
          >
            {gunMode ? `Pistol · ${journeyView.ammo} 發` : 'Bare Hands'}
          </p>
          <p className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[.04] px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
            {PLAYER_NAMES[playerCharacter]} · Stage {journeyView.encounter}/
            {journeyView.total} · {journeyView.phase}
          </p>
          <p className="ml-2 mt-2 inline-flex rounded-full border border-emerald-300/20 bg-emerald-300/[.07] px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
            ${journeyView.cash} · 飲料 ×{journeyView.energyDrinks}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={start}
            disabled={status === 'LOADING' || status === 'ERROR'}
            size="lg"
            className="border border-cyan-300/35 bg-cyan-300 text-slate-950 shadow-[0_0_28px_rgba(34,211,238,.22)] hover:bg-cyan-200"
          >
            {status === 'FIGHTING' || status === 'PAUSED' ? (
              <RotateCcw />
            ) : (
              <Play />
            )}
            {startLabel}
          </Button>
          {!isInstalled && (
            <Button onClick={installGame} variant="outline" size="lg">
              <Download /> 下載到手機
            </Button>
          )}
          <Button
            onClick={toggleWeaponControl}
            variant="outline"
            size="lg"
            disabled={status === 'LOADING' || status === 'ERROR'}
          >
            <Crosshair />{' '}
            {gunMode ? '切回拳腳' : `裝備手槍 ${journeyView.ammo} 發`}
          </Button>
          <Button
            onClick={useDrinkControl}
            variant="outline"
            size="lg"
            disabled={journeyView.energyDrinks <= 0 || journeyView.complete}
          >
            <HeartPulse /> 補血 ×{journeyView.energyDrinks}
          </Button>
          <Button
            onClick={toggleDebug}
            variant="outline"
            size="lg"
            aria-pressed={debug}
          >
            <Bug /> Debug
          </Button>
          <Button
            onClick={toggleBoxes}
            variant="outline"
            size="lg"
            aria-pressed={showBoxes}
          >
            <Crosshair /> Hitbox
          </Button>
          <Button
            onClick={toggleSound}
            variant="outline"
            size="icon-lg"
            aria-label="切換音效"
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
        </div>
      </header>

      <div className="rival-select character-select" aria-label="選擇玩家角色">
        <button
          type="button"
          onClick={() => chooseCharacter('fio')}
          disabled={status === 'FIGHTING' || status === 'PAUSED'}
          aria-pressed={playerCharacter === 'fio'}
          className={`rival-card ${playerCharacter === 'fio' ? 'selected' : ''}`}
          style={
            playerCharacter === 'fio'
              ? { borderColor: '#67e8f9', boxShadow: '0 0 24px #67e8f922' }
              : undefined
          }
        >
          <span className="rival-index text-cyan-300">PLAYER 01 // 靈巧型</span>
          <strong>FIO · 白閃</strong>
          <small>速度與段位控制均衡，適合精準反擊。</small>
          <span className="rival-tendency">拳腳完整 · 現代雙手持槍</span>
        </button>
        <button
          type="button"
          onClick={() => chooseCharacter('kai')}
          disabled={status === 'FIGHTING' || status === 'PAUSED'}
          aria-pressed={playerCharacter === 'kai'}
          className={`rival-card ${playerCharacter === 'kai' ? 'selected' : ''}`}
          style={
            playerCharacter === 'kai'
              ? { borderColor: '#fbbf24', boxShadow: '0 0 24px #fbbf2422' }
              : undefined
          }
        >
          <span className="rival-index text-amber-300">
            PLAYER 02 // 快拳型
          </span>
          <strong>KAI · 瞬拳</strong>
          <small>男性可操控角色，近身拳速俐落、動作完整。</small>
          <span className="rival-tendency">拳腳完整 · 現代雙手持槍</span>
        </button>
        <div className="rival-card journey-card" aria-label="闖關規則">
          <span className="rival-index text-rose-300">ROUTE // 11 戰</span>
          <strong>一路前進，最後打 Boss</strong>
          <small>
            十名小兵逐步增強；每打倒一人獲得 $10，最後一戰挑戰 Boss。
          </small>
          <span className="rival-tendency">
            每 5 人可進商店 · 飲料與子彈包各 $20
          </span>
        </div>
      </div>

      <div className="game-stage relative overflow-hidden rounded-[18px] border border-cyan-200/20 bg-slate-950 shadow-[0_28px_100px_rgba(0,0,0,.45)]">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          tabIndex={0}
          aria-label="霓虹空手道遊戲畫面"
          className="game-canvas block aspect-video h-auto w-full outline-none ring-cyan-300/50 focus-visible:ring-2"
        />
        {(status === 'LOADING' || status === 'ERROR') && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/80 backdrop-blur-sm">
            <div className="px-6 text-center">
              <p className="font-mono text-sm font-black uppercase tracking-[0.24em] text-cyan-200">
                {status === 'LOADING'
                  ? 'Loading Fight Data…'
                  : 'Asset Load Failed'}
              </p>
              <p className="mt-3 text-sm text-slate-400">
                {status === 'LOADING'
                  ? '正在載入場景、角色與招式資料'
                  : '請重新整理頁面再試一次'}
              </p>
            </div>
          </div>
        )}
        {status === 'PAUSED' && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/65 backdrop-blur-sm">
            <div className="text-center">
              <p className="text-5xl font-black text-cyan-200">PAUSED</p>
              <p className="mt-2 font-mono text-sm text-slate-300">按 P 繼續</p>
            </div>
          </div>
        )}
        {journeyView.phase === 'CHECKPOINT' && (
          <div className="checkpoint-overlay" aria-label="闖關檢查點">
            <div className="checkpoint-card">
              <span>CHECKPOINT // 已擊倒 {journeyView.minionsDefeated} 人</span>
              <h2>現金 ${journeyView.cash}</h2>
              <p>要進商店補充物資，還是直接迎戰下一位敵人？</p>
              <div>
                <button type="button" onClick={enterShopControl}>
                  <ShoppingCart /> 進入商店
                </button>
                <button type="button" onClick={continueJourneyControl}>
                  繼續前進
                </button>
              </div>
            </div>
          </div>
        )}
        {journeyView.phase === 'SHOP' && (
          <div className="checkpoint-overlay" aria-label="補給商店">
            <div className="checkpoint-card shop-card">
              <span>SUPPLY SHOP // 現金 ${journeyView.cash}</span>
              <h2>選擇補給品</h2>
              <div className="shop-grid">
                <button
                  type="button"
                  onClick={buyDrinkControl}
                  disabled={journeyView.cash < ENERGY_DRINK_COST}
                >
                  <HeartPulse />
                  <strong>能量飲料</strong>
                  <small>
                    隨時補 {ENERGY_DRINK_HEAL} HP · 已有{' '}
                    {journeyView.energyDrinks}
                  </small>
                  <b>${ENERGY_DRINK_COST}</b>
                </button>
                <button
                  type="button"
                  onClick={buyAmmoControl}
                  disabled={journeyView.cash < AMMO_PACK_COST}
                >
                  <Crosshair />
                  <strong>子彈包</strong>
                  <small>
                    增加 {AMMO_PACK_SIZE} 發 · 現有 {journeyView.ammo}
                  </small>
                  <b>${AMMO_PACK_COST}</b>
                </button>
              </div>
              <button
                type="button"
                className="leave-shop-button"
                onClick={continueJourneyControl}
              >
                離開商店，繼續前進
              </button>
            </div>
          </div>
        )}
        {status !== 'LOADING' && status !== 'ERROR' && (
          <div
            className="mobile-landscape-controls"
            aria-label="手機橫向虛擬鍵盤"
          >
            <div className="mobile-dpad" aria-label="方向控制">
              <span />
              <button
                aria-label="上段，按住後再按攻擊"
                {...holdProps('arrowup')}
              >
                ↑
              </button>
              <span />
              <button aria-label="後退" {...holdProps('arrowleft')}>
                ←
              </button>
              <button
                aria-label="蹲下或下段，按住後再按攻擊"
                {...holdProps('arrowdown')}
              >
                ↓
              </button>
              <button aria-label="前進" {...holdProps('arrowright')}>
                →
              </button>
            </div>
            {(status === 'READY' || status === 'KO' || status === 'PAUSED') && (
              <button className="mobile-start-button" onClick={start}>
                {startLabel}
              </button>
            )}
            {!isInstalled && (
              <button
                className="mobile-install-button"
                onClick={installGame}
                aria-label="安裝遊戲到手機"
              >
                <Download />
                <span>安裝</span>
              </button>
            )}
            <button
              className="mobile-weapon-button"
              onClick={toggleWeaponControl}
              aria-label="切換拳腳與手槍"
            >
              <Crosshair />
              <span>{gunMode ? '拳腳' : `手槍 ${journeyView.ammo}`}</span>
            </button>
            <button
              className="mobile-energy-button"
              onClick={useDrinkControl}
              disabled={journeyView.energyDrinks <= 0 || journeyView.complete}
              aria-label="使用能量飲料補血"
            >
              <HeartPulse />
              <span>補血 {journeyView.energyDrinks}</span>
            </button>
            <div className="mobile-attack-pad" aria-label="攻擊控制">
              {activeKeyLabels.map(({ input, label, tone }) => (
                <button
                  key={`mobile-${input}`}
                  className={tone}
                  aria-label={label}
                  disabled={status !== 'FIGHTING'}
                  {...holdProps(input.toLowerCase())}
                >
                  <span>{label}</span>
                  <kbd>{input}</kbd>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="standard-controls grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[.035] p-3">
          <span />
          <button
            className="control-button"
            aria-label="上段修飾"
            {...holdProps('arrowup')}
          >
            ↑
          </button>
          <span />
          <button
            className="control-button"
            aria-label="後退"
            {...holdProps('arrowleft')}
          >
            ←
          </button>
          <button
            className="control-button"
            aria-label="蹲下"
            {...holdProps('arrowdown')}
          >
            ↓
          </button>
          <button
            className="control-button"
            aria-label="前進"
            {...holdProps('arrowright')}
          >
            →
          </button>
          <span />
          <span className="self-center text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">
            移動
          </span>
          <span />
        </div>

        <div className="flex items-center justify-center px-5 text-center">
          <p className="max-w-48 font-mono text-[11px] leading-5 text-slate-400">
            {gunMode ? (
              <>
                ↑ / ↓ 選段位
                <br />Q 射擊 · W 腳 · E 切拳
              </>
            ) : (
              <>
                ↑ + 攻擊：上段 · 直接攻擊：中段
                <br />↓ + 攻擊：下段
                <br />Q 拳 · W 腳
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[.035] p-3">
          {activeKeyLabels.map(({ input, label, tone }) => (
            <button
              key={input}
              className={`attack-button ${tone}`}
              aria-label={`${label}，鍵盤 ${input}`}
              {...holdProps(input.toLowerCase())}
            >
              <kbd>{input}</kbd>
              <span>{label}</span>
            </button>
          ))}
          <button
            className="attack-button shot"
            aria-label="切換拳腳與手槍，鍵盤 E"
            onClick={toggleWeaponControl}
          >
            <kbd>E</kbd>
            <span>{gunMode ? '拳腳' : `手槍 ${journeyView.ammo}`}</span>
          </button>
          <button
            className="attack-button energy"
            aria-label="使用能量飲料補血，鍵盤 V"
            onClick={useDrinkControl}
            disabled={journeyView.energyDrinks <= 0 || journeyView.complete}
          >
            <kbd>V</kbd>
            <span>補血 {journeyView.energyDrinks}</span>
          </button>
        </div>
      </div>

      <footer className="game-footer flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
        <p>
          {journeyView.phase === 'TRAVEL'
            ? '自動前進中 · 敵人出現後開戰'
            : `目前對手 · ${activeOpponent?.archetype ?? '載入中'}`}
        </p>
        <p>
          方向鍵移動／選段位 · Q 拳或射擊 · W 腳 · E 切換武器 · V 補血 · R
          重新闖關
        </p>
      </footer>
      {showInstallHelp && (
        <div className="install-help-backdrop">
          <dialog
            open
            className="install-help-card"
            aria-modal="true"
            aria-labelledby="install-help-title"
          >
            <button
              className="install-help-close"
              onClick={() => setShowInstallHelp(false)}
              aria-label="關閉安裝說明"
            >
              <X />
            </button>
            <Smartphone className="install-help-icon" aria-hidden="true" />
            <h2 id="install-help-title">下載到手機遊玩</h2>
            <p>
              <strong>iPhone／iPad：</strong>使用 Safari
              開啟，按「分享」後選擇「加入主畫面」。
            </p>
            <p>
              <strong>Android：</strong>使用 Chrome
              開啟選單，選擇「安裝應用程式」或「加到主畫面」。
            </p>
            <p className="install-help-note">
              安裝完成後可直接從手機桌面啟動，橫置即可使用虛擬按鍵。
            </p>
          </dialog>
        </div>
      )}
    </section>
  );
}

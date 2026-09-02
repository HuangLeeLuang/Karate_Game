'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Bug, Crosshair, Download, Play, RotateCcw, Smartphone, Volume2, VolumeX, X } from 'lucide-react';

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

interface MatchView {
  playerRounds: number;
  enemyRounds: number;
  roundNumber: number;
  matchOver: boolean;
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
  gunSheet: HTMLImageElement;
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
  playerRounds: number;
  enemyRounds: number;
  roundNumber: number;
  roundResolved: boolean;
  matchOver: boolean;
  hitStop: number;
  shake: number;
  debug: boolean;
  showBoxes: boolean;
  sound: boolean;
  gunMode: boolean;
  secretIndex: number;
  audio: AudioContext | null;
  lastTime: number;
  frameHandle: number;
  onStatus: (status: GameStatus) => void;
  onGunMode: (enabled: boolean) => void;
  onAIChange: (index: number) => void;
  onMatchChange: (match: MatchView) => void;
}

const levelIndex: Record<AttackLevel, number> = { HIGH: 0, MID: 1, LOW: 2 };
const PLAYER_ACTION_SIZE = 382;
const PLAYER_REACTION_SIZE = 448;
const PLAYER_GUARD_SIZE = 420;
const PLAYER_GUN_SIZE = 359;
const PLAYER_GUN_GROUND_OFFSET = 3;
const ENEMY_ACTION_SIZES = [372, 367, 375] as const;
const ENEMY_FRAME_RECTS = [
  [
    [132, 15, 192, 289], [538, 16, 257, 287], [990, 19, 234, 285], [1370, 106, 298, 196],
    [105, 326, 264, 253], [518, 320, 279, 260], [963, 412, 279, 161], [1419, 328, 187, 250],
    [127, 598, 188, 256], [559, 615, 164, 238], [1019, 667, 153, 186], [1365, 753, 304, 105],
  ],
  [
    [112, 11, 201, 331], [449, 13, 321, 327], [895, 25, 305, 315], [1260, 124, 331, 218],
    [94, 358, 276, 294], [468, 353, 286, 298], [869, 454, 357, 191], [1359, 342, 171, 306],
    [56, 662, 267, 245], [454, 676, 196, 232], [912, 708, 183, 202], [1227, 792, 415, 125],
  ],
  [
    [141, 17, 214, 317], [543, 17, 310, 315], [942, 32, 297, 302], [1377, 134, 278, 198],
    [112, 343, 260, 264], [531, 337, 265, 272], [912, 421, 333, 188], [1365, 377, 278, 234],
    [154, 627, 224, 229], [558, 644, 200, 212], [937, 665, 297, 190], [1323, 729, 353, 128],
  ],
] as const;
const PLAYER_ACTION_GROUND_OFFSETS = [15, 17, 16, 18, 37, 36, 34, 32] as const;
const PLAYER_REACTION_GROUND_OFFSETS = [35, 34, 35, 37] as const;
const PLAYER_GUARD_GROUND_OFFSETS = [25, 31, 28, 31] as const;
const attackInputByLevel: Record<'PUNCH' | 'KICK' | 'GUN', Record<AttackLevel, string>> = {
  PUNCH: { HIGH: 'q', MID: 'a', LOW: 'z' },
  KICK: { HIGH: 'w', MID: 's', LOW: 'x' },
  GUN: { HIGH: 'q', MID: 'a', LOW: 'z' },
};
const secretSequence = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'q', 'w'];

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
  readonly displayName: string;
  x: number;
  direction: Direction;
  hp = 100;
  stamina = 100;
  state = 'IDLE';
  crouching = false;
  moveIntent = 0;
  attack: AttackRuntime | null = null;
  stunFrames = 0;

  constructor(id: 'player' | 'enemy', displayName: string, x: number, direction: Direction) {
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
    return Boolean(this.attack) || this.stunFrames > 0 || this.state === 'GRAPPLE' || this.state === 'KNOCKDOWN';
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
      this.state = this.moveIntent === this.direction ? 'MOVE_FORWARD' : 'MOVE_BACKWARD';
    } else if (this.crouching) {
      this.state = 'CROUCH';
    } else {
      this.state = 'IDLE';
    }

    this.stamina = Math.min(100, this.stamina + (this.crouching ? 15 : 22) * dt);
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
    const playerReachBonus = this.id === 'player' ? PLAYER_MELEE_REACH_BONUS[data.attackType] : 0;
    const extension = data.range + (data.attackType === 'KICK' ? 26 : 10) + playerReachBonus;
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

  receiveHit(data: AttackData, direction: Direction, counter: boolean, guarded: boolean) {
    if (guarded) {
      this.hp = Math.max(0, this.hp - Math.max(1, Math.round(data.damage * 0.18)));
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

function playTone(world: World, frequency: number, duration = 0.06, gain = 0.04) {
  if (!world.sound || !world.audio) return;
  const oscillator = world.audio.createOscillator();
  const volume = world.audio.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(frequency, world.audio.currentTime);
  volume.gain.setValueAtTime(gain, world.audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.0001, world.audio.currentTime + duration);
  oscillator.connect(volume).connect(world.audio.destination);
  oscillator.start();
  oscillator.stop(world.audio.currentTime + duration);
}

function setStatus(world: World, status: GameStatus) {
  if (world.status === status) return;
  world.status = status;
  world.onStatus(status);
}

function enableGunMode(world: World) {
  if (world.gunMode) return;
  if (!world.audio) world.audio = new AudioContext();
  world.gunMode = true;
  world.secretIndex = 0;
  world.onGunMode(true);
  world.banner = { text: 'SECRET MODE', subtext: '↑ / ↓ 選段位 · Q 射擊 · W 踢擊', color: '#22d3ee', life: 2.4 };
  playTone(world, 520, 0.08, 0.04);
  window.setTimeout(() => playTone(world, 680, 0.08, 0.04), 90);
  window.setTimeout(() => playTone(world, 920, 0.14, 0.05), 180);
}

function trackSecretInput(world: World, key: string) {
  if (world.status !== 'READY' || world.gunMode) return;
  if (key === secretSequence[world.secretIndex]) {
    world.secretIndex += 1;
    if (world.secretIndex === secretSequence.length) enableGunMode(world);
    return;
  }
  world.secretIndex = key === secretSequence[0] ? 1 : 0;
}

function emitMatch(world: World) {
  world.onMatchChange({
    playerRounds: world.playerRounds,
    enemyRounds: world.enemyRounds,
    roundNumber: world.roundNumber,
    matchOver: world.matchOver,
  });
}

function resetWorld(world: World, resetMatch = false) {
  if (resetMatch) {
    world.playerRounds = 0;
    world.enemyRounds = 0;
    world.roundNumber = 1;
    world.matchOver = false;
  } else if (world.roundResolved) {
    world.roundNumber += 1;
  }
  world.roundResolved = false;
  world.player.reset(350, 1);
  world.enemy.reset(930, -1);
  world.grapple = null;
  world.projectiles = [];
  world.impacts = [];
  world.banner = {
    text: world.gunMode ? `SECRET ROUND ${world.roundNumber}` : `ROUND ${world.roundNumber}`,
    subtext: world.gunMode
      ? `Q = SHOT · W = KICK // ${world.playerRounds}–${world.enemyRounds}`
      : `${world.ai.archetype} // FIRST TO 2`,
    color: world.gunMode ? '#22d3ee' : '#ffe08a',
    life: 1.2,
  };
  world.aiDecisionTimer = 0.45;
  world.aiRetreatTimer = 0;
  world.hitStop = 0;
  world.shake = 0;
  world.keys.clear();
  world.justPressed.clear();
  emitMatch(world);
  setStatus(world, 'FIGHTING');
  playTone(world, 420, 0.12, 0.035);
}

function selectAI(world: World, index: number) {
  if (world.status === 'FIGHTING' || world.status === 'PAUSED') return;
  const nextIndex = clamp(index, 0, world.ais.length - 1);
  const nextAI = world.ais[nextIndex];
  if (!nextAI) return;
  world.aiIndex = nextIndex;
  world.ai = nextAI;
  world.player.reset(350, 1);
  world.enemy.reset(930, -1);
  world.grapple = null;
  world.projectiles = [];
  world.impacts = [];
  world.banner = null;
  world.secretIndex = 0;
  world.playerRounds = 0;
  world.enemyRounds = 0;
  world.roundNumber = 1;
  world.roundResolved = false;
  world.matchOver = false;
  world.onAIChange(nextIndex);
  emitMatch(world);
  setStatus(world, 'READY');
  playTone(world, 320 + nextIndex * 90, 0.08, 0.025);
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
  world.banner = { text: 'GRAPPLE!', subtext: '立刻按 ← 或 →', color: '#fbbf24', life: 0.7 };
  world.hitStop = 0.09;
  playTone(world, 190, 0.1, 0.05);
}

function resolveGrapple(world: World) {
  if (!world.grapple) return;
  const grapple = world.grapple;
  const playerTiming = grapple.playerChoice ? 14 + grapple.timer * 28 : -12;
  const directionRead = grapple.playerChoice !== grapple.aiChoice ? 9 : -4;
  const playerPower = world.player.stamina * 0.035 + playerTiming + directionRead + Math.random() * 1.5;
  const enemyPower = world.enemy.stamina * 0.035 + 15 + Math.random() * 1.5;
  const playerWins = playerPower >= enemyPower;
  const winner = playerWins ? world.player : world.enemy;
  const loser = playerWins ? world.enemy : world.player;
  const throwDirection: Direction = playerWins
    ? grapple.playerChoice ?? winner.direction
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
  world.impacts.push({ x: loser.x, y: GROUND_Y - 30, life: 0.55, color: '#fbbf24' });
  world.hitStop = 0.13;
  world.shake = 12;
  world.grapple = null;
  playTone(world, 86, 0.16, 0.065);
}

function tryGrapple(world: World) {
  const playerAttack = world.player.attack;
  const enemyAttack = world.enemy.attack;
  if (!playerAttack || !enemyAttack) return false;
  if (world.player.phase !== 'ACTIVE' || world.enemy.phase !== 'ACTIVE') return false;
  if (playerAttack.data.attackType !== 'PUNCH' || enemyAttack.data.attackType !== 'PUNCH') return false;
  if (!playerAttack.data.canTriggerGrapple || !enemyAttack.data.canTriggerGrapple) return false;
  const levelGap = Math.abs(
    levelIndex[playerAttack.data.attackLevel] - levelIndex[enemyAttack.data.attackLevel],
  );
  if (levelGap > 1 || Math.abs(world.player.x - world.enemy.x) > 128) return false;
  const playerBox = world.player.attackBox();
  const enemyBox = world.enemy.attackBox();
  if (!playerBox || !enemyBox || !rectsOverlap(playerBox, enemyBox)) return false;
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
    color: guarded ? '#7dd3fc' : runtime.data.attackType === 'KICK' ? '#fb7185' : '#fbbf24',
  });
  world.hitStop = guarded ? 0.035 : counter ? 0.085 : runtime.data.attackType === 'KICK' ? 0.065 : 0.04;
  world.shake = guarded ? 2 : counter ? 9 : runtime.data.attackType === 'KICK' ? 6 : 4;
  if (counter) playTone(world, 760, 0.09, 0.055);
  else if (guarded) playTone(world, 260, 0.05, 0.025);
  else {
    playTone(world, runtime.data.attackType === 'KICK' ? 120 : 180, 0.065, 0.04);
  }
}

function chooseAIAttack(world: World, distance: number) {
  const ai = world.ai;
  const playerAttack = world.player.attack?.data;
  if (
    playerAttack?.attackType === 'PUNCH' &&
    (world.player.phase === 'STARTUP' || world.player.phase === 'ACTIVE') &&
    distance < 132 &&
    Math.random() < ai.grappleRate
  ) {
    const matchingPunch = world.attacks.find(
      (attack) => attack.attackType === 'PUNCH' && attack.attackLevel === playerAttack.attackLevel,
    );
    if (matchingPunch) return matchingPunch;
  }

  if (world.player.phase === 'RECOVERY' && Math.random() < ai.counterRate) {
    const counterPunch = world.attacks.find(
      (attack) => attack.attackType === 'PUNCH' && attack.attackLevel === 'MID',
    );
    if (counterPunch && distance <= counterPunch.range + 78) return counterPunch;
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
  return candidates.find((attack) => attack.attackLevel === level) ?? candidates[1];
}

function updateAI(world: World, dt: number) {
  const enemy = world.enemy;
  const player = world.player;
  if (enemy.busy) {
    enemy.moveIntent = 0;
    return;
  }
  enemy.crouching = false;
  const incoming = world.projectiles.find((projectile) =>
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
    enemy.moveIntent = Math.random() < world.ai.retreatRate ? -enemy.direction : 0;
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
      (attack) => attack.attackType === 'PUNCH' && attack.attackLevel === incomingPunch.attackLevel,
    );
    if (matchingPunch && enemy.beginAttack(matchingPunch)) {
      enemy.moveIntent = 0;
      playTone(world, 185, 0.04, 0.016);
      return;
    }
  }

  if (world.aiDecisionTimer > 0) return;
  world.aiDecisionTimer = (world.ai.reactionFrames / FPS) * (0.75 + Math.random() * 0.55);
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
  if (distance > world.ai.preferredMaxRange + 72 || Math.random() > world.ai.aggression) return;

  const attack = chooseAIAttack(world, distance);
  if (!attack) return;
  const practicalRange = attack.range + (attack.attackType === 'KICK' ? 88 : 78);
  if (distance <= practicalRange) {
    enemy.beginAttack(attack);
    playTone(world, attack.attackType === 'KICK' ? 145 : 220, 0.035, 0.012);
    if (attack.attackType === 'KICK' && Math.random() < world.ai.retreatRate) world.aiRetreatTimer = 0.3;
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
    const type = input === 'q' ? (world.gunMode ? 'GUN' : 'PUNCH') : 'KICK';
    const mappedInput = attackInputByLevel[type][level];
    const attack = type === 'GUN'
      ? world.gunAttackByInput.get(mappedInput)
      : world.meleeAttackByInput.get(mappedInput);
    if (attack && player.beginAttack(attack)) {
      playTone(world, attack.attackType === 'GUN' ? 430 : attack.attackType === 'KICK' ? 150 : 240, 0.04, 0.016);
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
    ) continue;

    runtime.hitResolved = true;
    const speed = runtime.data.projectileSpeed ?? 1400;
    const muzzle = fighter.id === 'player'
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
    const crossedTarget = collider.x < targetBox.x + targetBox.w && collider.x + collider.w > targetBox.x;
    const evadedByStance = projectile.data.attackLevel === 'HIGH' && defender.crouching;
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
  world.projectiles = world.projectiles.filter((projectile) =>
    projectile.lifetime > 0 && projectile.x > -60 && projectile.x < WIDTH + 60,
  );
}

function checkKO(world: World) {
  if (world.roundResolved || (world.player.hp > 0 && world.enemy.hp > 0)) return;
  const playerWon = world.enemy.hp <= 0;
  const loser = playerWon ? world.enemy : world.player;
  world.roundResolved = true;
  if (playerWon) world.playerRounds += 1;
  else world.enemyRounds += 1;
  world.matchOver = world.playerRounds >= 2 || world.enemyRounds >= 2;
  loser.state = 'KNOCKDOWN';
  loser.stunFrames = 9999;
  world.banner = {
    text: world.matchOver
      ? playerWon
        ? 'MATCH WON'
        : 'MATCH LOST'
      : playerWon
        ? `ROUND ${world.roundNumber} WON`
        : `ROUND ${world.roundNumber} LOST`,
    subtext: world.matchOver
      ? `FINAL ${world.playerRounds}–${world.enemyRounds} // 按 R 再戰`
      : `SCORE ${world.playerRounds}–${world.enemyRounds} // 按 R 下一回合`,
    color: playerWon ? '#67e8f9' : '#fb7185',
    life: 999,
  };
  emitMatch(world);
  setStatus(world, 'KO');
  world.hitStop = 0;
  world.shake = 0;
  world.impacts = [];
  playTone(world, playerWon ? 520 : 96, 0.3, 0.06);
}

function updateWorld(world: World, dt: number) {
  if (world.status !== 'FIGHTING') return;

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

  world.player.direction = world.player.x <= world.enemy.x ? 1 : -1;
  world.enemy.direction = world.enemy.x <= world.player.x ? 1 : -1;

  if (world.grapple) {
    world.grapple.timer -= dt;
    if (world.justPressed.has('arrowleft')) world.grapple.playerChoice = -1;
    if (world.justPressed.has('arrowright')) world.grapple.playerChoice = 1;
    if (world.grapple.playerChoice || world.grapple.timer <= 0) resolveGrapple(world);
    world.justPressed.clear();
    checkKO(world);
    return;
  }

  handlePlayer(world);
  updateAI(world, dt);
  world.player.update(dt);
  world.enemy.update(dt);
  updateProjectiles(world, dt);

  world.player.x = clamp(world.player.x, FIGHTER_STAGE_MARGIN, WIDTH - FIGHTER_STAGE_MARGIN);
  world.enemy.x = clamp(world.enemy.x, FIGHTER_STAGE_MARGIN, WIDTH - FIGHTER_STAGE_MARGIN);
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
  roundedRect(ctx, alignRight ? x + width - 2 - fillWidth : x + 2, y + 2, fillWidth, 14, 7);
  ctx.fillStyle = color;
  ctx.fill();
}

function actionFrameFor(fighter: Fighter) {
  if (fighter.state === 'KNOCKDOWN' || fighter.state.startsWith('HIT_')) return 0;
  if (fighter.state === 'THROW') return 2;
  if (!fighter.attack) return 0;

  const { data, frame } = fighter.attack;
  if (data.attackType === 'GUN') return 0;
  const actionFrame = data.attackType === 'PUNCH'
    ? { HIGH: 1, MID: 2, LOW: 3 }[data.attackLevel]
    : { HIGH: 4, MID: 5, LOW: 6 }[data.attackLevel];
  const activeEnd = data.startupFrames + data.activeFrames;
  const total = activeEnd + data.recoveryFrames;
  if (frame < data.startupFrames * 0.42 || frame > total - data.recoveryFrames * 0.36) return 0;
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
  const drawX = -nominalCellWidth * scale / 2 + (sourceX - column * nominalCellWidth) * scale + xOffset;
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
  if (frame < data.startupFrames * 0.38 || frame > total - data.recoveryFrames * 0.32) return 0;
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

function drawFighter(ctx: CanvasRenderingContext2D, world: World, fighter: Fighter) {
  const isEnemy = fighter.id === 'enemy';
  const attack = fighter.attack?.data;
  const frame = actionFrameFor(fighter);
  const reactionFrame = reactionFrameFor(fighter);
  const guardFrame = guardFrameFor(fighter);
  const guardLevel = fighter.guardLevel;
  const gunFrame = gunFrameFor(fighter);
  const isHitPose = reactionFrame !== null;
  const isGuardPose = guardFrame !== null && guardLevel !== null;
  const baseY = GROUND_Y;
  const isCrouchPose = fighter.crouching && !isHitPose && !isGuardPose && !attack;
  const useGunPose = fighter.id === 'player' && world.gunMode && !isHitPose && !isGuardPose && !isCrouchPose && (!attack || attack.attackType === 'GUN');
  const combatSheet = isEnemy ? world.enemySheets[world.aiIndex] : world.actionSheet;
  const combatSheetRows = isEnemy ? 3 : 2;
  const attackTotal = attack
    ? attack.startupFrames + attack.activeFrames + attack.recoveryFrames
    : 1;
  const attackProgress = fighter.attack ? clamp(fighter.attack.frame / attackTotal, 0, 1) : 0;
  const actionPulse = attack ? Math.sin(Math.PI * attackProgress) : 0;
  const activeThrust = attack && attack.attackType !== 'GUN'
    ? actionPulse * (attack.attackType === 'KICK' ? 42 : 28)
    : 0;
  const attackRotation = attack && attack.attackType !== 'GUN'
    ? fighter.direction * actionPulse * (attack.attackType === 'KICK' ? -0.055 : -0.025)
    : 0;
  const enemyActionSize = ENEMY_ACTION_SIZES[world.aiIndex] ?? ENEMY_ACTION_SIZES[0];
  const enemyFrameRects = ENEMY_FRAME_RECTS[world.aiIndex] ?? ENEMY_FRAME_RECTS[0];
  const actionSize = isEnemy ? enemyActionSize : PLAYER_ACTION_SIZE;
  const actionGroundOffset = PLAYER_ACTION_GROUND_OFFSETS[frame] ?? PLAYER_ACTION_GROUND_OFFSETS[0];

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
    if (isEnemy) {
      const enemyReactionFrame = reactionFrame + 8;
      drawEnemyActionFrame(ctx, combatSheet, enemyReactionFrame, enemyActionSize, enemyFrameRects[enemyReactionFrame]);
    } else {
      drawActionFrame(ctx, world.playerReactionSheet, reactionFrame, PLAYER_REACTION_SIZE, 0, 1, PLAYER_REACTION_GROUND_OFFSETS[reactionFrame] ?? 0);
    }
  } else if (isGuardPose && guardFrame !== null) {
    if (isEnemy) {
      const enemyGuardFrame = guardFrame + 7;
      drawEnemyActionFrame(ctx, combatSheet, enemyGuardFrame, enemyActionSize, enemyFrameRects[enemyGuardFrame]);
    } else {
      drawActionFrame(ctx, world.playerGuardSheet, guardFrame, PLAYER_GUARD_SIZE, 0, 1, PLAYER_GUARD_GROUND_OFFSETS[guardFrame] ?? 0);
    }
  } else if (isCrouchPose) {
    if (isEnemy) drawEnemyActionFrame(ctx, combatSheet, 10, enemyActionSize, enemyFrameRects[10]);
    else drawActionFrame(ctx, world.playerGuardSheet, 3, PLAYER_GUARD_SIZE, 0, 1, PLAYER_GUARD_GROUND_OFFSETS[3]);
  } else if (useGunPose) drawGunFrame(ctx, world.gunSheet, gunFrame, PLAYER_GUN_SIZE);
  else if (isEnemy) drawEnemyActionFrame(ctx, combatSheet, frame, enemyActionSize, enemyFrameRects[frame]);
  else drawActionFrame(ctx, combatSheet, frame, actionSize, 0, combatSheetRows, actionGroundOffset);
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
  const shakeY = world.shake > 0 ? (Math.random() - 0.5) * world.shake * 0.45 : 0;
  ctx.translate(shakeX, shakeY);
  ctx.drawImage(world.stage, 0, 0, WIDTH, HEIGHT);
  const stageShade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  stageShade.addColorStop(0, 'rgba(2, 6, 23, .1)');
  stageShade.addColorStop(0.62, 'rgba(2, 6, 23, .05)');
  stageShade.addColorStop(1, 'rgba(2, 6, 23, .46)');
  ctx.fillStyle = stageShade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (const projectile of world.projectiles) {
    ctx.save();
    const direction = Math.sign(projectile.velocityX);
    const trailLength = 54;
    const gradient = ctx.createLinearGradient(
      projectile.x - direction * trailLength,
      projectile.y,
      projectile.x,
      projectile.y,
    );
    gradient.addColorStop(0, 'rgba(34, 211, 238, 0)');
    gradient.addColorStop(1, '#e0f2fe');
    ctx.strokeStyle = gradient;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(projectile.x - direction * trailLength, projectile.y);
    ctx.lineTo(projectile.x, projectile.y);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(projectile.x, projectile.y, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (world.showBoxes) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.strokeRect(projectile.x - 13, projectile.y - 8, 26, 16);
    }
    ctx.restore();
  }

  drawFighter(ctx, world, world.enemy);
  drawFighter(ctx, world, world.player);
  ctx.restore();

  const topGradient = ctx.createLinearGradient(0, 0, 0, 125);
  topGradient.addColorStop(0, 'rgba(1, 5, 16, .94)');
  topGradient.addColorStop(1, 'rgba(1, 5, 16, .18)');
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, WIDTH, 140);

  ctx.font = '700 17px ui-monospace, monospace';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText('FIO // 白閃', 54, 38);
  ctx.textAlign = 'right';
  ctx.fillText(world.ai.name.toUpperCase(), WIDTH - 54, 38);
  ctx.textAlign = 'left';
  drawBar(ctx, 54, 52, 430, world.player.hp, '#22d3ee');
  drawBar(ctx, WIDTH - 484, 52, 430, world.enemy.hp, '#fb7185', true);
  drawBar(ctx, 54, 79, 282, world.player.stamina, '#fbbf24');
  drawBar(ctx, WIDTH - 336, 79, 282, world.enemy.stamina, '#fbbf24', true);
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(226, 232, 240, .8)';
  ctx.fillText(`HP ${Math.ceil(world.player.hp)}   ST ${Math.ceil(world.player.stamina)}`, 54, 111);
  ctx.textAlign = 'right';
  ctx.fillText(`ST ${Math.ceil(world.enemy.stamina)}   HP ${Math.ceil(world.enemy.hp)}`, WIDTH - 54, 111);
  ctx.textAlign = 'center';
  ctx.font = '900 22px ui-monospace, monospace';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('NEON KARATE', WIDTH / 2, 47);
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.fillStyle = '#67e8f9';
  ctx.fillText(world.gunMode ? 'SECRET GUN MODE // ACTIVE' : 'CITY DOJO // PROTOTYPE 05', WIDTH / 2, 68);
  const playerRoundMarks = `${'◆'.repeat(world.playerRounds)}${'◇'.repeat(2 - world.playerRounds)}`;
  const enemyRoundMarks = `${'◆'.repeat(world.enemyRounds)}${'◇'.repeat(2 - world.enemyRounds)}`;
  ctx.font = '900 13px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(226, 232, 240, .86)';
  ctx.fillText(`${playerRoundMarks}   ROUND ${world.roundNumber}   ${enemyRoundMarks}`, WIDTH / 2, 96);

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
          ? 'SECRET MODE READY // 按下開始'
          : '按下開始，進入三戰兩勝',
      WIDTH / 2,
      330,
    );
    if (world.status === 'READY') {
      ctx.font = '700 14px ui-monospace, monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('BEST OF 3 // FIRST TO TWO ROUNDS', WIDTH / 2, 365);
      ctx.fillStyle = world.gunMode ? '#a5f3fc' : 'rgba(226, 232, 240, .62)';
      ctx.fillText(
        world.gunMode
          ? '↑ / ↓ 選段位 · Q 射擊 · W 踢擊'
          : 'CITY RUMOR // ↑ ↑ ↓ ↓ ← → ← → Q W',
        WIDTH / 2,
        392,
      );
      ctx.font = '900 20px ui-sans-serif, system-ui';
      ctx.fillStyle = world.ai.accent;
      ctx.fillText(`${world.ai.name} // ${world.ai.archetype}`, WIDTH / 2, 435);
      ctx.font = '700 14px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(226, 232, 240, .72)';
      ctx.fillText(world.ai.description, WIDTH / 2, 464);
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
      `ROUND   ${world.roundNumber}  SCORE ${world.playerRounds}–${world.enemyRounds}`,
      `MATCH   ${world.matchOver ? 'OVER' : 'LIVE'}`,
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
      `BULLETS ${world.projectiles.length}`,
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
  const [opponents, setOpponents] = useState<AIData[]>([]);
  const [activeOpponentIndex, setActiveOpponentIndex] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [matchView, setMatchView] = useState<MatchView>({
    playerRounds: 0,
    enemyRounds: 0,
    roundNumber: 1,
    matchOver: false,
  });
  const activeKeyLabels = gunMode ? gunKeyLabels : meleeKeyLabels;
  const activeOpponent = opponents[activeOpponentIndex];
  const startLabel =
    status === 'LOADING'
      ? '載入中…'
      : status === 'ERROR'
        ? '載入失敗'
        : status === 'FIGHTING' || status === 'PAUSED'
      ? '重新對戰'
      : status === 'KO'
        ? matchView.matchOver
          ? '再戰一場'
          : '下一回合'
        : '開始三戰兩勝';

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    const updateInstalledState = () => {
      setIsInstalled(standaloneQuery.matches || navigatorWithStandalone.standalone === true);
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
        gunSheet,
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
        loadImage('/fio-gun-actions-v3.png'),
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
        gunSheet,
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
        playerRounds: 0,
        enemyRounds: 0,
        roundNumber: 1,
        roundResolved: false,
        matchOver: false,
        hitStop: 0,
        shake: 0,
        debug: false,
        showBoxes: false,
        sound: true,
        gunMode: false,
        secretIndex: 0,
        audio: null,
        lastTime: performance.now(),
        frameHandle: 0,
        onStatus: setReactStatus,
        onGunMode: setGunMode,
        onAIChange: setActiveOpponentIndex,
        onMatchChange: setMatchView,
      };
      worldRef.current = world;
      setOpponents(ais);
      setActiveOpponentIndex(0);
      setMatchView({ playerRounds: 0, enemyRounds: 0, roundNumber: 1, matchOver: false });
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
      const gameKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'w'];
      if (gameKeys.includes(key)) event.preventDefault();
      if (!world.keys.has(key)) {
        world.justPressed.add(key);
        trackSecretInput(world, key);
      }
      world.keys.add(key);
      if (['1', '2', '3'].includes(key)) selectAI(world, Number(key) - 1);
      if (key === 'enter' && world.status === 'READY') resetWorld(world, true);
      if (key === 'r') resetWorld(world, world.status !== 'KO' || world.matchOver);
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
    resetWorld(world, world.status !== 'KO' || world.matchOver);
    canvasRef.current?.focus();
  }, [ensureAudio]);

  const selectOpponent = useCallback((index: number) => {
    const world = worldRef.current;
    if (!world) return;
    selectAI(world, index);
    canvasRef.current?.focus();
  }, []);

  const press = useCallback((key: string) => {
    const world = worldRef.current;
    if (!world) return;
    if (!world.keys.has(key)) {
      world.justPressed.add(key);
      trackSecretInput(world, key);
    }
    world.keys.add(key);
  }, []);

  const release = useCallback((key: string) => worldRef.current?.keys.delete(key), []);

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
            Prototype 06 · Guard Arsenal
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-50 sm:text-4xl">
            NEON KARATE <span className="text-cyan-300">{'// 城市道場'}</span>
          </h1>
          {gunMode && (
            <p className="mr-2 mt-2 inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
              Secret Gun Mode Active
            </p>
          )}
          <p className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[.04] px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
            Best of 3 · Fio {matchView.playerRounds}–{matchView.enemyRounds} Rival · Round {matchView.roundNumber}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={start}
            disabled={status === 'LOADING' || status === 'ERROR'}
            size="lg"
            className="border border-cyan-300/35 bg-cyan-300 text-slate-950 shadow-[0_0_28px_rgba(34,211,238,.22)] hover:bg-cyan-200"
          >
            {status === 'FIGHTING' || status === 'PAUSED' ? <RotateCcw /> : <Play />}
            {startLabel}
          </Button>
          {!isInstalled && (
            <Button onClick={installGame} variant="outline" size="lg">
              <Download /> 下載到手機
            </Button>
          )}
          <Button onClick={toggleDebug} variant="outline" size="lg" aria-pressed={debug}>
            <Bug /> Debug
          </Button>
          <Button onClick={toggleBoxes} variant="outline" size="lg" aria-pressed={showBoxes}>
            <Crosshair /> Hitbox
          </Button>
          <Button onClick={toggleSound} variant="outline" size="icon-lg" aria-label="切換音效">
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
        </div>
      </header>

      <div className="rival-select" aria-label="選擇 AI 對手">
        {opponents.map((opponent, index) => {
          const selected = index === activeOpponentIndex;
          return (
            <button
              key={opponent.id}
              type="button"
              onClick={() => selectOpponent(index)}
              disabled={status === 'FIGHTING' || status === 'PAUSED'}
              aria-pressed={selected}
              className={`rival-card ${selected ? 'selected' : ''}`}
              style={selected ? { borderColor: opponent.accent, boxShadow: `0 0 24px ${opponent.accent}22` } : undefined}
            >
              <span className="rival-index" style={{ color: opponent.accent }}>
                0{index + 1} {'//'} {opponent.archetype}
              </span>
              <strong>{opponent.name}</strong>
              <small>{opponent.description}</small>
              <span className="rival-tendency">
                拳 {Math.round(opponent.punchRate * 100)} · 踢 {Math.round(opponent.kickRate * 100)} · 反應 {opponent.reactionFrames}F
              </span>
            </button>
          );
        })}
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
                {status === 'LOADING' ? 'Loading Fight Data…' : 'Asset Load Failed'}
              </p>
              <p className="mt-3 text-sm text-slate-400">
                {status === 'LOADING' ? '正在載入場景、角色與招式資料' : '請重新整理頁面再試一次'}
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
        {status !== 'LOADING' && status !== 'ERROR' && (
          <div className="mobile-landscape-controls" aria-label="手機橫向虛擬鍵盤">
            <div className="mobile-dpad" aria-label="方向控制">
              <span />
              <button aria-label="上段，按住後再按攻擊" {...holdProps('arrowup')}>↑</button>
              <span />
              <button aria-label="後退" {...holdProps('arrowleft')}>←</button>
              <button aria-label="蹲下或下段，按住後再按攻擊" {...holdProps('arrowdown')}>↓</button>
              <button aria-label="前進" {...holdProps('arrowright')}>→</button>
            </div>
            {(status === 'READY' || status === 'KO' || status === 'PAUSED') && (
              <button className="mobile-start-button" onClick={start}>
                {startLabel}
              </button>
            )}
            {!isInstalled && (
              <button className="mobile-install-button" onClick={installGame} aria-label="安裝遊戲到手機">
                <Download />
                <span>安裝</span>
              </button>
            )}
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
          <button className="control-button" aria-label="上段修飾" {...holdProps('arrowup')}>↑</button>
          <span />
          <button className="control-button" aria-label="後退" {...holdProps('arrowleft')}>←</button>
          <button className="control-button" aria-label="蹲下" {...holdProps('arrowdown')}>↓</button>
          <button className="control-button" aria-label="前進" {...holdProps('arrowright')}>→</button>
          <span />
          <span className="self-center text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">移動</span>
          <span />
        </div>

        <div className="flex items-center justify-center px-5 text-center">
          <p className="max-w-48 font-mono text-[11px] leading-5 text-slate-400">
            {gunMode ? (
              <>↑ / ↓ 選段位<br />Q 射擊 · W 踢擊</>
            ) : (
              <>↑ + 攻擊：上段 · 直接攻擊：中段<br />↓ + 攻擊：下段<br />Q 拳 · W 腳</>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[.035] p-3">
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
        </div>
      </div>

      <footer className="game-footer flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
        <p>{gunMode ? 'SECRET：↑/↓ 選段位 · Q 射擊 · W 踢擊' : `三戰兩勝 · 1/2/3 選對手 · ${activeOpponent?.archetype ?? '載入對手中'}`}</p>
        <p>方向鍵移動／選段位 · Q 拳 · W 腳 · R 下一回合</p>
      </footer>
      {showInstallHelp && (
        <div className="install-help-backdrop">
          <dialog
            open
            className="install-help-card"
            aria-modal="true"
            aria-labelledby="install-help-title"
          >
            <button className="install-help-close" onClick={() => setShowInstallHelp(false)} aria-label="關閉安裝說明">
              <X />
            </button>
            <Smartphone className="install-help-icon" aria-hidden="true" />
            <h2 id="install-help-title">下載到手機遊玩</h2>
            <p><strong>iPhone／iPad：</strong>使用 Safari 開啟，按「分享」後選擇「加入主畫面」。</p>
            <p><strong>Android：</strong>使用 Chrome 開啟選單，選擇「安裝應用程式」或「加到主畫面」。</p>
            <p className="install-help-note">安裝完成後可直接從手機桌面啟動，橫置即可使用虛擬按鍵。</p>
          </dialog>
        </div>
      )}
    </section>
  );
}

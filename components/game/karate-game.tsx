'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Bug, Crosshair, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/button';

const WIDTH = 1280;
const HEIGHT = 720;
const GROUND_Y = 620;
const FPS = 60;

type AttackLevel = 'HIGH' | 'MID' | 'LOW';
type AttackType = 'PUNCH' | 'KICK' | 'GUN';
type AttackPhase = 'STARTUP' | 'ACTIVE' | 'RECOVERY' | null;
type GameStatus = 'LOADING' | 'READY' | 'FIGHTING' | 'KO' | 'PAUSED';
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
  fighterImage: HTMLImageElement;
  actionSheet: HTMLImageElement;
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
}

const levelIndex: Record<AttackLevel, number> = { HIGH: 0, MID: 1, LOW: 2 };
const secretSequence = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'q', 'w'];

function rectsOverlap(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

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
  yOffset = 0;
  verticalVelocity = 0;
  attack: AttackRuntime | null = null;
  stunFrames = 0;
  flash = 0;
  guardFlash = 0;
  isGuarding = false;

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
    this.yOffset = 0;
    this.verticalVelocity = 0;
    this.attack = null;
    this.stunFrames = 0;
    this.flash = 0;
    this.guardFlash = 0;
    this.isGuarding = false;
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

  beginAttack(data: AttackData) {
    if (this.busy || this.stamina < data.staminaCost || this.yOffset > 0) return false;
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

  jump() {
    if (this.busy || this.crouching || this.yOffset > 0) return;
    this.verticalVelocity = 520;
    this.state = 'JUMP';
  }

  update(dt: number) {
    const frames = dt * FPS;
    this.flash = Math.max(0, this.flash - dt);
    this.guardFlash = Math.max(0, this.guardFlash - dt);
    this.isGuarding = false;

    if (this.verticalVelocity !== 0 || this.yOffset > 0) {
      this.yOffset += this.verticalVelocity * dt;
      this.verticalVelocity -= 1320 * dt;
      if (this.yOffset <= 0) {
        this.yOffset = 0;
        this.verticalVelocity = 0;
        if (!this.busy) this.state = 'IDLE';
      }
    }

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

    if (this.yOffset === 0) {
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
    }

    this.stamina = Math.min(100, this.stamina + (this.crouching ? 15 : 22) * dt);
  }

  hurtboxes(): Record<AttackLevel, Rect> {
    const base = GROUND_Y - this.yOffset;
    if (this.crouching) {
      return {
        HIGH: { x: this.x - 27, y: base - 176, w: 54, h: 50 },
        MID: { x: this.x - 42, y: base - 132, w: 84, h: 72 },
        LOW: { x: this.x - 38, y: base - 70, w: 76, h: 70 },
      };
    }
    return {
      HIGH: { x: this.x - 29, y: base - 308, w: 58, h: 78 },
      MID: { x: this.x - 43, y: base - 230, w: 86, h: 122 },
      LOW: { x: this.x - 38, y: base - 108, w: 76, h: 108 },
    };
  }

  attackBox(): Rect | null {
    if (!this.attack || this.phase !== 'ACTIVE') return null;
    const { data } = this.attack;
    if (data.attackType === 'GUN') return null;
    const yMap = {
      HIGH: GROUND_Y - this.yOffset - 278,
      MID: GROUND_Y - this.yOffset - 194,
      LOW: GROUND_Y - this.yOffset - 105,
    };
    const heightMap = { HIGH: 54, MID: 64, LOW: 58 };
    const extension = data.range + (data.attackType === 'KICK' ? 26 : 10);
    return {
      x: this.direction === 1 ? this.x + 22 : this.x - 22 - extension,
      y: yMap[data.attackLevel],
      w: extension,
      h: heightMap[data.attackLevel],
    };
  }

  canAutoGuard(level: AttackLevel) {
    if (this.busy || this.yOffset > 0) return false;
    return this.crouching ? level !== 'HIGH' : level !== 'LOW';
  }

  receiveHit(data: AttackData, direction: Direction, counter: boolean, guarded: boolean) {
    if (guarded) {
      this.hp = Math.max(0, this.hp - Math.max(1, Math.round(data.damage * 0.18)));
      this.stamina = Math.max(0, this.stamina - data.staminaCost * 0.55);
      this.stunFrames = data.blockStunFrames;
      this.state = `GUARD_${data.attackLevel}`;
      this.guardFlash = 0.12;
      this.isGuarding = true;
      this.x += direction * data.knockback * 0.25;
      return;
    }

    const multiplier = counter ? 1.5 : 1;
    this.hp = Math.max(0, this.hp - Math.round(data.damage * multiplier));
    this.stunFrames = data.hitStunFrames + (counter ? 6 : 0);
    this.state = `HIT_${data.attackLevel}`;
    this.attack = null;
    this.crouching = false;
    this.flash = 0.12;
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
  world.banner = { text: 'SECRET MODE', subtext: 'Q / A / Z 已切換為三段射擊', color: '#22d3ee', life: 2.4 };
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

function resetWorld(world: World) {
  world.player.reset(350, 1);
  world.enemy.reset(930, -1);
  world.grapple = null;
  world.projectiles = [];
  world.impacts = [];
  world.banner = {
    text: world.gunMode ? 'SECRET ROUND' : 'ROUND 1',
    subtext: world.gunMode ? 'Q / A / Z = HIGH / MID / LOW SHOT' : world.ai.archetype,
    color: world.gunMode ? '#22d3ee' : '#ffe08a',
    life: 1.2,
  };
  world.aiDecisionTimer = 0.45;
  world.aiRetreatTimer = 0;
  world.hitStop = 0;
  world.shake = 0;
  world.keys.clear();
  world.justPressed.clear();
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
  world.onAIChange(nextIndex);
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
  const targetBox = defender.hurtboxes()[runtime.data.attackLevel];
  if (!rectsOverlap(attackBox, targetBox)) return;

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
  if (counter) {
    world.banner = { text: 'COUNTER', subtext: '破綻反擊 ×1.5', color: '#fb7185', life: 0.8 };
    playTone(world, 760, 0.09, 0.055);
  } else if (guarded) {
    world.banner = { text: 'BLOCK', color: '#7dd3fc', life: 0.26 };
    playTone(world, 260, 0.05, 0.025);
  } else {
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
    if (incoming.data.attackLevel === 'LOW' && enemy.yOffset === 0) {
      enemy.jump();
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
    } else if (playerAttack.attackLevel === 'LOW' && enemy.yOffset === 0) {
      enemy.jump();
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
  player.moveIntent = player.busy ? 0 : left === right ? 0 : left ? -1 : 1;
  player.crouching = !player.busy && player.yOffset === 0 && world.keys.has('arrowdown');

  if (world.justPressed.has('arrowup')) player.jump();
  for (const input of ['q', 'a', 'z', 'w', 's', 'x']) {
    if (!world.justPressed.has(input)) continue;
    const useGun = world.gunMode && ['q', 'a', 'z'].includes(input);
    const attack = useGun
      ? world.gunAttackByInput.get(input)
      : world.meleeAttackByInput.get(input);
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
    const yByLevel: Record<AttackLevel, number> = {
      HIGH: GROUND_Y - fighter.yOffset - 270,
      MID: GROUND_Y - fighter.yOffset - 120,
      LOW: GROUND_Y - fighter.yOffset - 54,
    };
    const speed = runtime.data.projectileSpeed ?? 1400;
    const startX = fighter.x + fighter.direction * 96;
    world.projectiles.push({
      owner: fighter.id,
      x: startX,
      previousX: startX,
      y: yByLevel[runtime.data.attackLevel],
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
    const target = defender.hurtboxes()[projectile.data.attackLevel];
    if (!rectsOverlap(collider, target)) continue;

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
    world.banner = guarded
      ? { text: 'SHOT BLOCK', color: '#7dd3fc', life: 0.35 }
      : { text: `${projectile.data.attackLevel} SHOT`, color: '#22d3ee', life: 0.45 };
    world.hitStop = guarded ? 0.035 : 0.075;
    world.shake = guarded ? 3 : 8;
    playTone(world, guarded ? 260 : 110, 0.07, 0.045);
  }
  world.projectiles = world.projectiles.filter((projectile) =>
    projectile.lifetime > 0 && projectile.x > -60 && projectile.x < WIDTH + 60,
  );
}

function checkKO(world: World) {
  if (world.player.hp > 0 && world.enemy.hp > 0) return;
  const playerWon = world.enemy.hp <= 0;
  const loser = playerWon ? world.enemy : world.player;
  loser.state = 'KNOCKDOWN';
  loser.stunFrames = 9999;
  world.banner = {
    text: playerWon ? 'K.O. // YOU WIN' : 'K.O. // DEFEAT',
    subtext: '按 R 或點擊重新開始',
    color: playerWon ? '#67e8f9' : '#fb7185',
    life: 999,
  };
  setStatus(world, 'KO');
  world.hitStop = 0.16;
  world.shake = 14;
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

  world.player.x = clamp(world.player.x, 104, WIDTH - 104);
  world.enemy.x = clamp(world.enemy.x, 104, WIDTH - 104);
  const separation = Math.abs(world.player.x - world.enemy.x);
  if (separation < 68) {
    const midpoint = (world.player.x + world.enemy.x) / 2;
    world.player.x = midpoint - 34 * world.player.direction;
    world.enemy.x = midpoint + 34 * world.player.direction;
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
  if (fighter.state === 'KNOCKDOWN' || fighter.state.startsWith('HIT_')) return 7;
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

function drawActionFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  size: number,
  xOffset = 0,
) {
  const sourceWidth = sheet.width / 4;
  const sourceHeight = sheet.height / 2;
  const column = frame % 4;
  const row = Math.floor(frame / 4);
  ctx.drawImage(
    sheet,
    column * sourceWidth,
    row * sourceHeight,
    sourceWidth,
    sourceHeight,
    -size / 2 + xOffset,
    -size,
    size,
    size,
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
    -height + 30,
    width,
    height,
  );
}

function drawFighter(ctx: CanvasRenderingContext2D, world: World, fighter: Fighter) {
  const baseY = GROUND_Y - fighter.yOffset;
  const isEnemy = fighter.id === 'enemy';
  const phase = fighter.phase;
  const attack = fighter.attack?.data;
  const frame = actionFrameFor(fighter);
  const gunFrame = gunFrameFor(fighter);
  const isHitPose = fighter.state === 'KNOCKDOWN' || fighter.state.startsWith('HIT_');
  const useGunPose = fighter.id === 'player' && world.gunMode && !isHitPose && (!attack || attack.attackType === 'GUN');
  const attackTotal = attack
    ? attack.startupFrames + attack.activeFrames + attack.recoveryFrames
    : 1;
  const attackProgress = fighter.attack ? clamp(fighter.attack.frame / attackTotal, 0, 1) : 0;
  const actionPulse = attack ? Math.sin(Math.PI * attackProgress) : 0;
  const activeThrust = attack && attack.attackType !== 'GUN'
    ? actionPulse * (attack.attackType === 'KICK' ? 42 : 28)
    : 0;
  const clock = world.lastTime / 1000;
  const moving = fighter.state === 'MOVE_FORWARD' || fighter.state === 'MOVE_BACKWARD';
  const bodyBob = fighter.yOffset > 0
    ? 0
    : moving
      ? Math.sin(clock * 15 + (isEnemy ? 1.7 : 0)) * 6
      : Math.sin(clock * 3.4 + (isEnemy ? 1.2 : 0)) * 2;
  const crouchScale = fighter.crouching ? 0.78 : 1;
  const hitRotation = fighter.state.startsWith('HIT_') ? fighter.direction * 0.12 : 0;
  const knockRotation = fighter.state === 'KNOCKDOWN' ? fighter.direction * 1.18 : hitRotation;
  const attackRotation = attack && attack.attackType !== 'GUN'
    ? fighter.direction * actionPulse * (attack.attackType === 'KICK' ? -0.055 : -0.025)
    : 0;
  const poseSize = fighter.state === 'KNOCKDOWN' ? 372 : 382;

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = isEnemy ? '#fb7185' : '#67e8f9';
  ctx.beginPath();
  ctx.ellipse(fighter.x, GROUND_Y + 5, 72, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(fighter.x + fighter.direction * activeThrust, baseY + bodyBob);
  ctx.rotate(knockRotation + attackRotation);
  ctx.scale(fighter.direction * (1 + actionPulse * 0.035), crouchScale * (1 - actionPulse * 0.025));
  if (isEnemy) ctx.filter = 'sepia(.8) hue-rotate(292deg) saturate(1.8) brightness(.68) contrast(1.08)';
  if (fighter.flash > 0) ctx.filter = 'brightness(2.5) saturate(.2)';
  if (fighter.guardFlash > 0) ctx.filter = 'brightness(1.45) saturate(1.8)';
  if (!useGunPose && frame !== 0 && (phase === 'ACTIVE' || phase === 'RECOVERY')) {
    for (let trail = 3; trail >= 1; trail -= 1) {
      ctx.save();
      ctx.globalAlpha = 0.055 * trail;
      drawActionFrame(ctx, world.actionSheet, frame, poseSize, -trail * 18);
      ctx.restore();
    }
  }
  if (useGunPose) drawGunFrame(ctx, world.gunSheet, gunFrame, poseSize);
  else drawActionFrame(ctx, world.actionSheet, frame, poseSize);
  ctx.restore();

  if (attack && phase === 'ACTIVE') {
    const box = fighter.attackBox();
    if (box) {
      ctx.save();
      ctx.strokeStyle = attack.attackType === 'KICK' ? '#fb7185' : '#fbbf24';
      ctx.lineWidth = attack.attackType === 'KICK' ? 9 : 6;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const startX = fighter.x + fighter.direction * 30;
      const endX = fighter.direction === 1 ? box.x + box.w : box.x;
      const y = box.y + box.h / 2;
      ctx.moveTo(startX, y + 14);
      ctx.quadraticCurveTo((startX + endX) / 2, y - 22, endX, y);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (world.showBoxes) {
    const boxes = fighter.hurtboxes();
    const colors = { HIGH: '#f472b6', MID: '#fbbf24', LOW: '#34d399' };
    for (const level of ['HIGH', 'MID', 'LOW'] as AttackLevel[]) {
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

  drawFighter(ctx, world, world.player);
  drawFighter(ctx, world, world.enemy);

  for (const impact of world.impacts) {
    const progress = impact.life / 0.55;
    ctx.save();
    ctx.translate(impact.x, impact.y);
    ctx.strokeStyle = impact.color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = clamp(progress, 0, 1);
    for (let i = 0; i < 9; i += 1) {
      const angle = (Math.PI * 2 * i) / 9;
      const radius = (1 - progress) * 48 + 9;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 7, Math.sin(angle) * 7);
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
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
  ctx.fillText(world.gunMode ? 'SECRET GUN MODE // ACTIVE' : 'CITY DOJO // PROTOTYPE 03', WIDTH / 2, 68);

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
          : '按下開始，進入城市道場',
      WIDTH / 2,
      330,
    );
    if (world.status === 'READY') {
      ctx.font = '700 14px ui-monospace, monospace';
      ctx.fillStyle = world.gunMode ? '#a5f3fc' : 'rgba(226, 232, 240, .62)';
      ctx.fillText(
        world.gunMode
          ? 'Q / A / Z：上・中・下段射擊'
          : 'CITY RUMOR // ↑ ↑ ↓ ↓ ← → ← → Q W',
        WIDTH / 2,
        365,
      );
      ctx.font = '900 20px ui-sans-serif, system-ui';
      ctx.fillStyle = world.ai.accent;
      ctx.fillText(`${world.ai.name} // ${world.ai.archetype}`, WIDTH / 2, 414);
      ctx.font = '700 14px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(226, 232, 240, .72)';
      ctx.fillText(world.ai.description, WIDTH / 2, 443);
    }
  }

  if (world.debug) {
    const distance = Math.round(Math.abs(world.player.x - world.enemy.x));
    roundedRect(ctx, 20, 132, 322, 304, 14);
    ctx.fillStyle = 'rgba(2, 6, 23, .84)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(103, 232, 249, .4)';
    ctx.stroke();
    const lines = [
      `AI      ${world.ai.id}`,
      `AI ZONE ${world.ai.preferredMinRange}–${world.ai.preferredMaxRange}px`,
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
  { input: 'Q', label: '上拳', tone: 'punch' },
  { input: 'A', label: '中拳', tone: 'punch' },
  { input: 'Z', label: '下拳', tone: 'punch' },
  { input: 'W', label: '上踢', tone: 'kick' },
  { input: 'S', label: '中踢', tone: 'kick' },
  { input: 'X', label: '下踢', tone: 'kick' },
] as const;

const gunKeyLabels = [
  { input: 'Q', label: '上射', tone: 'shot' },
  { input: 'A', label: '中射', tone: 'shot' },
  { input: 'Z', label: '下射', tone: 'shot' },
  { input: 'W', label: '上踢', tone: 'kick' },
  { input: 'S', label: '中踢', tone: 'kick' },
  { input: 'X', label: '下踢', tone: 'kick' },
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
  const activeKeyLabels = gunMode ? gunKeyLabels : meleeKeyLabels;
  const activeOpponent = opponents[activeOpponentIndex];

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const renderContext = context;

    async function boot() {
      const [attacksResponse, aiResponse, stage, fighterImage, actionSheet, gunSheet] = await Promise.all([
        fetch('/game-data/attacks.json'),
        fetch('/game-data/ai.json'),
        loadImage('/urban-stage.png'),
        loadImage('/fio-fighter.png'),
        loadImage('/fio-actions-v2.png'),
        loadImage('/fio-gun-actions-v1.png'),
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
        fighterImage,
        actionSheet,
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
      };
      worldRef.current = world;
      setOpponents(ais);
      setActiveOpponentIndex(0);
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

    boot().catch(() => setReactStatus('READY'));
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
      const gameKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'a', 'z', 'w', 's', 'x'];
      if (gameKeys.includes(key)) event.preventDefault();
      if (!world.keys.has(key)) {
        world.justPressed.add(key);
        trackSecretInput(world, key);
      }
      world.keys.add(key);
      if (['1', '2', '3'].includes(key)) selectAI(world, Number(key) - 1);
      if (key === 'enter' && world.status === 'READY') resetWorld(world);
      if (key === 'r') resetWorld(world);
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
    const up = (event: KeyboardEvent) => worldRef.current?.keys.delete(event.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
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

  const holdProps = (key: string) => ({
    onPointerDown: (event: ReactPointerEvent) => {
      event.preventDefault();
      press(key);
    },
    onPointerUp: () => release(key),
    onPointerCancel: () => release(key),
    onPointerLeave: () => release(key),
  });

  return (
    <section className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-3 py-4 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 border-b border-cyan-300/15 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300/75">
            Prototype 03 · Rival Personalities
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-50 sm:text-4xl">
            NEON KARATE <span className="text-cyan-300">// 城市道場</span>
          </h1>
          {gunMode && (
            <p className="mt-2 inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
              Secret Gun Mode Active
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={start}
            size="lg"
            className="border border-cyan-300/35 bg-cyan-300 text-slate-950 shadow-[0_0_28px_rgba(34,211,238,.22)] hover:bg-cyan-200"
          >
            {status === 'FIGHTING' ? <RotateCcw /> : <Play />}
            {status === 'FIGHTING' ? '重新開局' : '開始對戰'}
          </Button>
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
                0{index + 1} // {opponent.archetype}
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

      <div className="relative overflow-hidden rounded-[18px] border border-cyan-200/20 bg-slate-950 shadow-[0_28px_100px_rgba(0,0,0,.45)]">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          tabIndex={0}
          aria-label="霓虹空手道遊戲畫面"
          className="block aspect-video h-auto w-full outline-none ring-cyan-300/50 focus-visible:ring-2"
        />
        {status === 'PAUSED' && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/65 backdrop-blur-sm">
            <div className="text-center">
              <p className="text-5xl font-black text-cyan-200">PAUSED</p>
              <p className="mt-2 font-mono text-sm text-slate-300">按 P 繼續</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[.035] p-3">
          <span />
          <button className="control-button" aria-label="跳躍" {...holdProps('arrowup')}>↑</button>
          <span />
          <span />
          <button className="control-button" aria-label="後退" {...holdProps('arrowleft')}>←</button>
          <button className="control-button" aria-label="蹲下" {...holdProps('arrowdown')}>↓</button>
          <button className="control-button" aria-label="前進" {...holdProps('arrowright')}>→</button>
          <span className="self-center text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">移動</span>
        </div>

        <div className="hidden items-center px-5 text-center lg:flex">
          <p className="max-w-48 font-mono text-[11px] leading-5 text-slate-400">
            {gunMode ? (
              <>射擊覆蓋遠距 · 踢擊仍保留<br />高射可蹲避 · 低射可跳避<br />射擊後有明確破綻</>
            ) : (
              <>拳快而短 · 踢慢而遠<br />站立防上中 · 蹲下防中下<br />同時出拳可進入擒拿</>
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
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
        <p>{gunMode ? 'SECRET：Q/A/Z 射擊 · W/S/X 踢' : `1/2/3 選對手 · ${activeOpponent?.archetype ?? '載入對手中'}`}</p>
        <p>{gunMode ? 'Projectile ON · D Debug · H Collider' : '方向鍵移動 · Q/A/Z 拳 · W/S/X 踢 · D Debug · H Hitbox'}</p>
      </footer>
    </section>
  );
}

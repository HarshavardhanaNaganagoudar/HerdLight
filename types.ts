export type Vector2 = { x: number; y: number };

export enum SheepType {
  WHITE = 'WHITE',
  BLACK = 'BLACK',
}

export interface DogPalette {
  name: string;
  primary: string; // The dark color (Black, Red, etc)
  secondary: string; // The white/light color
}

export interface Entity {
  id: string;
  pos: Vector2;
  vel: Vector2;
  radius: number;
}

export interface Sheep extends Entity {
  type: SheepType;
  state: 'GRAZING' | 'FLEEING' | 'SECURE';
  panicLevel: number; // 0 to 1
  wobbleOffset: number; // For hand-drawn animation effect
}

export interface Dog extends Entity {
  speed: number;
  facingDir: Vector2; // Direction the dog is looking
}

export interface Obstacle extends Entity {
  type: 'TREE' | 'ROCK' | 'BUSH';
  wobbleOffset: number;
}

export interface Pasture {
  id: string;
  type: SheepType;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface GameState {
  sheep: Sheep[];
  dog: Dog;
  obstacles: Obstacle[];
  level: number;
  score: number;
  timeElapsed: number;
  isPlaying: boolean;
  isLevelComplete: boolean;
  dogPalette: DogPalette;
}

export interface LevelConfig {
  sheepCount: number;
  blackSheepRatio: number; // 0 to 1
}
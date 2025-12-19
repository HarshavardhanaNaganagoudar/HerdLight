import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  COLORS, 
  PASTURE_SETTINGS, 
  DOG_RADIUS, 
  DOG_SPEED, 
  SHEEP_RADIUS,
  PERCEPTION_RADIUS,
  SHEEP_MAX_SPEED,
  SHEEP_WANDER_SPEED,
  SEPARATION_RADIUS,
  FLOCKING_RADIUS,
  ALIGNMENT_WEIGHT,
  COHESION_WEIGHT,
  DOG_PALETTES,
  MAX_LEVELS
} from '../constants';
import { GameState, Sheep, SheepType, Vector2, Obstacle, DogPalette, Pasture } from '../types';
import { Loader2, Play, RefreshCw, Trophy, Volume2, VolumeX, CheckCircle2, ArrowRight } from 'lucide-react';
import { getLevelFlavorText } from '../services/aiService';

// --- Vector Math Helpers ---
const vecAdd = (v1: Vector2, v2: Vector2) => ({ x: v1.x + v2.x, y: v1.y + v2.y });
const vecSub = (v1: Vector2, v2: Vector2) => ({ x: v1.x - v2.x, y: v1.y - v2.y });
const vecMult = (v: Vector2, s: number) => ({ x: v.x * s, y: v.y * s });
const vecMag = (v: Vector2) => Math.sqrt(v.x * v.x + v.y * v.y);
const vecNorm = (v: Vector2) => {
  const m = vecMag(v);
  return m === 0 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
};
const vecLimit = (v: Vector2, max: number) => {
  const m = vecMag(v);
  return m > max ? vecMult(vecNorm(v), max) : v;
};
const dist = (v1: Vector2, v2: Vector2) => Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2));

// --- Helper to Generate Pastures based on Screen Size ---
const getPastures = (w: number, h: number): (Pasture & { color: string, borderColor: string, label: string })[] => {
    const size = Math.min(w, h) * 0.25; // 25% of smallest dimension
    const clampedSize = Math.max(160, Math.min(350, size)); // Min 160px, Max 350px
    const margin = 40;

    return [
        {
            ...PASTURE_SETTINGS[0],
            id: 'p_white',
            type: SheepType.WHITE,
            bounds: { x: margin, y: margin, w: clampedSize, h: clampedSize },
        },
        {
            ...PASTURE_SETTINGS[1],
            id: 'p_black',
            type: SheepType.BLACK,
            bounds: { x: w - clampedSize - margin, y: margin, w: clampedSize, h: clampedSize },
        }
    ];
};

interface GrassBlade {
  x: number;
  y: number;
  angle: number;
  size: number;
}

// --- Procedural Audio Engine (Zen Mode) ---
class ZenAudio {
  ctx: AudioContext | null = null;
  windGain: GainNode | null = null;
  droneGain: GainNode | null = null;
  isMuted: boolean = false;

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // 1. Wind (Pink Noise -> Lowpass Filter)
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5; 
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.03;

    noise.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.ctx.destination);
    noise.start();

    // 2. Drone (Sine Oscillators)
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 110; // A2
    
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 164.81; // E3

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0.02;

    osc1.connect(this.droneGain);
    osc2.connect(this.droneGain);
    this.droneGain.connect(this.ctx.destination);
    
    osc1.start();
    osc2.start();
    
    // LFO for subtle movement
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.1;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    lfo.start();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.ctx) {
      if (this.isMuted) this.ctx.suspend();
      else this.ctx.resume();
    }
    return this.isMuted;
  }
  
  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && !this.isMuted) {
      this.ctx.resume();
    }
  }
}

const audio = new ZenAudio();

const HerdingGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  
  // Responsive Dimensions
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const dimensions = useRef({ w: window.innerWidth, h: window.innerHeight });
  const pasturesRef = useRef(getPastures(window.innerWidth, window.innerHeight));
  const grassRef = useRef<GrassBlade[]>([]);

  // Game States
  const [level, setLevel] = useState(1);
  const [gameState, setGameState] = useState<'INTRO' | 'SELECT_DOG' | 'START' | 'PLAYING' | 'WON' | 'COMPLETED'>('INTRO');
  const [flavor, setFlavor] = useState({ title: "The Pasture", description: "Guide them home." });
  const [loadingLevel, setLoadingLevel] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedPalette, setSelectedPalette] = useState<DogPalette>(DOG_PALETTES.BLACK);

  // Mutable game state
  const state = useRef<GameState>({
    sheep: [],
    dog: { 
      id: 'dog', 
      pos: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 
      vel: { x: 0, y: 0 }, 
      radius: DOG_RADIUS, 
      speed: DOG_SPEED,
      facingDir: { x: 0, y: 1 } 
    },
    obstacles: [],
    level: 1,
    score: 0,
    timeElapsed: 0,
    isPlaying: false,
    isLevelComplete: false,
    dogPalette: DOG_PALETTES.BLACK
  });

  const keys = useRef<{ [key: string]: boolean }>({});

  // Generate Grass
  const generateGrass = (w: number, h: number) => {
    const grass: GrassBlade[] = [];
    // Density based on area, but capped for performance
    const count = Math.min(150, Math.floor((w * h) / 10000));
    
    for (let i = 0; i < count; i++) {
      grass.push({
        x: Math.random() * w,
        y: Math.random() * h,
        angle: (Math.random() * Math.PI) / 4 - Math.PI / 8, // slight random tilt
        size: 3 + Math.random() * 2
      });
    }
    grassRef.current = grass;
  };

  // Resize Handler
  useEffect(() => {
      const handleResize = () => {
          const w = window.innerWidth;
          const h = window.innerHeight;
          setWindowSize({ w, h });
          dimensions.current = { w, h };
          pasturesRef.current = getPastures(w, h);
          generateGrass(w, h);
      };
      
      // Init grass
      generateGrass(window.innerWidth, window.innerHeight);

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleMute = () => {
    const muted = audio.toggleMute();
    setIsMuted(muted);
  };

  const isPointInRect = (p: Vector2, rect: {x: number, y: number, w: number, h: number}) => {
    return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  };

  // Initialize Level
  const initLevel = useCallback(async (lvl: number) => {
    setLoadingLevel(true);
    const { w, h } = dimensions.current;
    
    const newSheep: Sheep[] = [];
    const newObstacles: Obstacle[] = [];
    const sheepCount = 4 + (lvl * 2); 
    
    // Generate Obstacles (Progression)
    const obstacleCount = Math.floor(lvl * 1.5) + Math.floor(w/800); 
    for(let i=0; i<obstacleCount; i++) {
        const type = Math.random() > 0.3 ? 'TREE' : 'ROCK';
        const radius = type === 'TREE' ? 25 : 15;
        let valid = false;
        let pos = { x: 0, y: 0 };
        let attempts = 0;
        
        while(!valid && attempts < 20) {
            pos = {
                x: Math.random() * (w - 100) + 50,
                y: Math.random() * (h - 100) + 50
            };
            const inPasture = pasturesRef.current.some(p => isPointInRect(pos, p.bounds));
            const dCenter = dist(pos, {x: w/2, y: h/2});
            
            if (!inPasture && dCenter > 150) valid = true;
            attempts++;
        }

        if (valid) {
            newObstacles.push({
                id: `obs_${i}`,
                pos,
                vel: {x:0, y:0},
                radius,
                type: type as 'TREE' | 'ROCK',
                wobbleOffset: Math.random() * 10
            });
        }
    }

    // Generate Sheep
    for (let i = 0; i < sheepCount; i++) {
      const type = Math.random() > 0.5 ? SheepType.WHITE : SheepType.BLACK;
      let pos = { x: 0, y: 0 };
      let valid = false;
      while(!valid) {
          pos = {
             x: Math.random() * (w - 100) + 50,
             y: Math.random() * (h / 2) + h / 3
          };
          const hitObs = newObstacles.some(o => dist(pos, o.pos) < o.radius + SHEEP_RADIUS + 5);
          // Keep away from pastures initially
          const inPasture = pasturesRef.current.some(p => isPointInRect(pos, p.bounds));

          if(!hitObs && !inPasture) valid = true;
      }

      newSheep.push({
        id: `s_${i}`,
        pos,
        vel: { x: (Math.random() - 0.5), y: (Math.random() - 0.5) },
        radius: SHEEP_RADIUS,
        type,
        state: 'GRAZING',
        panicLevel: 0,
        wobbleOffset: Math.random() * 100
      });
    }

    state.current = {
      ...state.current,
      sheep: newSheep,
      obstacles: newObstacles,
      dog: { 
        ...state.current.dog, 
        pos: { x: w / 2, y: h / 2 },
        facingDir: { x: 0, y: 1 } // Reset facing
      },
      level: lvl,
      isPlaying: false,
      isLevelComplete: false,
      dogPalette: state.current.dogPalette
    };

    const text = await getLevelFlavorText(lvl);
    setFlavor(text);
    setLoadingLevel(false);
    setGameState('START');
  }, []);

  const handleIntroComplete = () => {
    setGameState('SELECT_DOG');
  };

  const handleDogSelect = (palette: DogPalette) => {
    setSelectedPalette(palette);
    state.current.dogPalette = palette;
    audio.init(); 
    initLevel(1); 
  };

  const handleStart = () => {
    audio.resume();
    state.current.isPlaying = true;
    setGameState('PLAYING');
  };

  const handleNextLevel = () => {
    const nextLevel = level + 1;
    if (nextLevel > MAX_LEVELS) {
      setGameState('COMPLETED');
    } else {
      setLevel(nextLevel);
      initLevel(nextLevel);
    }
  };
  
  const handleRestart = () => {
      setLevel(1);
      setGameState('INTRO');
  };

  // --- Physics Engine ---
  const updatePhysics = () => {
    if (!state.current.isPlaying) return;

    const { dog, sheep, obstacles } = state.current;
    const { w, h } = dimensions.current;
    const pastures = pasturesRef.current;

    // 1. Dog Movement
    let inputVec = { x: 0, y: 0 };
    if (keys.current['ArrowUp'] || keys.current['w']) inputVec.y -= 1;
    if (keys.current['ArrowDown'] || keys.current['s']) inputVec.y += 1;
    if (keys.current['ArrowLeft'] || keys.current['a']) inputVec.x -= 1;
    if (keys.current['ArrowRight'] || keys.current['d']) inputVec.x += 1;

    if (inputVec.x !== 0 || inputVec.y !== 0) {
      inputVec = vecMult(vecNorm(inputVec), dog.speed);
    }
    
    dog.vel = vecAdd(vecMult(dog.vel, 0.8), vecMult(inputVec, 0.2));
    dog.pos = vecAdd(dog.pos, dog.vel);

    // Dog Looking Logic (Head Tracking)
    const dogSpeed = vecMag(dog.vel);
    let targetFacing = { x: 0, y: 0 };

    if (dogSpeed > 0.5) {
        // Look where moving
        targetFacing = vecNorm(dog.vel);
    } else {
        // Idle: Look at Flock Center of Mass
        let flockCenter = { x: 0, y: 0 };
        let count = 0;
        sheep.forEach(s => {
            if (s.state !== 'SECURE') {
                flockCenter = vecAdd(flockCenter, s.pos);
                count++;
            }
        });
        
        if (count > 0) {
            flockCenter = vecMult(flockCenter, 1/count);
            targetFacing = vecNorm(vecSub(flockCenter, dog.pos));
        } else {
            targetFacing = dog.facingDir; // No sheep? Keep looking same way
        }
    }

    // Smooth rotation (Lerp)
    if (Math.abs(targetFacing.x) > 0.01 || Math.abs(targetFacing.y) > 0.01) {
        dog.facingDir.x += (targetFacing.x - dog.facingDir.x) * 0.1;
        dog.facingDir.y += (targetFacing.y - dog.facingDir.y) * 0.1;
        dog.facingDir = vecNorm(dog.facingDir);
    }

    // Dog Obstacle Collision
    obstacles.forEach(obs => {
        const d = dist(dog.pos, obs.pos);
        const minDist = dog.radius + obs.radius;
        if (d < minDist) {
            const pushDir = vecNorm(vecSub(dog.pos, obs.pos));
            const push = vecMult(pushDir, minDist - d);
            dog.pos = vecAdd(dog.pos, push);
        }
    });

    dog.pos.x = Math.max(dog.radius, Math.min(w - dog.radius, dog.pos.x));
    dog.pos.y = Math.max(dog.radius, Math.min(h - dog.radius, dog.pos.y));

    const isDogFast = dogSpeed > DOG_SPEED * 0.8;

    // 2. Sheep Logic
    let allCorrect = true;

    sheep.forEach(s => {
      // Check if secure in pasture
      const correctPasture = pastures.find(p => p.type === s.type);
      let inCorrectPasture = false;
      if (correctPasture) {
         const p = correctPasture.bounds;
         // Hysteresis
         const margin = s.state === 'SECURE' ? 5 : 15;

         if (s.pos.x > p.x + margin && s.pos.x < p.x + p.w - margin && 
             s.pos.y > p.y + margin && s.pos.y < p.y + p.h - margin) {
             inCorrectPasture = true;
         }
      }

      if (inCorrectPasture) {
          s.state = 'SECURE';
          s.panicLevel = Math.max(0, s.panicLevel - 0.05); 
      } else {
          allCorrect = false;
          // If it was SECURE but drifted out, force state reset so it can move back
          if (s.state === 'SECURE') {
              s.state = 'GRAZING';
          }
      }

      if (s.state === 'SECURE') {
          s.vel = vecMult(s.vel, 0.85);
          let settleSep = {x: 0, y: 0};
          sheep.forEach(other => {
              if (s !== other && other.state === 'SECURE') {
                  const d = dist(s.pos, other.pos);
                  if (d < SEPARATION_RADIUS) {
                      settleSep = vecAdd(settleSep, vecMult(vecNorm(vecSub(s.pos, other.pos)), 0.5));
                  }
              }
          });
          s.vel = vecAdd(s.vel, settleSep);
          s.pos = vecAdd(s.pos, s.vel);
          return; 
      }

      // Forces
      let force = { x: 0, y: 0 };
      let separation = { x: 0, y: 0 };
      let alignment = { x: 0, y: 0 };
      let cohesion = { x: 0, y: 0 };
      let flockCount = 0;

      sheep.forEach(other => {
        if (s.id !== other.id && other.state !== 'SECURE') {
          const d = dist(s.pos, other.pos);
          if (d < SEPARATION_RADIUS) {
            const diff = vecNorm(vecSub(s.pos, other.pos));
            separation = vecAdd(separation, vecMult(diff, 1.0 / d)); 
          }
          if (d < FLOCKING_RADIUS) {
            alignment = vecAdd(alignment, other.vel);
            cohesion = vecAdd(cohesion, other.pos);
            flockCount++;
          }
        }
      });

      if (flockCount > 0) {
          alignment = vecMult(vecNorm(alignment), ALIGNMENT_WEIGHT);
          cohesion = vecMult(cohesion, 1.0 / flockCount);
          cohesion = vecSub(cohesion, s.pos);
          cohesion = vecMult(vecNorm(cohesion), COHESION_WEIGHT);
      }

      if (vecMag(separation) > 0) {
          separation = vecMult(vecNorm(separation), 2.0);
      }

      let fear = { x: 0, y: 0 };
      const dDog = dist(s.pos, dog.pos);
      let perception = PERCEPTION_RADIUS;
      let panicMult = 1.0;
      
      if (isDogFast) {
          perception *= 1.2; 
          panicMult = 1.5;
          if (dDog < perception) s.panicLevel = Math.min(1, s.panicLevel + 0.1);
      } else {
          s.panicLevel = Math.max(0, s.panicLevel - 0.02);
      }

      if (dDog < perception) {
        const fleeDir = vecNorm(vecSub(s.pos, dog.pos));
        const panicNoise = s.panicLevel > 0.5 ? { x: (Math.random()-0.5), y: (Math.random()-0.5) } : {x:0, y:0};
        const finalDir = vecNorm(vecAdd(fleeDir, vecMult(panicNoise, 0.5)));
        fear = vecMult(finalDir, 2.5 * panicMult);
        s.state = 'FLEEING';
      } else {
        s.state = 'GRAZING';
      }

      let avoidObs = { x: 0, y: 0 };
      obstacles.forEach(obs => {
          const d = dist(s.pos, obs.pos);
          const safeDist = obs.radius + s.radius + 15;
          if (d < safeDist) {
              const push = vecNorm(vecSub(s.pos, obs.pos));
              avoidObs = vecAdd(avoidObs, vecMult(push, 3.0));
          }
      });

      let wall = { x: 0, y: 0 };
      const margin = 35;
      if (s.pos.x < margin) wall.x += 1;
      if (s.pos.x > w - margin) wall.x -= 1;
      if (s.pos.y < margin) wall.y += 1;
      if (s.pos.y > h - margin) wall.y -= 1;
      if (wall.x !== 0 || wall.y !== 0) wall = vecMult(vecNorm(wall), 4.0);

      force = vecAdd(force, vecMult(separation, 3.5));
      force = vecAdd(force, alignment);
      force = vecAdd(force, cohesion);
      force = vecAdd(force, fear);
      force = vecAdd(force, avoidObs);
      force = vecAdd(force, wall);

      if (s.state === 'GRAZING') {
         const wander = { 
           x: (Math.random() - 0.5) * 0.4, 
           y: (Math.random() - 0.5) * 0.4 
         };
         force = vecAdd(force, wander);
      }

      s.vel = vecAdd(s.vel, vecMult(force, 0.15));
      const maxSpeed = s.state === 'FLEEING' ? SHEEP_MAX_SPEED * (1 + s.panicLevel * 0.5) : SHEEP_WANDER_SPEED;
      s.vel = vecLimit(s.vel, maxSpeed);
      s.pos = vecAdd(s.pos, s.vel);

      s.pos.x = Math.max(s.radius, Math.min(w - s.radius, s.pos.x));
      s.pos.y = Math.max(s.radius, Math.min(h - s.radius, s.pos.y));
    });

    if (allCorrect && !state.current.isLevelComplete) {
      state.current.isLevelComplete = true;
      state.current.isPlaying = false;
      setGameState('WON');
    }
  };

  // --- Rendering Helpers ---
  const drawWobblyCircle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, offset: number) => {
    ctx.beginPath();
    const segments = 12;
    const step = (Math.PI * 2) / segments;
    for (let i = 0; i <= segments; i++) {
        const theta = i * step;
        const rNoise = r + Math.sin(theta * 5 + offset) * 1.5;
        const px = x + Math.cos(theta) * rNoise;
        const py = y + Math.sin(theta) * rNoise;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const drawShadow = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.5, r, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.shadow;
      ctx.fill();
  };

  // --- Rendering ---
  const draw = (ctx: CanvasRenderingContext2D, time: number) => {
    const { w, h } = dimensions.current;
    
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, w, h);
    
    // Draw Grass with Physics (Bending)
    const { dog, sheep, obstacles, dogPalette } = state.current;
    
    ctx.fillStyle = COLORS.grassDetails;
    grassRef.current.forEach(g => {
        let offsetX = 0;
        let offsetY = 0;

        // Bending logic: Check distance to Dog
        const dDog = Math.sqrt(Math.pow(dog.pos.x - g.x, 2) + Math.pow(dog.pos.y - g.y, 2));
        if (dDog < dog.radius + 20) {
            const angle = Math.atan2(g.y - dog.pos.y, g.x - dog.pos.x);
            const force = (dog.radius + 20 - dDog) / 10;
            offsetX += Math.cos(angle) * force * 2;
            offsetY += Math.sin(angle) * force * 2;
        }

        // Bending logic: Check distance to Sheep (Optimization: check minimal dist)
        // We iterate all sheep, but since grass count is low, it's okay for minimal feel.
        for (const s of sheep) {
            const dSheep = Math.sqrt(Math.pow(s.pos.x - g.x, 2) + Math.pow(s.pos.y - g.y, 2));
            if (dSheep < s.radius + 15) {
                const angle = Math.atan2(g.y - s.pos.y, g.x - s.pos.x);
                const force = (s.radius + 15 - dSheep) / 8;
                offsetX += Math.cos(angle) * force * 2;
                offsetY += Math.sin(angle) * force * 2;
                // Break early if we found a sheep close enough to save perf? 
                // No, additive bending looks better if multiple are close.
            }
        }

        ctx.beginPath();
        const gx = g.x + offsetX;
        const gy = g.y + offsetY;
        ctx.arc(gx, gy, g.size, 0, Math.PI*2);
        ctx.fill();
    });

    pasturesRef.current.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h, 12);
      ctx.fill();
      
      ctx.strokeStyle = COLORS.fence;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([15, 10]);
      ctx.beginPath();
      ctx.roundRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h, 12);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = COLORS.fence;
      ctx.font = '600 16px Outfit';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, p.bounds.x + p.bounds.w/2, p.bounds.y - 12);
    });

    const renderList = [
        ...sheep.map(s => ({ type: 'sheep', obj: s, y: s.pos.y })),
        ...obstacles.map(o => ({ type: 'obstacle', obj: o, y: o.pos.y })),
        { type: 'dog', obj: dog, y: dog.pos.y }
    ].sort((a, b) => a.y - b.y);

    renderList.forEach(item => {
        if (item.type === 'obstacle') {
            const obs = item.obj as Obstacle;
            drawShadow(ctx, obs.pos.x, obs.pos.y, obs.radius * 1.2);
            if (obs.type === 'ROCK') {
                drawWobblyCircle(ctx, obs.pos.x, obs.pos.y, obs.radius, COLORS.rock, obs.wobbleOffset);
                ctx.fillStyle = COLORS.rockShadow;
                ctx.beginPath();
                ctx.arc(obs.pos.x - 5, obs.pos.y - 5, obs.radius * 0.3, 0, Math.PI*2);
                ctx.fill();
            } else {
                ctx.fillStyle = COLORS.treeTrunk;
                ctx.beginPath();
                ctx.arc(obs.pos.x, obs.pos.y, obs.radius * 0.3, 0, Math.PI*2);
                ctx.fill();
                drawWobblyCircle(ctx, obs.pos.x, obs.pos.y - 15, obs.radius, COLORS.treeLeaves, obs.wobbleOffset + time * 0.001);
            }
        }
        else if (item.type === 'sheep') {
            const s = item.obj as Sheep;
            drawShadow(ctx, s.pos.x, s.pos.y, s.radius);
            
            const color = s.type === SheepType.WHITE ? COLORS.sheepWhite : COLORS.sheepBlack;
            const wobble = s.state === 'FLEEING' ? time * 0.02 : s.wobbleOffset;
            
            drawWobblyCircle(ctx, s.pos.x, s.pos.y, s.radius, color, wobble);

            const headOffset = vecMult(vecNorm(s.vel), s.radius * 0.5);
            const headX = s.pos.x + (vecMag(s.vel) > 0.1 ? headOffset.x : 0);
            const headY = s.pos.y + (vecMag(s.vel) > 0.1 ? headOffset.y : 0);
            
            const headColor = s.type === SheepType.WHITE ? COLORS.sheepWhiteShadow : COLORS.sheepBlackShadow;
            ctx.fillStyle = headColor;
            ctx.beginPath();
            ctx.arc(headX, headY, s.radius * 0.6, 0, Math.PI*2);
            ctx.fill();

            if (s.state === 'FLEEING' && s.panicLevel > 0.5) {
                ctx.fillStyle = '#60a5fa'; 
                const dropY = s.pos.y - s.radius - 5 - Math.sin(time * 0.01) * 3;
                ctx.beginPath();
                ctx.arc(s.pos.x + 5, dropY, 3, 0, Math.PI*2);
                ctx.fill();
            }
        }
        else if (item.type === 'dog') {
            const d = item.obj as any;
            const isIdle = vecMag(d.vel) < 0.2;
            
            // Breathing animation
            const breath = isIdle ? Math.sin(time * 0.005) * 0.8 : 0;
            const r = d.radius + breath;

            drawShadow(ctx, d.pos.x, d.pos.y, r);
            
            // Body Main Color
            ctx.fillStyle = dogPalette.primary;
            ctx.beginPath();
            ctx.arc(d.pos.x, d.pos.y, r, 0, Math.PI * 2);
            ctx.fill();
            
            // White Markings
            ctx.fillStyle = dogPalette.secondary;
            ctx.beginPath();
            ctx.arc(d.pos.x, d.pos.y, r * 0.5, 0, Math.PI * 2);
            ctx.fill();

            // Collar
            ctx.strokeStyle = COLORS.dogCollar;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(d.pos.x, d.pos.y, r, 0, Math.PI * 2);
            ctx.stroke();

            // Head/Snout indicator (Uses facingDir now)
            // Normalized facingDir stored in d.facingDir
            const snoutX = d.pos.x + d.facingDir.x * r * 0.7;
            const snoutY = d.pos.y + d.facingDir.y * r * 0.7;
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(snoutX, snoutY, 3, 0, Math.PI*2);
            ctx.fill();
        }
    });
  };

  const loop = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        updatePhysics();
        draw(ctx, time);
      }
    }
    requestRef.current = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [loop]);

  // Key listeners
  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => { keys.current[e.key] = true; };
    const handleUp = (e: KeyboardEvent) => { keys.current[e.key] = false; };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden shadow-2xl bg-white">
      <canvas 
        ref={canvasRef} 
        width={windowSize.w} 
        height={windowSize.h}
        className="block bg-[#dbe7c5] cursor-none w-full h-full"
      />

      {/* Intro Screen */}
      {gameState === 'INTRO' && (
        <div className="absolute inset-0 bg-[#f4f6f0] flex flex-col items-center justify-center text-stone-800 p-8 text-center animate-in fade-in z-20">
           <h1 className="text-6xl font-serif mb-4 text-[#556b3e] tracking-tighter">Herdlight</h1>
           <p className="text-xl font-light italic opacity-70 mb-12">Harmony in the fields.</p>
           
           <div className="flex flex-col gap-6 mb-12 text-stone-600 bg-white/50 p-6 rounded-2xl border border-stone-200">
                <div className="flex items-center justify-center gap-4">
                    <div className="flex gap-2">
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center font-bold text-stone-500 shadow-sm">W</div>
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center font-bold text-stone-500 shadow-sm">A</div>
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center font-bold text-stone-500 shadow-sm">S</div>
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center font-bold text-stone-500 shadow-sm">D</div>
                    </div>
                    <span className="text-sm uppercase tracking-widest opacity-50 font-bold">OR</span>
                    <div className="flex gap-2">
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center text-stone-500 shadow-sm">↑</div>
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center text-stone-500 shadow-sm">←</div>
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center text-stone-500 shadow-sm">↓</div>
                        <div className="w-10 h-10 bg-white border-2 border-stone-300 rounded-lg flex items-center justify-center text-stone-500 shadow-sm">→</div>
                    </div>
                </div>
                <p className="text-lg font-serif">Move your faithful companion to guide the flock.</p>
                <div className="flex items-center justify-center gap-6 text-sm opacity-90">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-[#fcfcfc] border border-stone-300 shadow-sm"></div>
                        <span>White Sheep</span>
                        <ArrowRight className="w-4 h-4 opacity-50" />
                        <span className="font-bold text-[#a3a3a3]">Light Pasture</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-[#383838] shadow-sm"></div>
                        <span>Dark Sheep</span>
                        <ArrowRight className="w-4 h-4 opacity-50" />
                        <span className="font-bold text-[#6b7280]">Dark Pasture</span>
                    </div>
                </div>
           </div>

           <button 
             onClick={handleIntroComplete}
             className="group flex items-center gap-3 bg-[#8b7355] text-white px-10 py-4 rounded-full transition-all hover:bg-[#725e44] hover:scale-105 shadow-xl hover:shadow-2xl"
           >
             <span className="text-xl tracking-wide font-medium">Enter the Valley</span>
             <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
           </button>
        </div>
      )}

      {/* Select Dog Screen */}
      {gameState === 'SELECT_DOG' && (
        <div className="absolute inset-0 bg-[#f4f6f0] flex flex-col items-center justify-center text-stone-800 p-8 text-center animate-in fade-in z-20">
           <h2 className="text-4xl font-serif mb-2 text-[#556b3e]">Choose Your Companion</h2>
           <p className="text-lg mb-8 opacity-70 italic">Who will guide the flock today?</p>
           
           <div className="grid grid-cols-2 gap-4 mb-8">
              {Object.values(DOG_PALETTES).map((p) => (
                <button 
                  key={p.name}
                  onClick={() => handleDogSelect(p)}
                  className="flex flex-col items-center gap-3 p-4 rounded-xl border-2 border-stone-200 hover:border-[#8b7355] hover:bg-stone-50 transition-all group"
                >
                  <div className="w-16 h-16 rounded-full border-4 border-[#e05252] shadow-md relative" style={{ backgroundColor: p.primary }}>
                     <div className="absolute inset-0 m-auto w-8 h-8 rounded-full" style={{ backgroundColor: p.secondary }} />
                  </div>
                  <span className="font-serif font-bold group-hover:text-[#8b7355]">{p.name}</span>
                </button>
              ))}
           </div>
        </div>
      )}

      {/* Level Start / Flavor */}
      {gameState === 'START' && (
        <div className="absolute inset-0 bg-[#374151]/80 backdrop-blur-sm flex flex-col items-center justify-center text-white p-8 text-center transition-all duration-500 z-20">
           {loadingLevel ? (
             <div className="flex flex-col items-center">
               <Loader2 className="w-12 h-12 animate-spin mb-4 text-[#7ea157]" />
               <p className="text-xl font-light font-serif">Growing the grass...</p>
             </div>
           ) : (
             <>
              <div className="uppercase tracking-widest text-sm text-[#7ea157] font-bold mb-2">Pasture {level} of {MAX_LEVELS}</div>
              <h2 className="text-4xl md:text-6xl font-serif mb-4 text-[#dbe7c5]">{flavor.title}</h2>
              <p className="text-lg md:text-xl font-light italic opacity-90 mb-8 max-w-lg font-serif">
                "{flavor.description}"
              </p>
              <button 
                onClick={handleStart}
                className="group flex items-center gap-3 bg-[#7ea157] hover:bg-[#658a44] text-white px-8 py-4 rounded-full transition-all transform hover:scale-105 shadow-xl border-2 border-[#f4f6f0]/20"
              >
                <Play className="w-6 h-6 fill-current" />
                <span className="text-xl tracking-wide font-medium">Begin</span>
              </button>
             </>
           )}
        </div>
      )}

      {/* Level Won */}
      {gameState === 'WON' && (
        <div className="absolute inset-0 bg-[#7ea157]/90 backdrop-blur-md flex flex-col items-center justify-center text-white p-8 text-center animate-in fade-in duration-700 z-20">
          <CheckCircle2 className="w-16 h-16 text-yellow-100 mb-6 drop-shadow-lg" />
          <h2 className="text-5xl font-serif mb-4">Pasture Secured</h2>
          <p className="text-xl font-light opacity-90 mb-8 font-serif">The flock rests easy.</p>
          <button 
            onClick={handleNextLevel}
            className="flex items-center gap-3 bg-white text-[#556b3e] hover:bg-[#f4f6f0] px-8 py-4 rounded-full transition-all transform hover:scale-105 shadow-lg border-b-4 border-[#dbe7c5]"
          >
            <span className="text-xl font-bold">Next Pasture</span>
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Game Completed */}
      {gameState === 'COMPLETED' && (
        <div className="absolute inset-0 bg-[#556b3e] flex flex-col items-center justify-center text-white p-8 text-center animate-in fade-in duration-1000 z-20">
          <Trophy className="w-20 h-20 text-yellow-300 mb-6 drop-shadow-lg" />
          <h2 className="text-6xl font-serif mb-6">Master Shepherd</h2>
          <p className="text-2xl font-light opacity-90 mb-10 font-serif max-w-lg">
            You have guided all flocks to safety. The valley is at peace thanks to you and {selectedPalette.name}.
          </p>
          <button 
            onClick={handleRestart}
            className="flex items-center gap-3 bg-white text-[#556b3e] hover:bg-[#f4f6f0] px-10 py-5 rounded-full transition-all transform hover:scale-105 shadow-xl border-b-4 border-[#dbe7c5]"
          >
            <span className="text-xl font-bold">Return to Farm</span>
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      )}
      
      {/* HUD */}
      {gameState === 'PLAYING' && (
         <>
         <div className="absolute top-4 left-4 bg-white/90 backdrop-blur text-[#556b3e] px-4 py-2 rounded-full shadow-md border border-[#c5d6a9] pointer-events-none z-10">
           <span className="font-serif font-bold text-lg tracking-wide">Level {level} / {MAX_LEVELS}</span>
         </div>
         </>
      )}

      {/* Audio Toggle (Always Visible except selection and intro) */}
      {gameState !== 'SELECT_DOG' && gameState !== 'INTRO' && (
        <button 
            onClick={toggleMute}
            className="absolute top-4 right-4 bg-white/80 p-2 rounded-full hover:bg-white text-stone-600 transition-colors z-10"
            title={isMuted ? "Unmute Nature" : "Mute Nature"}
        >
            {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
        </button>
      )}
    </div>
  );
};

export default HerdingGame;
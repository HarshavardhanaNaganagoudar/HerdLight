export const MAX_LEVELS = 5;

export const DOG_RADIUS = 12;
export const DOG_SPEED = 4.5;
export const SHEEP_RADIUS = 11; // Slightly larger for fluffiness
export const SHEEP_MAX_SPEED = 3.0; // Faster when panicked
export const SHEEP_WANDER_SPEED = 0.4;

export const PERCEPTION_RADIUS = 130; 
export const SEPARATION_RADIUS = 30; 
export const FLOCKING_RADIUS = 80;
export const ALIGNMENT_WEIGHT = 0.08;
export const COHESION_WEIGHT = 0.05;

// Art Style Palette - Soft, Flat, Natural
export const COLORS = {
  grass: '#dbe7c5', // Warmer, softer sage
  grassDetails: '#c5d6a9', // For texture specs
  pastureWhite: '#f4f6f0',
  pastureBlack: '#4b4e54',
  fence: '#8b7355',
  dogCollar: '#e05252',
  sheepWhite: '#fcfcfc',
  sheepWhiteShadow: '#e2e2e2',
  sheepBlack: '#383838',
  sheepBlackShadow: '#222222',
  rock: '#9ca3af',
  rockShadow: '#6b7280',
  treeTrunk: '#785c3e',
  treeLeaves: '#7ea157',
  shadow: 'rgba(0, 0, 0, 0.15)', // Soft drop shadows
};

export const DOG_PALETTES = {
  BLACK: { name: 'Classic Black', primary: '#2d2d2d', secondary: '#fcfcfc' },
  BLUE: { name: 'Blue Merle', primary: '#6b7280', secondary: '#f3f4f6' },
  CHOCOLATE: { name: 'Chocolate', primary: '#5D4037', secondary: '#fff1e6' },
  RED: { name: 'Red', primary: '#8D6E63', secondary: '#fafaf9' },
};

export const PASTURE_SETTINGS = [
  {
    type: 'WHITE',
    color: 'rgba(255, 255, 255, 0.25)',
    borderColor: '#a3a3a3',
    label: 'White Flock'
  },
  {
    type: 'BLACK',
    color: 'rgba(50, 50, 50, 0.1)',
    borderColor: '#6b7280',
    label: 'Dark Flock'
  }
] as const;
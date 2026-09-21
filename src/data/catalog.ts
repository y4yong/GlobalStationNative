import { DramaItem } from './models/Drama';

export const DRAMAS: DramaItem[] = [
  {
    id: '1', title: 'Thorns of the Heart: Season 2', category: 'Romance', genre: 'Romance Drama', rating: 'P13', badge: 'VIP', tag: 'New Episode',
    description: 'Two wounded souls fight against betrayal, unspoken secrets, and high-society sabotage in this dramatic romantic saga.',
    episodes: [
      { id: 'ep1', title: 'Episode 1: The Broken Oath', duration: '42 min', rating: 'P13' },
      { id: 'ep2', title: 'Episode 2: Silent Tears', duration: '45 min', rating: 'P13' },
      { id: 'ep3', title: 'Episode 3: Shadows of Betrayal', duration: '40 min', rating: 'P13' },
    ],
  },
  {
    id: '2', title: 'First Encounter', category: 'Malay Drama', genre: 'Drama', rating: 'P13', badge: 'VIP', progress: 0.65, timeLeft: '12m left',
    description: 'An accidental meeting during an evening commute sets off a journey of unexpected revelations.',
    episodes: [{ id: 'ep1', title: 'Episode 1: Train Station', duration: '38 min', rating: 'P13' }],
  },
  {
    id: '3', title: 'Central Precinct', category: 'Action', genre: 'Crime Unit', rating: '18', badge: 'FREE', progress: 0.3, timeLeft: '34m left',
    description: 'A tactical unit investigates an elusive syndicate operating right under the police radar.',
    episodes: [{ id: 'ep1', title: 'Episode 1: Code Red', duration: '44 min', rating: '18' }],
  },
  {
    id: '4', title: 'Terminal Love', category: 'Romance', genre: 'Romance Drama', rating: 'P13', badge: 'VIP',
    description: 'Two wounded souls meet at a terminal filled with old memories.',
    episodes: [
      { id: 'ep1', title: 'Episode 1: Last Platform', duration: '40 min', rating: 'P13' },
      { id: 'ep2', title: 'Episode 2: The Lost Letter', duration: '42 min', rating: 'P13' },
      { id: 'ep3', title: 'Episode 3: Promise at Dawn', duration: '44 min', rating: 'P13' },
    ],
  },
  {
    id: '5', title: 'Shadow Unit', category: 'Action', genre: 'Action Thriller', rating: '18', badge: 'FREE',
    description: 'Undercover operatives deploy into dangerous territories to neutralize rogue factions.',
    episodes: [{ id: 'ep1', title: 'Episode 1: Covert Ops', duration: '41 min', rating: '18' }],
  },
  {
    id: '6', title: 'Jasmine & Firdaus', category: 'Malay Drama', genre: 'Romance Drama', rating: 'P13', badge: 'VIP',
    description: 'A contemporary romance navigating cultural heritage and corporate ambition.',
    episodes: [{ id: 'ep1', title: 'Episode 1: Fragrant Beginnings', duration: '43 min', rating: 'P13' }],
  },
];

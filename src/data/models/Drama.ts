export type UserRole = 'VIEWER' | 'CREATOR' | 'ADVERTISER' | 'ADMIN';

export interface Episode {
  id: string;
  title: string;
  contentType: 'MOVIE' | 'SERIES';
  duration: string;
  rating: string;
  requiresVip: boolean;
}

export interface DramaItem {
  id: string;
  title: string;
  category: string;
  genre: string;
  rating: string;
  badge: 'VIP' | 'FREE';
  posterUrl?: string;
  progress?: number;
  timeLeft?: string;
  tag?: string;
  description: string;
  episodes: Episode[];
}

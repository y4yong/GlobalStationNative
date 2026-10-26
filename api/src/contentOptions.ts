import { z } from 'zod';

export const contentGenres = [
  'Action',
  'Adventure',
  'Animation',
  'Biography',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Kids',
  'Martial Arts',
  'Mystery',
  'Musical',
  'Romance',
  'Science Fiction',
  'Sports',
  'Supernatural',
  'Thriller',
  'War',
  'Western',
] as const;

const genreListSchema = z.array(z.enum(contentGenres))
  .min(1, 'Choose at least one genre.')
  .max(contentGenres.length)
  .refine((genres) => new Set(genres).size === genres.length, 'Choose each genre only once.')
  .transform((genres) => genres.join(', '));

export const contentGenreSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((genre) => genre.trim()).filter(Boolean);
  return value;
}, genreListSchema);

export const contentCategories = [
  'Documentary',
  'Film',
  'Malay Drama',
  'Original Series',
  'Korean Drama',
  'Variety',
] as const;

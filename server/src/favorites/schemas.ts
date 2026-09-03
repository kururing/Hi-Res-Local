import { Type } from '@sinclair/typebox';

export const FavoriteAlbumSchema = Type.Object({
  album_title: Type.String(),
  artist_name: Type.String(),
});

export const FavoriteAlbumBodySchema = Type.Object({
  album_title: Type.String({ minLength: 1, maxLength: 300 }),
  artist_name: Type.String({ minLength: 1, maxLength: 200 }),
});

export const FavoriteArtistBodySchema = Type.Object({
  artist_name: Type.String({ minLength: 1, maxLength: 200 }),
});

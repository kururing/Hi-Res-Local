import { Track, LibraryStats } from '../types/library';
import { Playlist } from '../types/playlist';
import { AudioOutputDevice } from '../types/audio';

export const SAMPLE_LRC_1 = `[ti:Nắng Ấm Xa Dần]
[ar:Sơn Tùng M-TP]
[al:Tuyển Tập Sơn Tùng]
[by:Nghe Nhac Pro Max]
[00:00.00]Nắng Ấm Xa Dần - Sơn Tùng M-TP
[00:08.50]Cơn mưa ngang qua mang em đi thật xa
[00:13.20]Nụ cười em nay đã khuất sau làn mây
[00:17.80]Tìm lại bao ký ức trong từng hạt mưa rơi rớt
[00:23.00]Lời thề xưa người trao nay tan vào không gian
[00:28.40]Nắng ấm xa dần rồi, đông sang lạnh buốt lòng ai
[00:33.70]Từng giọt sầu vương trên mi hoen bờ vai
[00:39.10]Người quay bước không một câu giã từ
[00:44.20]Để lại nơi đây bao nhiêu nỗi xót xa...
[00:50.00]Chỉ mong em bình yên bên phương trời xa
[00:55.30]Dẫu cho anh một mình đi qua giông bão
[01:00.60]Nụ cười em như tia nắng sưởi ấm mùa đông
[01:06.00]Giờ đây đã theo gió bay về trời xa...`;

export const SAMPLE_LRC_2 = `[ti:Bohemian Rhapsody]
[ar:Queen]
[al:A Night at the Opera]
[by:Nghe Nhac Pro Max]
[00:00.00]Bohemian Rhapsody - Queen
[00:05.00]Is this the real life? Is this just fantasy?
[00:11.80]Caught in a landslide, no escape from reality
[00:19.50]Open your eyes, look up to the skies and see
[00:28.00]I'm just a poor boy, I need no sympathy
[00:34.20]Because I'm easy come, easy go, little high, little low
[00:41.50]Any way the wind blows doesn't really matter to me, to me
[00:53.00]Mama, just killed a man
[00:58.20]Put a gun against his head, pulled my trigger, now he's dead
[01:06.50]Mama, life had just begun
[01:12.00]But now I've gone and thrown it all away
[01:19.20]Mama, ooh, didn't mean to make you cry
[01:27.50]If I'm not back again this time tomorrow
[01:32.40]Carry on, carry on as if nothing really matters...`;

export const SAMPLE_LRC_JAPANESE = `[ti:夜に駆ける]
[ar:YOASOBI]
[al:THE BOOK]
[by:Nghe Nhac Pro Max]
[00:00.00]夜に駆ける - YOASOBI
[00:02.50]沈むように溶けてゆくように
[00:08.20]二人だけの空が広がる夜に
[00:15.50]「さよなら」だけだった
[00:19.00]その一言で全てが分かった
[00:23.00]日が沈み出した空と君の姿
[00:28.00]フェンス越しに重なっていた
[00:33.50]初めて会った日から
[00:37.00]僕の心の全てを奪った
[00:41.00]どこか儚い空気を纏う君は
[00:46.00]寂しい目をした人だった`;

export const SAMPLE_LRC_ROMANIZED = `[ti:Yoru ni Kakeru]
[ar:YOASOBI]
[al:THE BOOK]
[00:00.00]Yoru ni Kakeru - YOASOBI
[00:02.50]Shizumu you ni tokete yuku you ni
[00:08.20]Futari dake no sora ga hirogaru yoru ni
[00:15.50]'Sayonara' dake datta
[00:19.00]Sono hitokoto de subete ga wakatta
[00:23.00]Hi ga shizumi dashita sora to kimi no sugata
[00:28.00]Fensu goshi ni kasanatte ita
[00:33.50]Hajimete atta hi kara
[00:37.00]Boku no kokoro no subete wo ubatta
[00:41.00]Doko ka hakanai kuuki wo matou kimi wa
[00:46.00]Sabishii me wo shita hito datta`;

export const MOCK_TRACKS: Track[] = [
  {
    id: 'track-1',
    title: 'Nắng Ấm Xa Dần (Remastered)',
    artist: 'Sơn Tùng M-TP',
    album: 'Tuyển Tập Sơn Tùng',
    duration: 218,
    path: 'D:/Music/V-Pop/SonTung/NangAmXaDan_Remastered.flac',
    track_number: 1,
    disc_number: 1,
    year: 2019,
    genre: 'V-Pop',
    sample_rate: 96000,
    bitrate: 2850,
    channels: 2,
    date_added: '2025-01-15T08:30:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: true,
    play_count: 42,
    lyrics: SAMPLE_LRC_1,
  },
  {
    id: 'track-2',
    title: 'Lạc Trôi',
    artist: 'Sơn Tùng M-TP',
    album: 'Tuyển Tập Sơn Tùng',
    duration: 233,
    path: 'D:/Music/V-Pop/SonTung/LacTroi.flac',
    track_number: 2,
    disc_number: 1,
    year: 2017,
    genre: 'V-Pop',
    sample_rate: 48000,
    bitrate: 1411,
    channels: 2,
    date_added: '2025-01-15T08:31:00Z',
    format: 'FLAC',
    bits_per_sample: 16,
    is_favorite: true,
    play_count: 35,
    lyrics: SAMPLE_LRC_1,
  },
  {
    id: 'track-3',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    duration: 354,
    path: 'D:/Music/Rock/Queen/04_Bohemian_Rhapsody.flac',
    track_number: 4,
    disc_number: 1,
    year: 1975,
    genre: 'Classic Rock',
    sample_rate: 96000,
    bitrate: 3100,
    channels: 2,
    date_added: '2025-01-10T12:00:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: true,
    play_count: 88,
    lyrics: SAMPLE_LRC_2,
  },
  {
    id: 'track-4',
    title: 'Love of My Life',
    artist: 'Queen',
    album: 'A Night at the Opera',
    duration: 219,
    path: 'D:/Music/Rock/Queen/09_Love_of_My_Life.mp3',
    track_number: 9,
    disc_number: 1,
    year: 1975,
    genre: 'Classic Rock',
    sample_rate: 44100,
    bitrate: 320,
    channels: 2,
    date_added: '2025-01-10T12:05:00Z',
    format: 'MP3',
    bits_per_sample: 16,
    is_favorite: false,
    play_count: 19,
  },
  {
    id: 'track-5',
    title: 'Hotel California (Live on MTV 1994)',
    artist: 'Eagles',
    album: 'Hell Freezes Over',
    duration: 432,
    path: 'D:/Music/Rock/Eagles/Hotel_California_Live.flac',
    track_number: 6,
    disc_number: 1,
    year: 1994,
    genre: 'Acoustic Rock',
    sample_rate: 192000,
    bitrate: 5400,
    channels: 2,
    date_added: '2025-01-18T14:20:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: true,
    play_count: 64,
  },
  {
    id: 'track-6',
    title: 'Get Lucky (feat. Pharrell Williams)',
    artist: 'Daft Punk',
    album: 'Random Access Memories',
    duration: 369,
    path: 'D:/Music/Electronic/DaftPunk/08_Get_Lucky.flac',
    track_number: 8,
    disc_number: 1,
    year: 2013,
    genre: 'Electronic',
    sample_rate: 88200,
    bitrate: 2900,
    channels: 2,
    date_added: '2025-02-01T09:15:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: true,
    play_count: 51,
  },
  {
    id: 'track-7',
    title: 'Instant Crush (feat. Julian Casablancas)',
    artist: 'Daft Punk',
    album: 'Random Access Memories',
    duration: 337,
    path: 'D:/Music/Electronic/DaftPunk/05_Instant_Crush.flac',
    track_number: 5,
    disc_number: 1,
    year: 2013,
    genre: 'Electronic',
    sample_rate: 88200,
    bitrate: 2850,
    channels: 2,
    date_added: '2025-02-01T09:12:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: false,
    play_count: 28,
  },
  {
    id: 'track-8',
    title: 'Clair de Lune',
    artist: 'Claude Debussy',
    album: 'Suite bergamasque',
    duration: 304,
    path: 'D:/Music/Classical/Debussy/Clair_de_Lune.wav',
    track_number: 3,
    disc_number: 1,
    year: 1905,
    genre: 'Classical',
    sample_rate: 96000,
    bitrate: 4608,
    channels: 2,
    date_added: '2025-02-10T16:45:00Z',
    format: 'WAV',
    bits_per_sample: 24,
    is_favorite: true,
    play_count: 73,
  },
  {
    id: 'track-9',
    title: 'Nocturne in E-flat Major, Op. 9, No. 2',
    artist: 'Frédéric Chopin',
    album: 'Chopin: The Nocturnes',
    duration: 275,
    path: 'D:/Music/Classical/Chopin/Nocturne_Op9_No2.flac',
    track_number: 2,
    disc_number: 1,
    year: 1832,
    genre: 'Classical',
    sample_rate: 96000,
    bitrate: 2600,
    channels: 2,
    date_added: '2025-02-10T16:50:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: false,
    play_count: 38,
  },
  {
    id: 'track-10',
    title: 'Bao Tiền Một Mớ Bình Yên?',
    artist: '14 Casper & Bon',
    album: 'Bao Tiền Một Mớ Bình Yên?',
    duration: 246,
    path: 'D:/Music/Indie/14Casper/BaoTienMotMoBinhYen.mp3',
    track_number: 1,
    disc_number: 1,
    year: 2021,
    genre: 'Indie Pop',
    sample_rate: 44100,
    bitrate: 320,
    channels: 2,
    date_added: '2025-02-14T20:10:00Z',
    format: 'MP3',
    bits_per_sample: 16,
    is_favorite: true,
    play_count: 22,
  },
  {
    id: 'track-11',
    title: 'Đi Về Nhà',
    artist: 'Đen & JustaTee',
    album: 'Tuyển Tập Đen Vâu',
    duration: 208,
    path: 'D:/Music/V-Rap/Den/DiVeNha.flac',
    track_number: 3,
    disc_number: 1,
    year: 2020,
    genre: 'V-Rap',
    sample_rate: 48000,
    bitrate: 1550,
    channels: 2,
    date_added: '2025-02-15T10:00:00Z',
    format: 'FLAC',
    bits_per_sample: 16,
    is_favorite: true,
    play_count: 67,
  },
  {
    id: 'track-12',
    title: 'Take Five',
    artist: 'The Dave Brubeck Quartet',
    album: 'Time Out',
    duration: 324,
    path: 'D:/Music/Jazz/DaveBrubeck/03_Take_Five.flac',
    track_number: 3,
    disc_number: 1,
    year: 1959,
    genre: 'Jazz',
    sample_rate: 192000,
    bitrate: 5120,
    channels: 2,
    date_added: '2025-02-16T11:20:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: true,
    play_count: 45,
  },
  {
    id: 'track-13',
    title: '夜に駆ける (Yoru ni Kakeru)',
    artist: 'YOASOBI',
    album: 'THE BOOK',
    duration: 261,
    path: 'D:/Music/J-Pop/YOASOBI/01_Yoru_ni_Kakeru.flac',
    track_number: 1,
    disc_number: 1,
    year: 2021,
    genre: 'J-Pop',
    sample_rate: 96000,
    bitrate: 3100,
    channels: 2,
    date_added: '2025-02-18T10:00:00Z',
    format: 'FLAC',
    bits_per_sample: 24,
    is_favorite: true,
    play_count: 110,
    lyrics: SAMPLE_LRC_JAPANESE,
  }
];

export const MOCK_PLAYLISTS: Playlist[] = [
  {
    id: 'pl-1',
    name: 'Masterpiece Hi-Res Audio',
    description: 'Bộ sưu tập nhạc chất lượng cao FLAC 24-bit/96kHz & 192kHz',
    track_ids: ['track-1', 'track-3', 'track-5', 'track-6', 'track-8', 'track-12'],
    created_at: '2025-02-01T10:00:00Z',
    updated_at: '2025-02-18T15:30:00Z',
    is_smart: false,
  },
  {
    id: 'pl-2',
    name: 'Giai Điệu Việt Nam Tuyển Chọn',
    description: 'Những ca khúc V-Pop và Indie được yêu thích nhất',
    track_ids: ['track-1', 'track-2', 'track-10', 'track-11'],
    created_at: '2025-02-05T14:00:00Z',
    updated_at: '2025-02-15T18:20:00Z',
    is_smart: false,
  },
  {
    id: 'pl-smart-2',
    name: 'Smart: Classic & Acoustic Rock',
    description: 'Tự động lọc theo thể loại Rock & Acoustic',
    track_ids: ['track-3', 'track-4', 'track-5'],
    created_at: '2025-02-01T00:00:00Z',
    updated_at: '2025-02-20T00:00:00Z',
    is_smart: true,
    smart_rule: { type: 'genre', value: 'Rock' },
  }
];

export const MOCK_OUTPUT_DEVICES: AudioOutputDevice[] = [
  { id: 'default', name: 'Windows Default Audio Endpoint (WASAPI Shared)', is_default: true, sample_rates: [44100, 48000, 96000, 192000], bit_depths: [16, 24, 32], channels: [2] },
  { id: 'dac-usb', name: 'Topping DX3 Pro+ High-Res DAC (WASAPI Exclusive)', is_default: false, sample_rates: [44100, 48000, 88200, 96000, 176400, 192000, 384000, 768000], bit_depths: [16, 24, 32], channels: [2] },
  { id: 'headphones', name: 'Realtek High Definition Audio (Headphones)', is_default: false, sample_rates: [44100, 48000], bit_depths: [16, 24], channels: [2] },
];

export function getMockStats(tracks: Track[]): LibraryStats {
  const artists = new Set(tracks.map(t => t.artist));
  const albums = new Set(tracks.map(t => t.album));
  const totalSecs = tracks.reduce((acc, t) => acc + t.duration, 0);

  return {
    total_tracks: tracks.length,
    total_artists: artists.size,
    total_albums: albums.size,
    total_duration_secs: totalSecs,
    total_size_bytes: tracks.length * 35 * 1024 * 1024, // avg ~35MB per lossless track
  };
}

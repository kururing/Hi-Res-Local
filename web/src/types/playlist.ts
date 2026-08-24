export type SmartRuleType =
  | 'genre'
  | 'recently_added'
  | 'recently_played'
  | 'top_played'
  | 'hi_res'
  | 'artist';

export interface SmartRule {
  type: SmartRuleType;
  value?: string | number;
  limit?: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  track_ids: string[];
  created_at: string;
  updated_at: string;
  is_smart?: boolean;
  smart_rule?: SmartRule;
  cover_url?: string | null;
}

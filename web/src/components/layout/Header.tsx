import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  FolderSync,
  Moon,
  Sun,
  Globe,
  Music,
  Disc,
  User,
  X,
} from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { usePlayer } from '../../context/PlayerContext';
import { fuzzySearch } from '../../services/fuzzy';
import { Track, Album, Artist } from '../../types/library';
import { t } from '../../i18n';

interface HeaderProps {
  currentView: string;
  onNavigate: (view: string, payload?: unknown) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onNavigate,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
}) => {
  const { tracks, albums, artists, scanProgress, scanDirectory } = useLibrary();
  const { settings, setTheme, setLanguage } = useSettings();
  const { playTrack } = usePlayer();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Global Ctrl+K shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsDropdownOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compute fuzzy search matches
  const matchedTracks = React.useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return fuzzySearch<Track>(tracks, debouncedQuery, ['title', 'artist', 'album', 'genre'])
      .slice(0, 5)
      .map(r => r.item);
  }, [tracks, debouncedQuery]);

  const matchedAlbums = React.useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return fuzzySearch<Album>(albums, debouncedQuery, ['name', 'artist', 'genre'])
      .slice(0, 3)
      .map(r => r.item);
  }, [albums, debouncedQuery]);

  const matchedArtists = React.useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return fuzzySearch<Artist>(artists, debouncedQuery, ['name'])
      .slice(0, 3)
      .map(r => r.item);
  }, [artists, debouncedQuery]);

  const hasResults = matchedTracks.length > 0 || matchedAlbums.length > 0 || matchedArtists.length > 0;

  return (
    <header className="h-16 bg-oled-base/90 border-b border-brand-border/60 backdrop-blur-md px-6 flex items-center justify-between gap-4 z-30 sticky top-0 select-none">
      {/* Navigation History */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          disabled={!canGoBack}
          onClick={onGoBack}
          className="min-w-[44px] min-h-[44px] rounded-lg bg-oled-card border border-brand-border text-brand-muted hover:text-white disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors focus-visible:outline-none"
          aria-label="Go back"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          disabled={!canGoForward}
          onClick={onGoForward}
          className="min-w-[44px] min-h-[44px] rounded-lg bg-oled-card border border-brand-border text-brand-muted hover:text-white disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors focus-visible:outline-none"
          aria-label="Go forward"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Global Fuzzy Search Bar */}
      <div
        ref={searchContainerRef}
        className="relative flex-1 max-w-xl"
        aria-expanded={isDropdownOpen && Boolean(debouncedQuery.trim())}
      >
        <div className="relative flex items-center">
          <Search className="absolute left-3.5 w-4 h-4 text-brand-muted pointer-events-none" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            placeholder={t('search_placeholder', settings.language)}
            className="w-full h-11 bg-oled-card border border-brand-border text-brand-foreground placeholder-brand-muted text-xs sm:text-sm rounded-xl pl-10 pr-11 focus:border-brand-secondary focus:bg-oled-hover focus-visible:outline-none transition-all shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setIsDropdownOpen(false);
              }}
              className="absolute right-1 min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-muted hover:text-brand-foreground rounded-lg focus-visible:outline-none"
              aria-label="Clear search query"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Instant Search Results Dropdown */}
        {isDropdownOpen && debouncedQuery.trim() && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-oled-card/98 border border-brand-border rounded-xl shadow-card-elevated backdrop-blur-xl p-3 z-50 max-h-[460px] overflow-y-auto space-y-3 animate-fadeIn">
            {!hasResults ? (
              <div className="text-center py-6 text-xs text-brand-muted">
                {t('search_no_results', settings.language, { query: debouncedQuery })}
              </div>
            ) : (
              <>
                {/* Matched Tracks */}
                {matchedTracks.length > 0 && (
                  <div>
                    <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider px-2 block mb-1">
                      {t('search_tracks_heading', settings.language, { count: matchedTracks.length })}
                    </span>
                    <div className="space-y-0.5">
                      {matchedTracks.map(tr => (
                        <div
                          key={tr.id}
                          onClick={() => {
                            playTrack(tr);
                            setIsDropdownOpen(false);
                          }}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-oled-hover cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Music className="w-4 h-4 text-brand-accent shrink-0" aria-hidden="true" />
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-medium text-brand-foreground truncate">
                                {tr.title}
                              </span>
                              <span className="text-[10px] text-brand-muted truncate">
                                {tr.artist} • {tr.album}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Matched Albums */}
                {matchedAlbums.length > 0 && (
                  <div>
                    <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider px-2 block mb-1">
                      {t('search_albums_heading', settings.language, { count: matchedAlbums.length })}
                    </span>
                    <div className="space-y-0.5">
                      {matchedAlbums.map(al => (
                        <div
                          key={al.id}
                          onClick={() => {
                            onNavigate('album_detail', al);
                            setIsDropdownOpen(false);
                          }}
                          className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-oled-hover cursor-pointer transition-colors"
                        >
                          <Disc className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium text-brand-foreground truncate">
                              {al.name}
                            </span>
                            <span className="text-[10px] text-brand-muted truncate">
                              {al.artist}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Matched Artists */}
                {matchedArtists.length > 0 && (
                  <div>
                    <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider px-2 block mb-1">
                      {t('search_artists_heading', settings.language, { count: matchedArtists.length })}
                    </span>
                    <div className="space-y-0.5">
                      {matchedArtists.map(ar => (
                        <div
                          key={ar.id}
                          onClick={() => {
                            onNavigate('artist_detail', ar);
                            setIsDropdownOpen(false);
                          }}
                          className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-oled-hover cursor-pointer transition-colors"
                        >
                          <User className="w-4 h-4 text-brand-muted shrink-0" aria-hidden="true" />
                          <span className="text-xs font-medium text-brand-foreground truncate">
                            {ar.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Right Actions: Rescan, Theme, Language */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Scanning progress badge */}
        {scanProgress && scanProgress.is_scanning && (
          <div className="flex items-center gap-2 px-3 py-1 bg-brand-primary/60 border border-brand-border rounded-full text-xs text-brand-accent animate-pulse">
            <FolderSync className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span className="hidden md:inline">
              Scanning ({scanProgress.scanned_files}/{scanProgress.total_files})
            </span>
          </div>
        )}

        {/* Rescan Button */}
        <button
          onClick={() => scanDirectory()}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-oled-card border border-brand-border text-brand-muted hover:text-brand-foreground hover:bg-oled-hover transition-colors focus-visible:outline-none"
          title={t('settings_btn_rescan', settings.language)}
          aria-label={t('settings_btn_rescan', settings.language)}
        >
          <FolderSync className="w-4 h-4" aria-hidden="true" />
        </button>

        {/* Language Switcher */}
        <button
          onClick={() => setLanguage(settings.language === 'vi' ? 'en' : 'vi')}
          className="min-h-[44px] px-3.5 flex items-center gap-1.5 rounded-lg bg-oled-card border border-brand-border text-xs font-semibold text-brand-muted hover:text-brand-foreground hover:bg-oled-hover transition-colors focus-visible:outline-none"
          title="Toggle Language (VI / EN)"
          aria-label="Toggle language"
        >
          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{settings.language.toUpperCase()}</span>
        </button>

        {/* Theme Switcher */}
        <button
          onClick={() => {
            const nextTheme = settings.theme === 'oled' ? 'midnight' : settings.theme === 'midnight' ? 'slate' : settings.theme === 'slate' ? 'light' : 'oled';
            setTheme(nextTheme);
          }}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-oled-card border border-brand-border text-brand-muted hover:text-brand-foreground hover:bg-oled-hover transition-colors focus-visible:outline-none"
          title={`Theme: ${settings.theme}`}
          aria-label="Toggle theme"
          aria-pressed={settings.theme === 'light'}
        >
          {settings.theme === 'light' ? (
            <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
};

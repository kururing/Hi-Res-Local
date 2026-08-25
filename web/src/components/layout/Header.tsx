import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
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
  currentView,
  onNavigate,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
}) => {
  const { tracks, albums, artists } = useLibrary();
  const { settings } = useSettings();
  const { playTrack } = usePlayer();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
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
        setIsSearchOpen(true);
        setIsDropdownOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (e.key === 'Escape') {
        setIsDropdownOpen(false);
        setIsSearchOpen(false);
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
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [currentView]);

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
    <header className="app-header mx-3 mt-3 h-16 rounded-[22px] border border-brand-border/70 px-5 flex items-center justify-between gap-4 z-30 sticky top-0 select-none">
      {/* Navigation History */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          disabled={!canGoBack}
          onClick={onGoBack}
          className="min-w-[44px] min-h-[44px] rounded-lg bg-oled-card border border-brand-border text-brand-muted hover:text-brand-foreground disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors focus-visible:outline-none"
          aria-label="Go back"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          disabled={!canGoForward}
          onClick={onGoForward}
          className="min-w-[44px] min-h-[44px] rounded-lg bg-oled-card border border-brand-border text-brand-muted hover:text-brand-foreground disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors focus-visible:outline-none"
          aria-label="Go forward"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Global Fuzzy Search Bar */}
      <div
          ref={searchContainerRef}
          className={`relative ml-auto shrink-0 transition-[width] duration-300 ease-out ${
            isSearchOpen ? 'w-[min(38vw,36rem)]' : 'w-11'
          }`}
          aria-expanded={isDropdownOpen && Boolean(debouncedQuery.trim())}
        >
        {!isSearchOpen ? (
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            className="soft-search min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-brand-border text-brand-muted hover:text-brand-foreground hover:border-brand-secondary transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-none"
            aria-label={t('search_placeholder', settings.language)}
            title={t('search_placeholder', settings.language)}
          >
            <Search className="w-4 h-4" aria-hidden="true" />
          </button>
        ) : (
          <div className="relative flex items-center animate-fadeIn">
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
              className="soft-search w-full h-11 border border-brand-border text-brand-foreground placeholder-brand-muted text-xs sm:text-sm rounded-2xl pl-10 pr-11 focus:border-brand-secondary focus-visible:ring-2 focus-visible:ring-brand-accent/70 focus-visible:outline-none transition-all duration-300"
            />
            <button
              type="button"
              onClick={() => {
                if (searchQuery) setSearchQuery('');
                else setIsSearchOpen(false);
                setIsDropdownOpen(false);
              }}
              className="absolute right-1 min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-muted hover:text-brand-foreground rounded-lg focus-visible:outline-none"
              aria-label={searchQuery ? 'Clear search query' : 'Close search'}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Instant Search Results Dropdown */}
        {isDropdownOpen && debouncedQuery.trim() && (
          <div className="search-results-panel absolute left-0 right-0 top-full mt-2 border border-brand-border/70 rounded-2xl shadow-card-elevated backdrop-blur-2xl backdrop-saturate-150 p-3 z-50 max-h-[460px] overflow-y-auto space-y-3 animate-fadeIn isolate">
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
                        <button
                          type="button"
                          key={tr.id}
                          onClick={() => {
                            playTrack(tr);
                            setIsDropdownOpen(false);
                            setIsSearchOpen(false);
                          }}
                          className="flex w-full items-center justify-between p-2 rounded-lg text-left hover:bg-oled-hover cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
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
                        </button>
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
                        <button
                          type="button"
                          key={al.id}
                          onClick={() => {
                            onNavigate('album_detail', al);
                            setIsDropdownOpen(false);
                            setIsSearchOpen(false);
                          }}
                          className="flex w-full items-center gap-2.5 p-2 rounded-lg text-left hover:bg-oled-hover cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                        >
                          <Disc className="w-4 h-4 text-brand-accent shrink-0" aria-hidden="true" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium text-brand-foreground truncate">
                              {al.name}
                            </span>
                            <span className="text-[10px] text-brand-muted truncate">
                              {al.artist}
                            </span>
                          </div>
                        </button>
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
                        <button
                          type="button"
                          key={ar.id}
                          onClick={() => {
                            onNavigate('artist_detail', ar);
                            setIsDropdownOpen(false);
                            setIsSearchOpen(false);
                          }}
                          className="flex w-full items-center gap-2.5 p-2 rounded-lg text-left hover:bg-oled-hover cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                        >
                          <User className="w-4 h-4 text-brand-muted shrink-0" aria-hidden="true" />
                          <span className="text-xs font-medium text-brand-foreground truncate">
                            {ar.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Profile shortcut */}
      <button
        type="button"
        onClick={() => onNavigate('settings')}
        className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-border bg-oled-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        title={t('nav_settings', settings.language)}
        aria-label={t('nav_settings', settings.language)}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-accent/80 to-brand-secondary text-white shadow-sm group-hover:brightness-110">
          <User className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
    </header>
  );
};

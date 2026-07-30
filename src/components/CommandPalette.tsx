import React, { useState, useEffect, useRef } from 'react';
import { Search, Terminal, Monitor, HardDrive, Star, Clock } from 'lucide-react';
import type { Connection } from '@omniterm/contract';
import { useConnectionMeta } from '../hooks/useConnectionMeta';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  connections: Connection[];
  onConnect: (conn: Connection) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  connections,
  onConnect
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { recents, favorites, addRecent, toggleFavorite } = useConnectionMeta();

  let filteredConnections = connections.filter(conn =>
    conn.name.toLowerCase().includes(query.toLowerCase()) ||
    conn.type.toLowerCase().includes(query.toLowerCase())
  );

  // If query is empty, sort favorites first, then recents, then others.
  if (query.trim() === '') {
    filteredConnections = [...connections].sort((a, b) => {
      const aFav = favorites.includes(a.id);
      const bFav = favorites.includes(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      
      const aRec = recents.indexOf(a.id);
      const bRec = recents.indexOf(b.id);
      const aHasRec = aRec !== -1;
      const bHasRec = bRec !== -1;
      
      if (aHasRec && bHasRec) return aRec - bRec;
      if (aHasRec && !bHasRec) return -1;
      if (!aHasRec && bHasRec) return 1;
      
      return a.name.localeCompare(b.name);
    });
  }

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        setSelectedIndex(prev => (prev + 1) % filteredConnections.length);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        setSelectedIndex(prev => (prev - 1 + filteredConnections.length) % filteredConnections.length);
        e.preventDefault();
      } else if (e.key === 'Enter' && filteredConnections.length > 0) {
        const conn = filteredConnections[selectedIndex];
        addRecent(conn.id);
        onConnect(conn);
        onClose();
        e.preventDefault();
      } else if (e.key === 'f' && e.ctrlKey && filteredConnections.length > 0) {
        // Toggle favorite via Ctrl+F
        toggleFavorite(filteredConnections[selectedIndex].id);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredConnections, selectedIndex, onClose, onConnect, addRecent, toggleFavorite]);

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm" 
        onClick={onClose} 
      />

      {/* Palette */}
      <div 
        className="relative w-full max-w-lg bg-theme-popup border border-theme-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-theme-border">
          <Search className="w-5 h-5 text-theme-dim flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-theme-fg outline-none placeholder:text-theme-dim text-lg"
            placeholder="Search connections..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto custom-scrollbar p-2">
          {filteredConnections.length === 0 ? (
            <div className="py-8 text-center text-theme-dim text-sm">
              No connections found.
            </div>
          ) : (
             filteredConnections.map((conn, index) => {
              const isSelected = index === selectedIndex;
              const isFav = favorites.includes(conn.id);
              const isRecent = !isFav && recents.includes(conn.id);
              
              return (
                <div
                  key={conn.id}
                  onClick={() => {
                    addRecent(conn.id);
                    onConnect(conn);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? 'bg-theme-selection text-theme-selection-fg' : 'text-theme-fg hover:bg-theme-hover'
                  }`}
                >
                  {conn.type === 'SSH' ? (
                    <Terminal className={`w-5 h-5 flex-shrink-0 ${isSelected ? 'text-white' : 'text-theme-accent'}`} />
                  ) : conn.type === 'LOCAL' ? (
                    <HardDrive className={`w-5 h-5 flex-shrink-0 ${isSelected ? 'text-white' : 'text-theme-warning'}`} />
                  ) : (
                    <Monitor className={`w-5 h-5 flex-shrink-0 ${isSelected ? 'text-white' : 'text-theme-success'}`} />
                  )}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <div className="text-sm font-medium truncate">{conn.name}</div>
                    {isFav && <Star className="w-3.5 h-3.5 text-theme-warning fill-theme-warning" />}
                    {isRecent && <Clock className="w-3.5 h-3.5 text-theme-dim" />}
                  </div>
                  <div className="flex items-center gap-2">
                    {isSelected && (
                      <div className="text-[10px] text-theme-dim mr-2 hidden sm:block">
                        Ctrl+F to star
                      </div>
                    )}
                    <div className="text-[10px] uppercase font-bold tracking-widest opacity-50 px-2 py-0.5 rounded border border-current">
                      {conn.type}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

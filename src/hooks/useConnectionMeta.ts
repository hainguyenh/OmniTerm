import { useState, useEffect, useCallback } from 'react';

const RECENT_KEY = 'omniterm-recent-conns';
const FAVORITES_KEY = 'omniterm-favorite-conns';

export function useConnectionMeta() {
  const [recents, setRecents] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    const savedRecents = localStorage.getItem(RECENT_KEY);
    if (savedRecents) {
      try { setRecents(JSON.parse(savedRecents)); } catch (e) {}
    }
    const savedFavorites = localStorage.getItem(FAVORITES_KEY);
    if (savedFavorites) {
      try { setFavorites(JSON.parse(savedFavorites)); } catch (e) {}
    }
  }, []);

  const addRecent = useCallback((id: string) => {
    setRecents(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, 10);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const isFav = prev.includes(id);
      const next = isFav ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recents, favorites, addRecent, toggleFavorite };
}

import os
import json
import uuid
import time
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_FILE = os.path.join(DATA_DIR, "db.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
YTMUSIC_AUTH_FILE = os.path.join(DATA_DIR, "ytmusic_auth.json")

os.makedirs(DATA_DIR, exist_ok=True)

class TrackItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    artist: str
    album: Optional[str] = ""
    source_platform: str = "manual"  # 'spotify' | 'soundcloud' | 'youtube' | 'manual'
    source_url: Optional[str] = ""
    thumbnail: Optional[str] = ""
    duration_str: Optional[str] = ""
    main_genre: Optional[str] = "Uncategorized"
    sub_genre: Optional[str] = "General"
    vibe: Optional[str] = ""
    confidence: Optional[float] = 0.0
    matched_yt_id: Optional[str] = None
    matched_yt_title: Optional[str] = None
    is_synced: bool = False
    assigned_playlist: Optional[str] = None
    created_at: float = Field(default_factory=time.time)

class AppSettings(BaseModel):
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.7-flash"
    playlist_prefix: str = "SoundSort: "
    ytmusic_is_connected: bool = False

def get_settings() -> AppSettings:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                settings = AppSettings(**data)
                if settings.gemini_model in ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash"]:
                    settings.gemini_model = "gemini-3.7-flash"
                return settings
        except Exception:
            pass
    # fallback to env var
    api_key = os.environ.get("GEMINI_API_KEY", "")
    return AppSettings(gemini_api_key=api_key, gemini_model="gemini-3.7-flash")

def save_settings(settings: AppSettings) -> AppSettings:
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings.model_dump(), f, indent=2)
    return settings

def get_all_tracks() -> List[TrackItem]:
    if not os.path.exists(DB_FILE):
        return []
    try:
        with open(DB_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [TrackItem(**item) for item in data]
    except Exception:
        return []

def save_all_tracks(tracks: List[TrackItem]):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump([t.model_dump() for t in tracks], f, indent=2, ensure_ascii=False)

def add_tracks(new_tracks: List[TrackItem]) -> List[TrackItem]:
    current_tracks = get_all_tracks()
    
    # Avoid duplicate (same artist and title case-insensitive)
    existing_keys = {f"{t.artist.strip().lower()}-{t.title.strip().lower()}" for t in current_tracks}
    
    added = []
    for track in new_tracks:
        key = f"{track.artist.strip().lower()}-{track.title.strip().lower()}"
        if key not in existing_keys:
            current_tracks.append(track)
            existing_keys.add(key)
            added.append(track)
            
    save_all_tracks(current_tracks)
    return added

def update_track(track_id: str, updates: Dict[str, Any]) -> Optional[TrackItem]:
    tracks = get_all_tracks()
    for i, t in enumerate(tracks):
        if t.id == track_id:
            updated_data = t.model_dump()
            updated_data.update(updates)
            updated_track = TrackItem(**updated_data)
            tracks[i] = updated_track
            save_all_tracks(tracks)
            return updated_track
    return None

def bulk_update_subgenre(old_subgenre: str, new_subgenre: str, new_main_genre: Optional[str] = None):
    tracks = get_all_tracks()
    for t in tracks:
        if (t.sub_genre or "").strip().lower() == old_subgenre.strip().lower():
            t.sub_genre = new_subgenre.strip()
            if new_main_genre:
                t.main_genre = new_main_genre.strip()
    save_all_tracks(tracks)

def delete_track(track_id: str) -> bool:
    tracks = get_all_tracks()
    initial_len = len(tracks)
    tracks = [t for t in tracks if t.id != track_id]
    if len(tracks) < initial_len:
        save_all_tracks(tracks)
        return True
    return False

def batch_delete_tracks(track_ids: List[str]) -> int:
    tracks = get_all_tracks()
    target_set = set(track_ids)
    initial_len = len(tracks)
    tracks = [t for t in tracks if t.id not in target_set]
    deleted_count = initial_len - len(tracks)
    if deleted_count > 0:
        save_all_tracks(tracks)
    return deleted_count

def batch_update_tracks(track_ids: List[str], updates: Dict[str, Any]) -> int:
    tracks = get_all_tracks()
    target_set = set(track_ids)

    effective_updates = dict(updates)
    if "sub_genre" in effective_updates and "main_genre" not in effective_updates:
        target_sub = effective_updates["sub_genre"]
        for t in tracks:
            if t.sub_genre == target_sub and t.main_genre and t.main_genre != "Uncategorized":
                effective_updates["main_genre"] = t.main_genre
                break

    count = 0
    for i, t in enumerate(tracks):
        if t.id in target_set:
            updated_data = t.model_dump()
            updated_data.update(effective_updates)
            tracks[i] = TrackItem(**updated_data)
            count += 1
    if count > 0:
        save_all_tracks(tracks)
    return count

def clear_all_tracks():
    save_all_tracks([])


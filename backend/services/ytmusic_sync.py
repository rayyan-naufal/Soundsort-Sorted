import os
import json
import logging
from typing import List, Dict, Any, Optional, Tuple
from ytmusicapi import YTMusic
from backend.services.storage import TrackItem, YTMUSIC_AUTH_FILE, get_settings, save_settings

logger = logging.getLogger(__name__)

class YTMusicSyncService:
    def __init__(self):
        self._ytmusic: Optional[YTMusic] = None
        self._init_client()

    def _get_active_auth_file(self) -> Optional[str]:
        candidates = [
            YTMUSIC_AUTH_FILE,
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "ytmusic_auth.json"),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "ytmusic_auth.json"),
            os.path.join(os.path.dirname(YTMUSIC_AUTH_FILE), "oauth.json"),
            os.path.join(os.getcwd(), "oauth.json"),
            os.path.join(os.getcwd(), "data", "oauth.json")
        ]
        for path in candidates:
            if os.path.exists(path) and os.path.getsize(path) > 10:
                return path
        return None

    def _init_client(self):
        auth_file = self._get_active_auth_file()
        if auth_file:
            try:
                self._ytmusic = YTMusic(auth_file)
            except Exception as e:
                logger.warning(f"Failed to initialize YTMusic with auth file {auth_file}: {e}")
                self._ytmusic = None
        else:
            # Anonymous search fallback
            try:
                self._ytmusic = YTMusic()
            except Exception:
                self._ytmusic = None

    def is_authenticated(self) -> bool:
        auth_file = self._get_active_auth_file()
        if not auth_file:
            return False
        try:
            yt = YTMusic(auth_file)
            yt.get_library_playlists(limit=1)
            return True
        except Exception as e:
            logger.warning(f"is_authenticated check failed: {e}")
            return False

    def setup_browser_headers(self, raw_headers_text: str) -> Dict[str, Any]:
        """
        Accepts raw request headers copied from Chrome/Firefox DevTools
        when browsing music.youtube.com, and sets up headers_auth.json
        """
        try:
            headers_dict = {}
            lines = [l.strip() for l in raw_headers_text.strip().splitlines() if l.strip()]

            # 1. Try JSON parsing
            if raw_headers_text.strip().startswith("{") and raw_headers_text.strip().endswith("}"):
                try:
                    parsed_json = json.loads(raw_headers_text)
                    if isinstance(parsed_json, dict):
                        headers_dict.update(parsed_json)
                except Exception:
                    pass

            # 2. Try key: value single-line format
            if not headers_dict:
                for line in lines:
                    if ":" in line and not line.startswith("http"):
                        parts = line.split(":", 1)
                        k = parts[0].strip()
                        v = parts[1].strip()
                        headers_dict[k.lower()] = v

            # 3. Try Chrome/Edge DevTools alternating-line format (key \n value)
            if "cookie" not in headers_dict or "authorization" not in headers_dict:
                for i in range(len(lines) - 1):
                    key_candidate = lines[i].lower().strip().rstrip(":")
                    val_candidate = lines[i + 1].strip()
                    if key_candidate in ["cookie", "authorization", "x-goog-authuser", "x-origin", "user-agent", "x-goog-visitor-id", "origin"]:
                        headers_dict[key_candidate] = val_candidate

            # Normalize standard keys
            normalized = {}
            for k, v in headers_dict.items():
                k_clean = k.lower().strip()
                if k_clean in ["cookie", "authorization", "x-goog-authuser", "x-origin", "user-agent", "origin", "x-goog-visitor-id"]:
                    normalized[k_clean] = v

            if not normalized.get("cookie"):
                return {"success": False, "error": "Cookie header not found in the pasted text."}

            # Save to auth file
            with open(YTMUSIC_AUTH_FILE, "w", encoding="utf-8") as f:
                json.dump(normalized, f, indent=2)

            self._init_client()
            if self.is_authenticated():
                settings = get_settings()
                settings.ytmusic_is_connected = True
                save_settings(settings)
                return {"success": True, "message": "Successfully connected to YouTube Music!"}
            else:
                return {"success": False, "error": "Authentication failed. The cookie/authorization might be expired."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def search_best_match(self, track: TrackItem) -> Optional[Tuple[str, str]]:
        """
        Searches YouTube Music for the best match for artist & title.
        Returns (video_id, title)
        """
        if not self._ytmusic:
            self._init_client()

        if track.matched_yt_id and track.source_platform == "youtube":
            return track.matched_yt_id, track.matched_yt_title or track.title

        query = f"{track.artist} - {track.title}".strip()
        try:
            # 1. Search filter: songs
            results = self._ytmusic.search(query, filter="songs", limit=3)
            if results:
                top = results[0]
                return top.get("videoId"), f"{top.get('artists', [{}])[0].get('name', '')} - {top.get('title', '')}"

            # 2. Search filter: videos
            video_results = self._ytmusic.search(query, filter="videos", limit=3)
            if video_results:
                top = video_results[0]
                return top.get("videoId"), f"{top.get('artists', [{}])[0].get('name', '')} - {top.get('title', '')}"

            # 3. Generic search
            gen_results = self._ytmusic.search(query, limit=3)
            for res in gen_results:
                if res.get("videoId"):
                    return res.get("videoId"), res.get("title", "")
        except Exception as e:
            logger.warning(f"Error searching on YT Music for '{query}': {e}")

        return None

    def create_or_get_playlist(self, title: str, description: str = "") -> str:
        """
        Finds existing playlist with exact title, or creates a new one.
        Returns playlist_id.
        """
        if not self._ytmusic or not self.is_authenticated():
            raise ValueError("YouTube Music is not authenticated. Please connect your account in Settings.")

        # Check existing user playlists
        try:
            user_playlists = self._ytmusic.get_library_playlists(limit=100)
            for p in user_playlists:
                if p.get("title", "").strip().lower() == title.strip().lower():
                    return p["playlistId"]
        except Exception as e:
            logger.warning(f"Could not fetch existing playlists: {e}")

        # Create new playlist
        playlist_id = self._ytmusic.create_playlist(
            title=title,
            description=description or "Created automatically with SoundSort AI",
            privacy_status="PRIVATE"
        )
        return playlist_id

    def add_playlist_items(self, playlist_id: str, video_ids: List[str], duplicates: bool = True) -> int:
        if not self._ytmusic:
            self._init_client()
        if not video_ids:
            return 0

        added_count = 0
        chunk_size = 50
        for i in range(0, len(video_ids), chunk_size):
            chunk = video_ids[i:i + chunk_size]
            try:
                res = self._ytmusic.add_playlist_items(playlistId=playlist_id, videoIds=chunk, duplicates=duplicates)
                if isinstance(res, dict) and "SUCCEEDED" in res.get("status", ""):
                    added_count += len(chunk)
                elif isinstance(res, str) and "SUCCEEDED" in res:
                    added_count += len(chunk)
                else:
                    logger.warning(f"Batch add returned non-succeeded status: {res}. Falling back to single-track addition.")
                    for vid in chunk:
                        try:
                            one_res = self._ytmusic.add_playlist_items(playlistId=playlist_id, videoIds=[vid], duplicates=duplicates)
                            if (isinstance(one_res, dict) and "SUCCEEDED" in one_res.get("status", "")) or \
                               (isinstance(one_res, str) and "SUCCEEDED" in one_res):
                                added_count += 1
                        except Exception as ex:
                            logger.error(f"Failed to add track {vid}: {ex}")
            except Exception as e:
                logger.error(f"Error adding chunk to playlist {playlist_id}: {e}")
                for vid in chunk:
                    try:
                        one_res = self._ytmusic.add_playlist_items(playlistId=playlist_id, videoIds=[vid], duplicates=duplicates)
                        if (isinstance(one_res, dict) and "SUCCEEDED" in one_res.get("status", "")) or \
                           (isinstance(one_res, str) and "SUCCEEDED" in one_res):
                            added_count += 1
                    except Exception as ex:
                        logger.error(f"Failed to add single track {vid}: {ex}")
        return added_count

    def sync_subgenre_playlist(
        self, 
        subgenre_name: str, 
        tracks: List[TrackItem], 
        playlist_prefix: str = "SoundSort: "
    ) -> Dict[str, Any]:
        """
        Syncs all tracks belonging to a subgenre into a YouTube Music playlist.
        """
        if not self.is_authenticated():
            raise ValueError("YouTube Music is not authenticated. Please connect your account first.")

        playlist_title = f"{playlist_prefix}{subgenre_name}".strip()
        description = f"Curated {subgenre_name} playlist generated by SoundSort AI. Contains {len(tracks)} tracks."

        # 1. Create or get playlist
        playlist_id = self.create_or_get_playlist(playlist_title, description)

        # 2. Match tracks to video IDs
        matched_tracks: List[Tuple[TrackItem, str]] = []
        unmatched_tracks: List[str] = []
        
        for track in tracks:
            vid_id, matched_title = self.search_best_match(track) or (None, None)
            if vid_id:
                track.matched_yt_id = vid_id
                track.matched_yt_title = matched_title
                matched_tracks.append((track, vid_id))
            else:
                unmatched_tracks.append(f"{track.artist} - {track.title}")

        # 3. Add tracks to playlist in chunks with duplicates=True
        added_count = 0
        chunk_size = 50
        successfully_added_vids = set()

        video_ids = [vid for _, vid in matched_tracks]
        for i in range(0, len(video_ids), chunk_size):
            chunk = video_ids[i:i + chunk_size]
            try:
                res = self._ytmusic.add_playlist_items(
                    playlistId=playlist_id,
                    videoIds=chunk,
                    duplicates=True
                )
                if isinstance(res, dict) and "SUCCEEDED" in res.get("status", ""):
                    added_count += len(chunk)
                    successfully_added_vids.update(chunk)
                elif isinstance(res, str) and "SUCCEEDED" in res:
                    added_count += len(chunk)
                    successfully_added_vids.update(chunk)
                else:
                    logger.warning(f"Batch add returned non-succeeded status: {res}. Falling back to single-track addition.")
                    for vid in chunk:
                        try:
                            one_res = self._ytmusic.add_playlist_items(
                                playlistId=playlist_id,
                                videoIds=[vid],
                                duplicates=True
                            )
                            if (isinstance(one_res, dict) and "SUCCEEDED" in one_res.get("status", "")) or \
                               (isinstance(one_res, str) and "SUCCEEDED" in one_res):
                                added_count += 1
                                successfully_added_vids.add(vid)
                        except Exception as ex:
                            logger.error(f"Failed to add track {vid}: {ex}")
            except Exception as e:
                logger.error(f"Failed adding chunk {i} to playlist {playlist_id}: {e}")
                for vid in chunk:
                    try:
                        one_res = self._ytmusic.add_playlist_items(
                            playlistId=playlist_id,
                            videoIds=[vid],
                            duplicates=True
                        )
                        if (isinstance(one_res, dict) and "SUCCEEDED" in one_res.get("status", "")) or \
                           (isinstance(one_res, str) and "SUCCEEDED" in one_res):
                            added_count += 1
                            successfully_added_vids.add(vid)
                    except Exception as ex:
                        logger.error(f"Failed to add track {vid}: {ex}")

        # 4. Mark is_synced accurately
        for track, vid in matched_tracks:
            if vid in successfully_added_vids:
                track.is_synced = True
            else:
                track.is_synced = False

        playlist_url = f"https://music.youtube.com/playlist?list={playlist_id}"
        return {
            "playlist_id": playlist_id,
            "playlist_title": playlist_title,
            "playlist_url": playlist_url,
            "total_requested": len(tracks),
            "added_count": added_count,
            "unmatched": unmatched_tracks
        }

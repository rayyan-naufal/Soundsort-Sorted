import os
import re
import json
import time
import logging
from typing import Dict, Any, List
from backend.services.ytmusic_sync import YTMusicSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("rename_playlists")

SUMMARY_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "exportify_sync_summary.json")

def main():
    yt_service = YTMusicSyncService()
    if not yt_service.is_authenticated():
        logger.error("YouTube Music is not authenticated. Please check ytmusic_auth.json.")
        return

    logger.info("Fetching playlists from YouTube Music library...")
    playlists = yt_service._ytmusic.get_library_playlists(limit=100)
    logger.info(f"Found {len(playlists)} library playlists.")

    # Match Soundsort : or SoundSort: or Soundsort:
    pattern = re.compile(r"^SoundSort\s*:\s*", re.IGNORECASE)

    renamed_count = 0
    id_to_new_title = {}

    for pl in playlists:
        pl_id = pl.get("playlistId")
        old_title = pl.get("title", "")
        if not pl_id or not old_title:
            continue

        if pattern.match(old_title):
            new_title = pattern.sub("SS: ", old_title)
            if new_title != old_title:
                logger.info(f"Renaming '{old_title}' -> '{new_title}' (ID: {pl_id})...")
                try:
                    res = yt_service._ytmusic.edit_playlist(pl_id, title=new_title)
                    logger.info(f"Successfully renamed to '{new_title}' (result: {res})")
                    renamed_count += 1
                    id_to_new_title[pl_id] = new_title
                    time.sleep(1)  # small throttle
                except Exception as e:
                    logger.error(f"Failed to rename playlist {pl_id} ({old_title}): {e}")

    logger.info(f"Finished renaming {renamed_count} playlists on YouTube Music.")

    # Update summary file if it exists
    if os.path.exists(SUMMARY_FILE):
        try:
            with open(SUMMARY_FILE, "r", encoding="utf-8") as f:
                summary_list = json.load(f)

            updated = False
            for item in summary_list:
                pl_id = item.get("playlist_id")
                pl_title = item.get("playlist_title", "")
                if pl_id in id_to_new_title:
                    item["playlist_title"] = id_to_new_title[pl_id]
                    updated = True
                elif pattern.match(pl_title):
                    item["playlist_title"] = pattern.sub("SS: ", pl_title)
                    updated = True

            if updated:
                with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
                    json.dump(summary_list, f, indent=2, ensure_ascii=False)
                logger.info(f"Updated local summary file at {SUMMARY_FILE}")
        except Exception as e:
            logger.warning(f"Failed to update summary file: {e}")

if __name__ == "__main__":
    main()

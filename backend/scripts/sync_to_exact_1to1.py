import os
import re
import json
import time
import logging
from collections import Counter
from typing import Dict, Any, List, Optional
import pandas as pd
from ytmusicapi import YTMusic

from backend.services.importer import clean_track_metadata
from backend.services.ytmusic_sync import YTMusicSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("sync_1to1")

EXPORTIFY_DIR = r"C:\Users\VICTUS 16\Documents\exportify"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CACHE_FILE = os.path.join(DATA_DIR, "yt_match_cache.json")
SUMMARY_FILE = os.path.join(DATA_DIR, "exportify_sync_summary.json")

# Ensure the last 2 edge cases are cached
MANUAL_FIXES = {
    "Anri - 悲しみがとまらない　I CAN'T STOP THE LONELINESS": {
        "videoId": "6q6GtPdVHL4",
        "title": "Anri - I CAN'T STOP THE LONELINESS"
    },
    "Clean Bandit;Mabel;24kGoldn - Tick Tock (feat. 24kGoldn)": {
        "videoId": "yC8SPG2LwSA",
        "title": "Clean Bandit & Mabel - Tick Tock (feat. 24kGoldn)"
    }
}

def load_cache() -> Dict[str, Optional[Dict[str, str]]]:
    cache = {}
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                cache = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load cache: {e}")
    for k, v in MANUAL_FIXES.items():
        cache[k] = v
    return cache

def save_cache(cache: Dict[str, Optional[Dict[str, str]]]):
    os.makedirs(DATA_DIR, exist_ok=True)
    temp_file = CACHE_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    os.replace(temp_file, CACHE_FILE)

def main():
    yt_service = YTMusicSyncService()
    if not yt_service.is_authenticated():
        logger.error("YouTube Music is not authenticated. Please check ytmusic_auth.json.")
        return

    if not os.path.exists(SUMMARY_FILE):
        logger.error(f"Summary file not found: {SUMMARY_FILE}")
        return

    with open(SUMMARY_FILE, "r", encoding="utf-8") as f:
        summary_list = json.load(f)

    cache = load_cache()
    save_cache(cache)
    logger.info(f"Loaded cache with {len(cache)} entries.")

    updated_summary = []
    total_added_overall = 0

    for item in summary_list:
        file_base = item.get("file")
        pl_title = item.get("playlist_title")
        pl_id = item.get("playlist_id")
        csv_path = os.path.join(EXPORTIFY_DIR, f"{file_base}.csv")

        if not os.path.exists(csv_path):
            logger.warning(f"CSV not found: {csv_path}")
            updated_summary.append(item)
            continue

        df = pd.read_csv(csv_path)
        target_total_rows = len(df)

        logger.info(f"\n{'='*70}\n[1:1 SYNC] Checking {file_base} (Target: {target_total_rows} tracks)\n{'='*70}")

        # 1. Fetch current tracks in the YouTube playlist
        try:
            pl_info = yt_service._ytmusic.get_playlist(pl_id, limit=None)
            current_vids = [trk["videoId"] for trk in pl_info.get("tracks", []) if trk and trk.get("videoId")]
            logger.info(f"Currently in playlist '{pl_title}': {len(current_vids)} tracks.")
        except Exception as e:
            logger.error(f"Could not fetch playlist info for {pl_title}: {e}")
            updated_summary.append(item)
            continue

        # 2. Build target video list for every single row in the CSV
        target_vids = []
        for _, row in df.iterrows():
            title = str(row.get("Track Name", "") or "").strip()
            artist = str(row.get("Artist Name(s)", "") or "").strip()
            if not title:
                continue

            cleaned_title, cleaned_artist = clean_track_metadata(title, artist)
            query = f"{cleaned_artist} - {cleaned_title}".strip()

            c_val = cache.get(query)
            if not c_val or not c_val.get("videoId"):
                # Check manual fixes or variants
                c_val = MANUAL_FIXES.get(query)
            if c_val and c_val.get("videoId"):
                target_vids.append(c_val["videoId"])
            else:
                logger.warning(f"No match for row: {artist} - {title}")

        # 3. Calculate missing instances to achieve exact 1:1 match
        target_counter = Counter(target_vids)
        current_counter = Counter(current_vids)

        to_add_vids = []
        for vid, tgt_count in target_counter.items():
            cur_count = current_counter.get(vid, 0)
            if tgt_count > cur_count:
                to_add_vids.extend([vid] * (tgt_count - cur_count))

        logger.info(f"Target count: {len(target_vids)} | Current YT count: {len(current_vids)} | Need to add: {len(to_add_vids)}")

        # 4. Add missing items if needed
        added_in_this_step = 0
        if to_add_vids:
            logger.info(f"Adding {len(to_add_vids)} tracks to reach 1:1 match for '{pl_title}'...")
            added_in_this_step = yt_service.add_playlist_items(pl_id, to_add_vids, duplicates=True)
            logger.info(f"Successfully added {added_in_this_step} tracks!")
            total_added_overall += added_in_this_step

        final_count = len(current_vids) + added_in_this_step
        item["total_tracks"] = target_total_rows
        item["added"] = final_count
        item["unmatched"] = max(0, target_total_rows - final_count)
        updated_summary.append(item)

        # Save summary update immediately
        with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
            json.dump(updated_summary + summary_list[len(updated_summary):], f, indent=2)

        time.sleep(1)

    logger.info("\n" + "="*80)
    logger.info(f"      1:1 SYNC COMPLETE! Total Added: {total_added_overall}")
    logger.info("="*80)
    for itm in updated_summary:
        logger.info(f" - {itm['playlist_title']}: {itm['added']}/{itm['total_tracks']} tracks | {itm['playlist_url']}")

if __name__ == "__main__":
    main()

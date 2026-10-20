import os
import re
import json
import time
import logging
from typing import Dict, Any, List, Optional, Tuple, Set
import pandas as pd
from ytmusicapi import YTMusic

from backend.services.importer import clean_track_metadata
from backend.services.ytmusic_sync import YTMusicSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("smart_top_up")

EXPORTIFY_DIR = r"C:\Users\VICTUS 16\Documents\exportify"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CACHE_FILE = os.path.join(DATA_DIR, "yt_match_cache.json")
SUMMARY_FILE = os.path.join(DATA_DIR, "exportify_sync_summary.json")

def load_cache() -> Dict[str, Optional[Dict[str, str]]]:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Could not load cache: {e}")
    return {}

def save_cache(cache: Dict[str, Optional[Dict[str, str]]]):
    os.makedirs(DATA_DIR, exist_ok=True)
    temp_file = CACHE_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    os.replace(temp_file, CACHE_FILE)

# Shared search client
_search_yt = YTMusic()

def smart_search(query: str, artist: str, title: str) -> Optional[Dict[str, str]]:
    """
    Tries multiple search query variants to find the best match on YouTube Music.
    """
    candidates = []

    # Cleaned components
    c_title, c_artist = clean_track_metadata(title, artist)
    
    # 1. Direct query with space instead of hyphen
    q1 = re.sub(r"\s*-\s*", " ", query).strip()
    candidates.append(q1)

    # 2. Artist + Title without brackets or parens
    no_brackets = re.sub(r"[\(\[].*?[\)\]]", "", c_title).strip()
    if no_brackets and no_brackets != c_title:
        candidates.append(f"{c_artist} {no_brackets}".strip())

    # 3. Clean primary artist if multiple artists listed
    primary_artist = re.split(r"[,/;&]", c_artist)[0].strip()
    if primary_artist and primary_artist != c_artist:
        candidates.append(f"{primary_artist} {no_brackets or c_title}".strip())

    # 4. Pure title if it contains artist name already
    if c_artist.lower() in c_title.lower():
        candidates.append(c_title)

    for q in candidates:
        if not q:
            continue
        # Search songs, then videos, then general
        for filter_type in ["songs", "videos", None]:
            try:
                if filter_type:
                    res = _search_yt.search(q, filter=filter_type, limit=2)
                else:
                    res = _search_yt.search(q, limit=2)

                if res and res[0].get("videoId"):
                    top = res[0]
                    res_artist = top.get("artists", [{}])[0].get("name", "") if top.get("artists") else ""
                    res_title = top.get("title", "")
                    return {
                        "videoId": top["videoId"],
                        "title": f"{res_artist} - {res_title}".strip(" -")
                    }
            except Exception:
                pass
            time.sleep(0.05)
    return None

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
    logger.info(f"Loaded cache with {len(cache)} entries.")

    updated_summary = []
    total_recovered_songs = 0

    for item in summary_list:
        file_base = item.get("file")
        pl_title = item.get("playlist_title")
        pl_id = item.get("playlist_id")
        total_tracks = item.get("total_tracks", 0)
        curr_added = item.get("added", 0)

        csv_path = os.path.join(EXPORTIFY_DIR, f"{file_base}.csv")
        if not os.path.exists(csv_path):
            logger.warning(f"CSV not found: {csv_path}")
            updated_summary.append(item)
            continue

        # If already 100% full, skip
        if curr_added >= total_tracks and total_tracks > 0:
            logger.info(f"✅ {pl_title}: Already complete ({curr_added}/{total_tracks}). Skipping.")
            updated_summary.append(item)
            continue

        logger.info(f"\n{'='*70}\n[TOP-UP] Processing {file_base} (Current: {curr_added}/{total_tracks})\n{'='*70}")

        # 1. Fetch current tracks already inside the YouTube Music playlist
        existing_vids: Set[str] = set()
        try:
            pl_info = yt_service._ytmusic.get_playlist(pl_id, limit=None)
            for trk in pl_info.get("tracks", []):
                if trk and trk.get("videoId"):
                    existing_vids.add(trk["videoId"])
            logger.info(f"Found {len(existing_vids)} tracks currently in playlist '{pl_title}' on YouTube Music.")
        except Exception as e:
            logger.warning(f"Could not fetch current tracks for {pl_title} ({e}). Will proceed with caution.")

        # 2. Read CSV and identify missing tracks
        df = pd.read_csv(csv_path)
        missing_vids_to_add = []
        newly_matched_count = 0

        for _, row in df.iterrows():
            title = str(row.get("Track Name", "") or "").strip()
            artist = str(row.get("Artist Name(s)", "") or "").strip()
            if not title:
                continue

            cleaned_title, cleaned_artist = clean_track_metadata(title, artist)
            query = f"{cleaned_artist} - {cleaned_title}".strip()

            vid = None
            cached_val = cache.get(query)
            if cached_val and cached_val.get("videoId"):
                vid = cached_val["videoId"]
            else:
                # Run Smart Search
                match = smart_search(query, artist, title)
                if match:
                    cache[query] = match
                    vid = match["videoId"]
                    newly_matched_count += 1
                else:
                    cache[query] = None

            if vid:
                if vid not in existing_vids:
                    missing_vids_to_add.append(vid)
                    existing_vids.add(vid)  # prevent intra-batch dupes

        save_cache(cache)
        logger.info(f"Newly discovered matches: {newly_matched_count}. Total missing songs to add: {len(missing_vids_to_add)}")

        # 3. Add missing tracks to playlist in chunks of 50
        added_new = 0
        if missing_vids_to_add:
            logger.info(f"Adding {len(missing_vids_to_add)} missing tracks to '{pl_title}'...")
            added_new = yt_service.add_playlist_items(pl_id, missing_vids_to_add, duplicates=True)
            logger.info(f"Successfully added {added_new} tracks to '{pl_title}'!")
            total_recovered_songs += added_new

        # Update item stats
        new_total_added = len(existing_vids)
        item["added"] = new_total_added
        item["unmatched"] = max(0, total_tracks - new_total_added)
        updated_summary.append(item)

        # Save summary update immediately
        with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
            json.dump(updated_summary + summary_list[len(updated_summary):], f, indent=2)

        time.sleep(1)

    # Save final summary
    with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
        json.dump(updated_summary, f, indent=2)

    logger.info("\n" + "="*80)
    logger.info(f"      SMART TOP-UP COMPLETE! Total Recovered Songs: {total_recovered_songs}")
    logger.info("="*80)
    for itm in updated_summary:
        logger.info(f" - {itm['playlist_title']}: {itm['added']}/{itm['total_tracks']} tracks | {itm['playlist_url']}")

if __name__ == "__main__":
    main()

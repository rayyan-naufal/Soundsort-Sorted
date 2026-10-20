import os
import glob
import json
import time
import logging
from typing import Dict, Any, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
from ytmusicapi import YTMusic

from backend.services.importer import clean_track_metadata
from backend.services.ytmusic_sync import YTMusicSyncService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("sync_exportify")

EXPORTIFY_DIR = r"C:\Users\VICTUS 16\Documents\exportify"
CACHE_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "yt_match_cache.json")

def load_cache() -> Dict[str, Optional[Dict[str, str]]]:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Could not load cache: {e}")
    return {}

def save_cache(cache: Dict[str, Optional[Dict[str, str]]]):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    temp_file = CACHE_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    os.replace(temp_file, CACHE_FILE)

# Dedicated search client
_search_yt = YTMusic()

def search_yt_single(query: str) -> Optional[Dict[str, str]]:
    try:
        # 1. Search songs
        results = _search_yt.search(query, filter="songs", limit=3)
        if results and results[0].get("videoId"):
            top = results[0]
            artist = top.get("artists", [{}])[0].get("name", "")
            title = top.get("title", "")
            return {"videoId": top["videoId"], "title": f"{artist} - {title}".strip(" -")}

        # 2. Search videos
        v_results = _search_yt.search(query, filter="videos", limit=3)
        if v_results and v_results[0].get("videoId"):
            top = v_results[0]
            artist = top.get("artists", [{}])[0].get("name", "")
            title = top.get("title", "")
            return {"videoId": top["videoId"], "title": f"{artist} - {title}".strip(" -")}

        # 3. Generic search fallback
        gen = _search_yt.search(query, limit=3)
        for item in gen:
            if item.get("videoId"):
                return {"videoId": item["videoId"], "title": item.get("title", "")}
    except Exception as e:
        logger.debug(f"Search failed for '{query}': {e}")
    return None

def process_csv_file(
    csv_path: str,
    yt_service: YTMusicSyncService,
    cache: Dict[str, Optional[Dict[str, str]]],
    search_pool: ThreadPoolExecutor
) -> Dict[str, Any]:
    file_basename = os.path.splitext(os.path.basename(csv_path))[0]
    playlist_title = f"Soundsort : {file_basename}"
    
    logger.info(f"\n{'='*60}\nProcessing file: {os.path.basename(csv_path)} -> '{playlist_title}'\n{'='*60}")
    
    # Read CSV
    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        logger.error(f"Failed to read CSV {csv_path}: {e}")
        return {"file": file_basename, "error": str(e)}

    # Extract tracks
    track_queries = []
    for _, row in df.iterrows():
        title = str(row.get("Track Name", "") or "").strip()
        artist = str(row.get("Artist Name(s)", "") or "").strip()
        if not title:
            continue
        cleaned_title, cleaned_artist = clean_track_metadata(title, artist)
        query = f"{cleaned_artist} - {cleaned_title}".strip()
        track_queries.append(query)

    total_tracks = len(track_queries)
    logger.info(f"Loaded {total_tracks} tracks from {os.path.basename(csv_path)}")

    # Check cache for needed searches
    missing_queries = list(set([q for q in track_queries if q not in cache]))
    if missing_queries:
        logger.info(f"Searching YouTube Music for {len(missing_queries)} new tracks (concurrent)...")
        future_to_query = {search_pool.submit(search_yt_single, q): q for q in missing_queries}
        done_count = 0
        for future in as_completed(future_to_query):
            q = future_to_query[future]
            try:
                res = future.result()
                cache[q] = res
            except Exception as e:
                cache[q] = None
            done_count += 1
            if done_count % 100 == 0 or done_count == len(missing_queries):
                logger.info(f"Search progress: {done_count}/{len(missing_queries)} ({done_count*100//len(missing_queries)}%)")
                save_cache(cache)
        save_cache(cache)

    # Collect video IDs
    video_ids = []
    unmatched_count = 0
    for q in track_queries:
        match = cache.get(q)
        if match and match.get("videoId"):
            video_ids.append(match["videoId"])
        else:
            unmatched_count += 1

    logger.info(f"Matched {len(video_ids)}/{total_tracks} tracks (Unmatched: {unmatched_count})")

    # Create playlist on YouTube Music with retry
    desc = f"Curated playlist '{file_basename}' synced with SoundSort AI. Total tracks: {total_tracks}."
    playlist_id = None
    for attempt in range(1, 4):
        try:
            playlist_id = yt_service.create_or_get_playlist(playlist_title, desc)
            logger.info(f"Playlist ready: '{playlist_title}' (ID: {playlist_id})")
            break
        except Exception as e:
            logger.warning(f"Attempt {attempt}/3 failed to create playlist '{playlist_title}': {e}")
            time.sleep(3)
            # Re-init client if needed
            yt_service._init_client()

    if not playlist_id:
        logger.error(f"Failed to create playlist '{playlist_title}' after 3 attempts.")
        return {"file": file_basename, "error": "Playlist creation failed after retries"}

    # Add items to playlist in chunks of 50
    added_count = 0
    if video_ids:
        logger.info(f"Adding {len(video_ids)} tracks to playlist '{playlist_title}' in chunks...")
        added_count = yt_service.add_playlist_items(playlist_id, video_ids, duplicates=True)
        logger.info(f"Successfully added {added_count} tracks to '{playlist_title}'")

    playlist_url = f"https://music.youtube.com/playlist?list={playlist_id}"
    return {
        "file": file_basename,
        "playlist_title": playlist_title,
        "playlist_id": playlist_id,
        "playlist_url": playlist_url,
        "total_tracks": total_tracks,
        "matched": len(video_ids),
        "added": added_count,
        "unmatched": unmatched_count
    }

def main():
    yt_service = YTMusicSyncService()
    if not yt_service.is_authenticated():
        logger.error("YouTube Music is not authenticated! Please check ytmusic_auth.json.")
        return

    csv_files = glob.glob(os.path.join(EXPORTIFY_DIR, "*.csv"))
    if not csv_files:
        logger.error(f"No CSV files found in {EXPORTIFY_DIR}")
        return

    # Sort files by size so smaller playlists complete and appear first
    csv_files = sorted(csv_files, key=os.path.getsize)
    logger.info(f"Found {len(csv_files)} CSV files in {EXPORTIFY_DIR}:")
    for f in csv_files:
        logger.info(f" - {os.path.basename(f)} ({os.path.getsize(f)/1024:.1f} KB)")

    cache = load_cache()
    logger.info(f"Loaded existing search cache with {len(cache)} entries.")

    report_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "exportify_sync_summary.json")
    existing_reports = {}
    if os.path.exists(report_file):
        try:
            with open(report_file, "r", encoding="utf-8") as f:
                prev_list = json.load(f)
                for item in prev_list:
                    if item.get("added", 0) > 0 and not item.get("error"):
                        existing_reports[item.get("file")] = item
        except Exception as e:
            logger.warning(f"Could not load previous summary: {e}")

    summary_reports = list(existing_reports.values())
    with ThreadPoolExecutor(max_workers=5) as search_pool:
        for idx, csv_file in enumerate(csv_files, 1):
            file_base = os.path.splitext(os.path.basename(csv_file))[0]
            if file_base in existing_reports:
                logger.info(f"⏭️ Skipping {file_base} (already completed: {existing_reports[file_base].get('added')} tracks)")
                continue

            logger.info(f"\n>>> [{idx}/{len(csv_files)}] STARTING {os.path.basename(csv_file)} <<<")
            report = process_csv_file(csv_file, yt_service, cache, search_pool)
            summary_reports.append(report)
            logger.info(f">>> [{idx}/{len(csv_files)}] FINISHED {os.path.basename(csv_file)} <<<\n")
            # Update summary file immediately
            with open(report_file, "w", encoding="utf-8") as f:
                json.dump(summary_reports, f, indent=2)

    logger.info("\n" + "="*80)
    logger.info("                  ALL PLAYLISTS SYNC FINISHED! SUMMARY:")
    logger.info("="*80)
    for r in summary_reports:
        if "error" in r:
            logger.error(f"❌ {r['file']}: ERROR - {r['error']}")
        else:
            logger.info(f"✅ {r['playlist_title']}: {r['added']}/{r['total_tracks']} tracks | URL: {r['playlist_url']}")

    # Save summary report to JSON
    report_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "exportify_sync_summary.json")
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(summary_reports, f, indent=2)
    logger.info(f"\nDetailed summary saved to {report_file}")

if __name__ == "__main__":
    main()

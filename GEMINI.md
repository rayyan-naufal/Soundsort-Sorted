# SoundSort AI — Project Rules & Operational Guidelines

This document contains critical rules, learnings, and conventions established for this project. The AI assistant must strictly follow these guidelines in all future turns and sessions.

---

## 1. YouTube Music API & Synchronization Rules

### 1.1 Always Set `duplicates=True`
- **Rule**: When calling `ytmusic.add_playlist_items(playlistId, videoIds, duplicates=True)`, **always** pass `duplicates=True`.
- **Reason**: When `duplicates=False`, if even a single video ID in the batch already exists in the playlist (or appears multiple times in the batch), YouTube Music's API responds with `STATUS_FAILED` (prompting `confirmDialogRenderer: One or more of the tracks are already in your playlist`). The entire batch is rejected silently without throwing an exception. Setting `duplicates=True` sends `DEDUPE_OPTION_SKIP`, allowing all tracks to be added smoothly.
- **User Preference**: The user explicitly requires playlists to match CSV row counts **1:1**, including intended duplicate tracks.

### 1.2 Chunked Addition (Max 50 Tracks per Batch)
- **Rule**: Never send more than 50 track IDs in a single `add_playlist_items` call.
- **Implementation**:
  ```python
  chunk_size = 50
  for i in range(0, len(video_ids), chunk_size):
      chunk = video_ids[i:i + chunk_size]
      res = ytmusic.add_playlist_items(playlist_id, chunk, duplicates=True)
  ```
- **Reason**: Sending large batches (100+ items) frequently results in HTTP connection drops, payload timeouts, or empty JSON responses (`Expecting value: line 1 column 1`).

### 1.3 Response Validation (ytmusicapi Does Not Raise Exceptions on Failure)
- **Rule**: Never assume `add_playlist_items` succeeded just because it did not raise an Exception.
- **Implementation**: Always inspect the returned dictionary:
  ```python
  if isinstance(res, dict) and "SUCCEEDED" in res.get("status", ""):
      # Succeeded
  elif isinstance(res, str) and "SUCCEEDED" in res:
      # Succeeded
  else:
      # Failed or needs fallback
  ```
- **Tracking**: Only set `track.is_synced = True` or increment `added_count` for tracks that genuinely returned `STATUS_SUCCEEDED`.

---

## 2. Smart Song Search & Matching Strategy

### 2.1 Multi-Stage Search Query Formatting
When matching Spotify / Exportify CSV songs to YouTube Music:
1. **Clean Metadata**: Strip junk tags from titles, e.g. `(Radio Edit)`, `(Remastered ...)`, `[Official Video]`, `(Deluxe Edition)`, `[HQ]`, `(feat. ...)`.
2. **Avoid Rigid Hyphen Search**: Do not use rigid `Artist - Title`. Replace ` - ` with spaces (`f"{artist} {title}"`), as YouTube Music search handles space-separated tokens much better.
3. **Multi-Artist Fallback**: If `artist` contains multiple names separated by `,`, `/`, `&`, or `;`, also try searching with the primary artist alone: `f"{primary_artist} {clean_title}"`.
4. **Filter Hierarchy**:
   - Attempt 1: `ytmusic.search(query, filter="songs", limit=2)`
   - Attempt 2: `ytmusic.search(query, filter="videos", limit=2)`
   - Attempt 3: `ytmusic.search(query, limit=2)` (unfiltered)

### 2.2 Search Caching (`backend/data/yt_match_cache.json`)
- All search matches must be cached in `backend/data/yt_match_cache.json` under `{"query": {"videoId": "...", "title": "..."}}`.
- **Do not cache transient network errors as `None`**. Only mark as unmatched after all fallback attempts fail.
- Periodically save cache to disk during large batch operations so progress is never lost.

---

## 3. Exportify CSV & Playlist Naming Conventions

### 3.1 Playlist Naming Standard
- **Format**: `SS: <FileNameWithoutExtension>`
- **Examples**:
  - `EDM.csv` ➔ `SS: EDM`
  - `Liked_Songs.csv` ➔ `SS: Liked_Songs`
  - `rn1990s.csv` ➔ `SS: rn1990s`
  - `rn.78s.csv` ➔ `SS: rn.78s`
  - `internieche.csv` ➔ `SS: internieche`
- **Source Directory**: `C:\Users\VICTUS 16\Documents\exportify`
- **Target Count**: Strict **1:1** row matching with the CSV file.

---

## 4. Automation Scripts in `backend/scripts/`

- [`sync_exportify_all.py`](file:///c:/Rayyans/01_Rayyan/Music%20Transfer/backend/scripts/sync_exportify_all.py): Complete pipeline to process all CSVs in the exportify folder, search YouTube Music, create playlists, and add tracks in 50-item chunks.
- [`sync_to_exact_1to1.py`](file:///c:/Rayyans/01_Rayyan/Music%20Transfer/backend/scripts/sync_to_exact_1to1.py): Verifies current tracks in YouTube Music playlists against CSV rows and adds missing instances (including duplicates) to guarantee a 1:1 match.
- [`smart_top_up.py`](file:///c:/Rayyans/01_Rayyan/Music%20Transfer/backend/scripts/smart_top_up.py): Recovers previously unmatched or dropped tracks using multi-stage smart search.

---

## 5. Authentication & Environment

- **Auth File**: `backend/data/ytmusic_auth.json` (contains parsed headers/cookies from YouTube Music DevTools).
- **Session Expiry**: If calls return `Expecting value: line 1 column 1` or 401 errors, prompt the user to update request headers in the web UI (`http://127.0.0.1:8000/api/settings` -> Settings modal).
- **Check Status**: `yt_service.is_authenticated()` checks connectivity by calling `get_library_playlists(limit=1)`.

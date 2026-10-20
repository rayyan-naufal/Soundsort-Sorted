import os
import json
import asyncio
import logging
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.services.storage import (
    TrackItem, AppSettings, get_settings, save_settings,
    get_all_tracks, save_all_tracks, add_tracks, update_track,
    bulk_update_subgenre, delete_track, clear_all_tracks,
    batch_update_tracks, batch_delete_tracks
)
from backend.services.importer import MusicImporter, clean_track_metadata
from backend.services.ai_classifier import AIClassifier
from backend.services.ytmusic_sync import YTMusicSyncService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("soundsort")

app = FastAPI(title="SoundSort AI API", version="1.0.0")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

importer = MusicImporter()
ai_classifier = AIClassifier()
yt_sync = YTMusicSyncService()

# Request Models
class ImportRequest(BaseModel):
    input_text: str

class SettingsUpdateRequest(BaseModel):
    gemini_api_key: Optional[str] = None
    gemini_model: Optional[str] = None
    playlist_prefix: Optional[str] = None

class YTAuthRequest(BaseModel):
    headers_raw: str

class ClassifyRequest(BaseModel):
    track_ids: Optional[List[str]] = None
    only_uncategorized: bool = True

class MergeGenresRequest(BaseModel):
    old_subgenre: str
    new_subgenre: str
    new_main_genre: Optional[str] = None

class CustomPlaylistRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    track_ids: List[str]

class SyncRequest(BaseModel):
    subgenres: List[str]
    playlist_prefix: Optional[str] = None

class BatchUpdateRequest(BaseModel):
    track_ids: List[str]
    updates: Dict[str, Any]

class BatchDeleteRequest(BaseModel):
    track_ids: List[str]



@app.get("/api/status")
def get_system_status():
    settings = get_settings()
    tracks = get_all_tracks()
    is_yt_connected = yt_sync.is_authenticated()
    
    # Calculate stats
    total_tracks = len(tracks)
    classified_tracks = len([t for t in tracks if t.sub_genre and t.sub_genre != "General" and t.main_genre != "Uncategorized"])
    synced_tracks = len([t for t in tracks if t.is_synced])
    
    unique_subgenres = list(set([t.sub_genre for t in tracks if t.sub_genre]))

    return {
        "gemini_configured": bool(settings.gemini_api_key),
        "ytmusic_connected": is_yt_connected,
        "total_tracks": total_tracks,
        "classified_tracks": classified_tracks,
        "synced_tracks": synced_tracks,
        "total_subgenres": len(unique_subgenres),
        "subgenres": sorted(unique_subgenres)
    }

@app.get("/api/settings")
def api_get_settings():
    settings = get_settings()
    # Mask API key for UI safety if set
    masked_key = ""
    if settings.gemini_api_key:
        masked_key = settings.gemini_api_key[:6] + "..." + settings.gemini_api_key[-4:] if len(settings.gemini_api_key) > 10 else "******"
    
    return {
        "has_gemini_key": bool(settings.gemini_api_key),
        "masked_gemini_key": masked_key,
        "gemini_model": settings.gemini_model,
        "playlist_prefix": settings.playlist_prefix,
        "ytmusic_connected": yt_sync.is_authenticated()
    }

@app.post("/api/settings")
def api_save_settings(req: SettingsUpdateRequest):
    current = get_settings()
    if req.gemini_api_key is not None and req.gemini_api_key.strip():
        current.gemini_api_key = req.gemini_api_key.strip()
    if req.gemini_model is not None:
        current.gemini_model = req.gemini_model.strip()
    if req.playlist_prefix is not None:
        current.playlist_prefix = req.playlist_prefix
    
    save_settings(current)
    return {"success": True, "message": "Settings updated successfully"}

@app.post("/api/ytmusic/setup")
def api_setup_ytmusic(req: YTAuthRequest):
    result = yt_sync.setup_browser_headers(req.headers_raw)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to setup YT Music auth"))
    return result

@app.get("/api/tracks")
def api_get_tracks(main_genre: Optional[str] = None, sub_genre: Optional[str] = None, search: Optional[str] = None):
    tracks = get_all_tracks()
    if main_genre:
        tracks = [t for t in tracks if (t.main_genre or "").lower() == main_genre.lower()]
    if sub_genre:
        tracks = [t for t in tracks if (t.sub_genre or "").lower() == sub_genre.lower()]
    if search:
        s = search.lower()
        tracks = [t for t in tracks if s in t.title.lower() or s in t.artist.lower() or s in (t.sub_genre or "").lower() or s in (t.main_genre or "").lower()]
    return tracks

@app.post("/api/tracks/import")
def api_import_tracks(req: ImportRequest):
    if not req.input_text.strip():
        raise HTTPException(status_code=400, detail="Input cannot be empty")
    
    extracted = importer.parse_input(req.input_text)
    if not extracted:
        raise HTTPException(status_code=400, detail="No tracks could be found or extracted from the given input.")
    
    added = add_tracks(extracted)
    return {
        "success": True,
        "total_extracted": len(extracted),
        "newly_added": len(added),
        "tracks": added
    }

@app.post("/api/tracks/import/file")
async def api_import_file(file: UploadFile = File(...)):
    try:
        content_bytes = await file.read()
        # Try UTF-8, then fallback to latin-1 / cp1252
        try:
            content_str = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content_str = content_bytes.decode("latin-1")

        if file.filename.lower().endswith(".csv") or "," in content_str[:500] or ";" in content_str[:500]:
            extracted = importer.parse_csv(content_str)
        else:
            extracted = importer.parse_input(content_str)

        if not extracted:
            raise HTTPException(status_code=400, detail="Could not find or parse songs in the uploaded file.")

        added = add_tracks(extracted)
        return {
            "success": True,
            "filename": file.filename,
            "total_extracted": len(extracted),
            "newly_added": len(added),
            "tracks": added
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing file {file.filename}: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/tracks/import/yt-likes")
def api_import_yt_likes(limit: Optional[int] = None):
    if not yt_sync.is_authenticated():
        raise HTTPException(status_code=400, detail="YouTube Music is not connected. Please connect in Settings.")
    
    try:
        # If limit is None, ytmusicapi fetches all pages until exhausted
        liked_data = yt_sync._ytmusic.get_liked_songs(limit=limit)
        tracks_data = liked_data.get("tracks", [])
        
        extracted: List[TrackItem] = []
        for item in tracks_data:
            if not item or not item.get("title"):
                continue
            title = item.get("title", "")
            artists = ", ".join([a.get("name", "") for a in item.get("artists", []) if a.get("name")]) or "Unknown Artist"
            album = item.get("album", {}).get("name", "") if item.get("album") else ""
            thumbs = item.get("thumbnails", [])
            thumb = thumbs[-1].get("url") if thumbs else ""
            vid_id = item.get("videoId")
            dur = item.get("duration", "")
            
            c_title, c_artist = clean_track_metadata(title, artists)
            extracted.append(TrackItem(
                title=c_title,
                artist=c_artist,
                album=album,
                thumbnail=thumb,
                duration_str=dur,
                source_platform="youtube",
                source_url=f"https://music.youtube.com/watch?v={vid_id}" if vid_id else "",
                matched_yt_id=vid_id,
                matched_yt_title=f"{c_artist} - {c_title}"
            ))
            
        added = add_tracks(extracted)
        return {
            "success": True,
            "total_extracted": len(extracted),
            "newly_added": len(added),
            "tracks": added
        }
    except Exception as e:
        logger.error(f"Error fetching YT Music likes: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tracks/classify")
def api_classify_tracks(req: ClassifyRequest):
    all_tracks = get_all_tracks()
    if not all_tracks:
        raise HTTPException(status_code=400, detail="No tracks in library to classify.")

    if req.track_ids:
        to_classify = [t for t in all_tracks if t.id in req.track_ids]
    elif req.only_uncategorized:
        to_classify = [t for t in all_tracks if (t.sub_genre == "General" or t.main_genre == "Uncategorized" or not t.sub_genre)]
    else:
        to_classify = all_tracks

    if not to_classify:
        return {"success": True, "message": "All tracks are already classified!", "classified_count": 0}

    try:
        updated_classified = ai_classifier.classify_tracks(to_classify, batch_size=15)
        
        # Save back to database
        track_map = {t.id: t for t in updated_classified}
        for i, t in enumerate(all_tracks):
            if t.id in track_map:
                all_tracks[i] = track_map[t.id]
        
        save_all_tracks(all_tracks)

        return {
            "success": True,
            "classified_count": len(updated_classified),
            "tracks": updated_classified
        }
    except Exception as e:
        logger.error(f"Classification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tracks/classify/stream")
async def api_classify_tracks_stream(req: ClassifyRequest):
    all_tracks = get_all_tracks()
    if not all_tracks:
        raise HTTPException(status_code=400, detail="No tracks in library to classify.")

    if req.track_ids:
        to_classify = [t for t in all_tracks if t.id in req.track_ids]
    elif req.only_uncategorized:
        to_classify = [t for t in all_tracks if (t.sub_genre == "General" or t.main_genre == "Uncategorized" or not t.sub_genre)]
    else:
        to_classify = all_tracks

    if not to_classify:
        async def empty_gen():
            yield f"data: {json.dumps({'type': 'complete', 'message': 'All tracks already classified', 'total': 0})}\n\n"
        return StreamingResponse(empty_gen(), media_type="text/event-stream")

    settings = get_settings()
    api_key = settings.gemini_api_key
    model = settings.gemini_model or "gemini-3.5-flash-lite"

    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Please set your key in Settings.")

    async def classification_generator():
        batch_size = 100
        total_count = len(to_classify)
        processed_count = 0

        track_lookup = {t.id: t for t in all_tracks}

        yield f"data: {json.dumps({'type': 'start', 'total': total_count, 'batch_size': batch_size})}\n\n"
        await asyncio.sleep(0.01)

        for i in range(0, total_count, batch_size):
            batch = to_classify[i:i + batch_size]
            try:
                loop = asyncio.get_event_loop()
                classified_items, working_model = await loop.run_in_executor(
                    None, ai_classifier.classify_single_batch, batch, api_key, model
                )

                batch_updates = []
                for item in classified_items:
                    idx = item.get("index")
                    if idx is not None and 0 <= idx < len(batch):
                        tr = batch[idx]
                        tr.main_genre = item.get("main_genre", "Electronic")
                        tr.sub_genre = item.get("sub_genre", "General")
                        tr.vibe = item.get("vibe", "")
                        tr.confidence = float(item.get("confidence", 0.9))
                        track_lookup[tr.id] = tr
                        batch_updates.append(tr.model_dump())

                processed_count += len(batch)
                percent = min(100, round((processed_count / total_count) * 100))

                # Save intermediate progress immediately
                save_all_tracks(list(track_lookup.values()))

                event_payload = {
                    "type": "progress",
                    "processed": processed_count,
                    "total": total_count,
                    "percent": percent,
                    "batch_size": len(batch),
                    "model_used": working_model,
                    "batch_tracks": batch_updates
                }
                yield f"data: {json.dumps(event_payload)}\n\n"
                await asyncio.sleep(0.02)

            except Exception as e:
                logger.error(f"Error classifying batch {i}: {e}")
                err_payload = {"type": "error", "message": str(e), "processed": processed_count, "total": total_count}
                yield f"data: {json.dumps(err_payload)}\n\n"
                break

        complete_payload = {"type": "complete", "total_classified": processed_count}
        yield f"data: {json.dumps(complete_payload)}\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }
    return StreamingResponse(classification_generator(), media_type="text/event-stream", headers=headers)

@app.patch("/api/tracks/{track_id}")
def api_update_track(track_id: str, updates: Dict[str, Any]):
    updated = update_track(track_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Track not found")
    return updated

@app.delete("/api/tracks/{track_id}")
def api_delete_track(track_id: str):
    success = delete_track(track_id)
    if not success:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"success": True}

@app.delete("/api/tracks")
def api_clear_tracks():
    clear_all_tracks()
    return {"success": True, "message": "All tracks deleted"}

@app.post("/api/tracks/batch-update")
def api_batch_update_tracks(req: BatchUpdateRequest):
    if not req.track_ids:
        raise HTTPException(status_code=400, detail="No track IDs provided")
    count = batch_update_tracks(req.track_ids, req.updates)
    return {"success": True, "updated_count": count}

@app.post("/api/tracks/batch-delete")
def api_batch_delete_tracks(req: BatchDeleteRequest):
    if not req.track_ids:
        raise HTTPException(status_code=400, detail="No track IDs provided")
    count = batch_delete_tracks(req.track_ids)
    return {"success": True, "deleted_count": count}


@app.post("/api/genres/merge")
def api_merge_genres(req: MergeGenresRequest):
    bulk_update_subgenre(req.old_subgenre, req.new_subgenre, req.new_main_genre)
    return {"success": True, "message": f"Merged '{req.old_subgenre}' into '{req.new_subgenre}'"}

@app.post("/api/ytmusic/sync")
def api_sync_ytmusic(req: SyncRequest):
    if not yt_sync.is_authenticated():
        raise HTTPException(status_code=400, detail="YouTube Music is not connected. Please setup your auth in Settings.")

    if not req.subgenres:
        raise HTTPException(status_code=400, detail="Please select at least one subgenre to sync.")

    settings = get_settings()
    prefix = req.playlist_prefix or settings.playlist_prefix or "SS: "

    all_tracks = get_all_tracks()
    sync_results = []

    for subgenre in req.subgenres:
        genre_tracks = [t for t in all_tracks if (t.sub_genre or "").strip().lower() == subgenre.strip().lower()]
        if not genre_tracks:
            continue

        try:
            report = yt_sync.sync_subgenre_playlist(subgenre, genre_tracks, prefix)
            sync_results.append(report)
        except Exception as e:
            logger.error(f"Failed syncing subgenre '{subgenre}': {e}")
            sync_results.append({
                "subgenre": subgenre,
                "error": str(e),
                "success": False
            })

    # Save any matched track updates
    save_all_tracks(all_tracks)

    return {
        "success": True,
        "playlists": sync_results
    }

@app.post("/api/ytmusic/custom-playlist")
def api_create_custom_playlist(req: CustomPlaylistRequest):
    if not yt_sync.is_authenticated():
        raise HTTPException(status_code=400, detail="YouTube Music is not connected. Please connect in Settings first.")

    if not req.title or not req.title.strip():
        raise HTTPException(status_code=400, detail="Playlist title is required.")

    if not req.track_ids:
        raise HTTPException(status_code=400, detail="No tracks selected for playlist.")

    all_tracks = get_all_tracks()
    track_map = {t.id: t for t in all_tracks}
    selected_tracks = [track_map[tid] for tid in req.track_ids if tid in track_map]

    if not selected_tracks:
        raise HTTPException(status_code=400, detail="None of the selected tracks were found in your library.")

    try:
        # Create or retrieve playlist on YouTube Music
        playlist_id = yt_sync.create_or_get_playlist(req.title.strip(), req.description or "Created with SoundSort AI")
        
        video_ids = []
        matched_tracks = []
        for tr in selected_tracks:
            match = yt_sync.search_best_match(tr)
            if match and match[0]:
                video_ids.append(match[0])
                tr.matched_yt_id = match[0]
                tr.matched_yt_title = match[1]
                matched_tracks.append((tr, match[0]))

        added_count = 0
        if video_ids:
            added_count = yt_sync.add_playlist_items(playlist_id, video_ids, duplicates=True)
            for tr, _ in matched_tracks:
                tr.is_synced = True

        save_all_tracks(all_tracks)

        return {
            "success": True,
            "playlist_id": playlist_id,
            "playlist_url": f"https://music.youtube.com/playlist?list={playlist_id}",
            "added_count": added_count,
            "total_selected": len(selected_tracks)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create custom playlist: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Mount Frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

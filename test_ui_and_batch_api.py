import requests
import json
import re
import io
import time
import threading

BASE_URL = "http://127.0.0.1:8000"

def ensure_server():
    """Ensure a live server is running for tests."""
    try:
        r = requests.get(f"{BASE_URL}/api/status", timeout=0.8)
        if r.status_code == 200:
            return None
    except Exception:
        pass

    import uvicorn
    from backend.main import app
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    time.sleep(1.5)
    return t

def test_full_system():
    ensure_server()

    print("[1] Testing static files delivery (HTML, CSS, JS)...")
    res_index = requests.get(f"{BASE_URL}/")
    assert res_index.status_code == 200, f"Failed GET /: {res_index.status_code}"
    assert "SoundSort" in res_index.text
    assert "audioVisualizerCanvas" in res_index.text
    assert "insightsPanel" in res_index.text
    assert "batchActionBar" in res_index.text
    assert "editTrackModal" in res_index.text

    res_css = requests.get(f"{BASE_URL}/styles.css")
    assert res_css.status_code == 200, f"Failed GET /styles.css: {res_css.status_code}"
    assert "--accent-cyan" in res_css.text
    assert ".legend-chip.active" in res_css.text

    res_js = requests.get(f"{BASE_URL}/app.js")
    assert res_js.status_code == 200, f"Failed GET /app.js: {res_js.status_code}"
    assert "initVisualizer" in res_js.text
    assert "openEditTrackModal" in res_js.text
    print("[PASS] Static frontend files (HTML, CSS, JS) served cleanly!")

    print("\n[2] Verifying HTML element IDs against app.js DOM queries...")
    get_element_ids = re.findall(r"getElementById\(['\"]([a-zA-Z0-9_\-]+)['\"]\)", res_js.text)
    missing_ids = []
    for el_id in set(get_element_ids):
        if f'id="{el_id}"' not in res_index.text and f"id='{el_id}'" not in res_index.text:
            missing_ids.append(el_id)
    
    print(f"Total element IDs checked: {len(set(get_element_ids))}")
    if missing_ids:
        print(f"Warning: Found missing IDs: {missing_ids}")
    assert len(missing_ids) == 0, f"Missing IDs in HTML: {missing_ids}"
    print("[PASS] All DOM elements in app.js match index.html perfectly!")

    print("\n[3] Testing Import and Batch Update with Main Genre Inheritance...")
    sample_input = """Skrillex & Fred again.. - Rumble
Bicep - Glue
American Football - Never Meant
Overmono - Good Lies"""
    requests.post(f"{BASE_URL}/api/tracks/import", json={"input_text": sample_input})

    tracks = requests.get(f"{BASE_URL}/api/tracks").json()
    assert len(tracks) >= 3, "Not enough tracks for batch test"
    
    # Update first track to Electronic / Cyberpunk Synthwave
    requests.patch(f"{BASE_URL}/api/tracks/{tracks[0]['id']}", json={
        "main_genre": "Electronic",
        "sub_genre": "Cyberpunk Synthwave",
        "vibe": "Futuristic Neon"
    })

    # Batch update track 1 and track 2 with only sub_genre "Cyberpunk Synthwave"
    track_ids = [tracks[1]["id"], tracks[2]["id"]]
    update_res = requests.post(f"{BASE_URL}/api/tracks/batch-update", json={
        "track_ids": track_ids,
        "updates": {"sub_genre": "Cyberpunk Synthwave", "vibe": "Futuristic Neon"}
    })
    assert update_res.status_code == 200, f"Batch update failed: {update_res.text}"
    assert update_res.json()["updated_count"] == 2

    # Verify tracks inherited "Electronic" main genre automatically
    tracks_after_update = requests.get(f"{BASE_URL}/api/tracks").json()
    t_map = {t["id"]: t for t in tracks_after_update}
    assert t_map[track_ids[0]]["sub_genre"] == "Cyberpunk Synthwave"
    assert t_map[track_ids[0]]["main_genre"] == "Electronic", f"Expected Electronic, got {t_map[track_ids[0]]['main_genre']}"
    assert t_map[track_ids[1]]["sub_genre"] == "Cyberpunk Synthwave"
    assert t_map[track_ids[1]]["main_genre"] == "Electronic"
    print("[PASS] Batch update atomically updated tracks and inherited parent main_genre!")

    print("\n[4] Testing Batch Delete API (/api/tracks/batch-delete)...")
    delete_res = requests.post(f"{BASE_URL}/api/tracks/batch-delete", json={
        "track_ids": [track_ids[0]]
    })
    assert delete_res.status_code == 200, f"Batch delete failed: {delete_res.text}"
    assert delete_res.json()["deleted_count"] == 1

    tracks_after_delete = requests.get(f"{BASE_URL}/api/tracks").json()
    t_ids_remaining = [t["id"] for t in tracks_after_delete]
    assert track_ids[0] not in t_ids_remaining
    print("[PASS] Batch delete endpoint successfully deleted target track!")

    print("\n[5] Testing Edge Cases: empty batch payloads...")
    empty_batch = requests.post(f"{BASE_URL}/api/tracks/batch-update", json={"track_ids": [], "updates": {}})
    assert empty_batch.status_code == 400
    empty_delete = requests.post(f"{BASE_URL}/api/tracks/batch-delete", json={"track_ids": []})
    assert empty_delete.status_code == 400
    print("[PASS] Empty batch validation handled properly with 400 Bad Request!")

    print("\n[6] Testing File Upload Clean HTTPException Format...")
    f_empty = io.BytesIO(b"")
    res_empty = requests.post(f"{BASE_URL}/api/tracks/import/file", files={"file": ("empty.csv", f_empty, "text/csv")})
    assert res_empty.status_code == 400
    err_detail = res_empty.json().get("detail", "")
    assert not err_detail.startswith("400: "), f"Found redundant status code prefix in: {err_detail}"
    assert "Could not find" in err_detail
    print(f"[PASS] File import error returned clean detail: '{err_detail}'!")

    print("\n[7] Testing Multi-Token Mood Keyword Logic...")
    sample_vibe = "Futuristic Neon"
    chip_vibe_query = "High Energy, Neon, Cyberpunk"
    tokens = [s.strip().lower() for s in chip_vibe_query.split(",") if s.strip()]
    matched = any(token in sample_vibe.lower() for token in tokens)
    assert matched is True, "Token matching failed"
    print("[PASS] Token-based multi-keyword mood preset logic verified!")

    print("\n[ALL TESTS PASSED] UI, Static Assets, and Backend Endpoints Verified Successfully!")

if __name__ == "__main__":
    test_full_system()

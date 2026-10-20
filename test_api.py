import requests
import time
import threading

BASE_URL = "http://127.0.0.1:8000"

def ensure_server():
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

def test_api():
    ensure_server()
    print("[0] Clearing tracks for fresh test...")
    requests.delete(f"{BASE_URL}/api/tracks")

    print("[1] Testing /api/status...")
    res = requests.get(f"{BASE_URL}/api/status")
    print("Status response:", res.status_code, res.json())
    assert res.status_code == 200

    print("\n[2] Testing /api/tracks/import...")
    sample_input = """Skrillex & Fred again.. - Rumble
KSLV Noh - Disaster
Bicep - Glue
American Football - Never Meant
Lorna Shore - To the Hellfire
Gunna - fukumean
Peggy Gou - (It Goes Like) Nanana
Deftones - Be Quiet and Drive (Far Away)
Sub Focus & Dimension - Desire
Charli xcx - Von dutch"""

    import_res = requests.post(f"{BASE_URL}/api/tracks/import", json={"input_text": sample_input})
    print("Import response:", import_res.status_code, import_res.json())
    assert import_res.status_code == 200
    assert import_res.json()["newly_added"] > 0

    print("\n[3] Testing /api/tracks...")
    tracks_res = requests.get(f"{BASE_URL}/api/tracks")
    tracks = tracks_res.json()
    print(f"Total tracks retrieved: {len(tracks)}")
    assert len(tracks) >= 10

    print("\n[4] Testing PATCH /api/tracks/{id}...")
    track_id = tracks[0]["id"]
    patch_res = requests.patch(f"{BASE_URL}/api/tracks/{track_id}", json={
        "main_genre": "Electronic",
        "sub_genre": "UK Bass / Garage",
        "vibe": "High Energy"
    })
    print("Patch response:", patch_res.status_code, patch_res.json())
    assert patch_res.status_code == 200
    assert patch_res.json()["sub_genre"] == "UK Bass / Garage"

    print("\n[5] Testing POST /api/genres/merge...")
    # Update another track to UK Bass
    track_id_2 = tracks[1]["id"]
    requests.patch(f"{BASE_URL}/api/tracks/{track_id_2}", json={
        "main_genre": "Electronic",
        "sub_genre": "Drift Phonk",
        "vibe": "Dark Energy"
    })

    merge_res = requests.post(f"{BASE_URL}/api/genres/merge", json={
        "old_subgenre": "UK Bass / Garage",
        "new_subgenre": "UK Garage & Bassline"
    })
    print("Merge response:", merge_res.status_code, merge_res.json())
    assert merge_res.status_code == 200

    print("\n[6] Checking /api/status updated stats...")
    status_updated = requests.get(f"{BASE_URL}/api/status").json()
    print("Updated stats:", status_updated)

    print("\n[SUCCESS] ALL BACKEND API VERIFICATIONS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_api()

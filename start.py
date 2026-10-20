import os
import sys
import subprocess
import webbrowser
import time

def main():
    print("=" * 60)
    print("          🚀 Starting SoundSort AI Dashboard")
    print("=" * 60)

    # Change directory to root of project
    root_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root_dir)

    # If running with python outside .venv, and .venv exists, delegate to .venv python
    venv_python = os.path.join(root_dir, ".venv", "Scripts", "python.exe")
    if os.path.exists(venv_python) and os.path.normcase(sys.executable) != os.path.normcase(venv_python):
        try:
            import uvicorn
        except ImportError:
            sys.exit(subprocess.call([venv_python] + sys.argv))

    # Optional auto-open browser
    def open_browser():
        time.sleep(1.5)
        webbrowser.open("http://127.0.0.1:8000")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    print("\n[+] Dashboard running at: http://127.0.0.1:8000")
    print("[+] Press Ctrl+C to stop the server.\n")

    try:
        import uvicorn
        uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
    except KeyboardInterrupt:
        print("\n[+] Server stopped.")

if __name__ == "__main__":
    main()

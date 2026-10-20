# SoundSort AI — Project Documentation & Operational Handbook

Dokumentasi lengkap mengenai alur kerja, arsitektur, penyelesaian masalah (*troubleshooting*), dan skrip otomatisasi yang dibangun pada proyek **SoundSort AI**.

---

## 📌 Ringkasan Proyek
SoundSort AI adalah alat otomatisasi musik berbasis Python & AI (Google Gemini) yang berfungsi untuk:
1. Membaca dan mengekstrak daftar lagu dari berbagai sumber (file CSV Exportify, teks playlist, riwayat likes, Spotify).
2. Mengelompokkan lagu berdasarkan genre/sub-genre menggunakan AI Classifier.
3. Melakukan pencarian otomatis (*audio matching*) ke katalog YouTube Music.
4. Membuat playlist dan menyinkronkan seluruh lagu ke akun YouTube Music secara otomatis dengan presisi 1:1.

---

## 🛠️ Aturan Teknis Penting (Lessons Learned & Rules)

### 1. Sinkronisasi YouTube Music (`ytmusicapi`)
* **Wajib Menggunakan `duplicates=True`**:
  Saat menambahkan lagu ke playlist via `add_playlist_items`, **selalu gunakan parameter `duplicates=True`**.
  * **Alasan Teknis**: Jika bernilai `False`, YouTube Music akan mengembalikan respons `STATUS_FAILED` (`One or more of the tracks are already in your playlist`) saat menemukan video yang duplikat atau sudah pernah dimasukkan. Penolakan ini membatalkan seluruh isi batch secara diam-diam (*silent failure*) karena library tidak melempar Exception.
  * **Kebutuhan Pengguna**: Daftar lagu di YouTube Music harus presisi 1:1 dengan baris pada CSV, termasuk jika ada lagu yang berulang.
* **Batch Chunking (Maksimal 50 Lagu)**:
  Jangan pernah mengirim lebih dari 50 lagu sekaligus dalam satu request `add_playlist_items`. Mengirim 100+ lagu rentan memicu timeout server YouTube atau error `Expecting value: line 1 column 1 (char 0)`.
* **Validasi Status Respons**:
  Cek nilai respons `res.get("status") == "STATUS_SUCCEEDED"`. Jangan mengasumsikan sukses hanya karena tidak ada Exception yang terlempar.

### 2. Strategi Pencarian Cerdas (*Smart Fuzzy Search*)
* **Pembersihan Metadata**: Hapus kata-kata pengganggu seperti `[Official Video]`, `(Radio Edit)`, `(Remastered ...)`, `[HQ]`, `(Deluxe Edition)`.
* **Hindari Format Kaku**: Gunakan spasi daripada tanda strip (`f"{artist} {title}"`).
* **Multi-Artist Fallback**: Jika terdapat banyak artis yang dipisah tanda koma/titik koma/slash, prioritaskan artis utama jika pencarian awal tidak membuahkan hasil.
* **Hierarki Filter**: Cari dengan filter `songs` ➔ jika nihil coba filter `videos` ➔ jika nihil coba pencarian umum tanpa filter.

### 3. Caching Permanen (`backend/data/yt_match_cache.json`)
* Semua hasil pencarian yang berhasil disimpan ke dalam cache lokal agar tidak perlu mencari ulang ke YouTube.
* Error koneksi sementara tidak boleh disimpan sebagai `null` secara permanen.

---

## 📁 Direktori & File Penting

* **Direktori Sumber CSV**: `C:\Users\VICTUS 16\Documents\exportify`
* **File Autentikasi YouTube Music**: `backend/data/ytmusic_auth.json`
* **Cache Pencarian**: `backend/data/yt_match_cache.json`
* **Rekap Sinkronisasi**: `backend/data/exportify_sync_summary.json`
* **File Aturan Agent**: `GEMINI.md` (otomatis dibaca AI pada sesi berikutnya)

---

## 🚀 Skrip Otomatisasi (`backend/scripts/`)

| Nama Skrip | Fungsi |
| :--- | :--- |
| `sync_exportify_all.py` | Membaca seluruh file CSV di folder Exportify, mencari match di YouTube Music secara paralel, membuat playlist berformat `Soundsort : <Nama File>`, dan mengunggahnya dalam chunk 50 lagu. |
| `smart_top_up.py` | Mencari ulang lagu-lagu yang sebelumnya gagal di-match menggunakan algoritma *fuzzy search* dan melengkapi lagu yang tertinggal. |
| `sync_to_exact_1to1.py` | Membandingkan lagu yang ada di playlist YouTube Music dengan file CSV, lalu menambahkan instance duplikat yang dibutuhkan agar jumlah lagu 100% tepat sama dengan jumlah baris CSV target. |

---

## 📋 Daftar Playlist yang Berhasil Disinkronkan (1:1 Match)

| No | File CSV | Target CSV | Jumlah di YT Music | Tautan Playlist |
| :---: | :--- | :---: | :---: | :--- |
| 1 | `Liked_Songs.csv` | 1.601 | **1.601** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLIlZxc3bJcRc) |
| 2 | `rn2010s.csv` | 1.561 | **1.561** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLI5q2Kgx57tQ) |
| 3 | `rngold.csv` | 853 | **853** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLH-TbqK_ctgA) |
| 4 | `rn2000s.csv` | 817 | **817** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLOjgbCheRpd8) |
| 5 | `rn1990s.csv` | 737 | **737** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLX-t8VekuLlo) |
| 6 | `rn2020s.csv` | 657 | **657** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLT5xK4e6IuQg) |
| 7 | `EDM.csv` | 532 | **532** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLbfyX4p37eX8) |
| 8 | `just_indo.csv` | 288 | **288** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLcLCA8JpnJbc) |
| 9 | `rn.SC.csv` | 277 | **277** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLDrZLKUTKhcs) |
| 10 | `rn.BossMan.csv` | 264 | **264** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLMFjnoEh6U0A) |
| 11 | `reels_able.csv` | 258 | **258** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLJ-GMYzwnNXI) |
| 12 | `lust.csv` | 250 | **250** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLTSmMAqeGyVQ) |
| 13 | `it's_a_love_song.csv` | 237 | **237** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLRp-510Hhe70) |
| 14 | `Old_Spanish.csv` | 168 | **168** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLDbl4X5lyhNo) |
| 15 | `internieche.csv` | 148 | **148** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLc1SYUdIzYhI) |
| 16 | `rn78s.csv` | 1.790 | **2.505** | [Buka di YouTube Music](https://music.youtube.com/playlist?list=PLQeh3MvWbhqc) |

# 0001. Pipeline Pemindai Native dan Validasi Bertingkat

Keputusan arsitektur untuk memisahkan pemindai deterministik (native tools seperti Trivy) dari analisis AI dan validasi pembuktian non-destruktif.

## Konteks

Sebelumnya, SecurityScan Hub mengeksekusi pemindaian keamanan murni melalui LLM CLI (Hermes). Pendekatan murni LLM rentan menghasilkan temuan palsu (hallucination), tidak memiliki pembuktian terstruktur (evidence), dan tidak dapat menjamin audit dependency atau konfigurasi secara deterministik.

## Keputusan

1. **Jalur Pemindaian Native**: Menggunakan binary scanner native (seperti Trivy untuk analisis dependensi, secret, dan miskonfigurasi) untuk menghasilkan artefak terstruktur (JSON).
2. **Pemisahan Peran**: Scanner native bertugas mendeteksi fakta teknis secara deterministik; AI bertugas mengontekstualisasikan temuan, menjelaskan dampak, dan membantu pemetaan OWASP; tahap validator bertugas memverifikasi bukti secara aman.
3. **Validasi Bertingkat**: Temuan dipisahkan statusnya menjadi kandidat, terbukti (dengan evidence), atau terkonfirmasi aman tanpa mengeksekusi payload destruktif.

## Konsekuensi

- Host worker memerlukan ketersediaan binary scanner (misal `trivy`) dan manajemen dependency database vulnerability.
- Skema temuan dan parser perlu menangani output JSON native terstruktur di samping format markdown Hermes yang sudah ada.

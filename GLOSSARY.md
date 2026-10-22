# SecurityScan Hub

Platform pemindaian keamanan repositori dan aplikasi web berizin yang memadukan pemindai terstruktur dan analisis terarah dengan verifikasi non-destruktif.

## Bahasa & Istilah

**Ruang Lingkup Uji (Assessment Scope)**:
Batasan target teknis (repositori, domain, URL) dan batasan metode pengujian yang diizinkan secara eksplisit untuk diperiksa.
_Avoid_: Target bebas, scan liar, out-of-scope testing

**Persetujuan Target (Target Consent)**:
Konfirmasi otorisasi bahwa pengguna memiliki hak atau izin resmi untuk memindai dan menguji target yang didaftarkan.
_Avoid_: Asumsi izin, pemindaian tanpa otorisasi

**Kandidat Temuan (Candidate Finding)**:
Indikasi awal potensi kerentanan yang dihasilkan oleh pemindai otomatis atau analisis tanpa verifikasi bukti independen.
_Avoid_: Bug terbukti, temuan pasti, valid tanpa bukti

**Temuan Terkonfirmasi (Confirmed Finding)**:
Kerentanan yang telah diverifikasi melalui bukti konkret dan aman yang membuktikan kondisi rentan tanpa dampak destruktif.
_Avoid_: Eksploit senjata, payload perusak

**Tingkat Keyakinan (Confidence Level)**:
Derajat kepastian bahwa indikasi temuan merupakan kerentanan riil, terpisah dari tingkat keparahan (severity).
_Avoid_: Severity (sebagai pengganti kepastian)

**Bukti Validasi (Validation Evidence)**:
Data teknis objektif (seperti baris manifest dependensi, header HTTP aktual, atau kode respon) yang membuktikan eksistensi kerentanan.
_Avoid_: Spekulasi model, klaim tanpa artefak

**Pemindai Deterministik (Deterministic Scanner)**:
Alat inspeksi berbasis aturan atau basis data kerentanan terverifikasi (seperti Trivy) yang menghasilkan temuan berulang dan konsisten untuk input yang sama.
_Avoid_: Scanner berbasis tebakan, model murni generatif

**Basis Fakta Deterministik (Deterministic Baseline)**:
Kumpulan fakta teknis terverifikasi (seperti daftar CVE dari berkas manifest atau header HTTP riil) yang menjadi landasan sebelum analisis kualitatif.
_Avoid_: Temuan tebakan awal, opini model tanpa data

**Pemeriksaan Keamanan Pasif (Passive Security Baseline)**:
Inspeksi keamanan web non-destruktif yang hanya mengevaluasi respon HTTP publik, sertifikat, dan header keamanan tanpa menyuntikkan payload aktif.
_Avoid_: Serangan aktif, eksploitasi agresif


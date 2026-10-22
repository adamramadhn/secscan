# 0003. Validasi Target Runtime dan Penegakan Otorisasi Terjadwal

Penegakan batas otorisasi secara konsisten dan pencegahan SSRF berbasis verifikasi resolusi DNS runtime.

## Konteks

Sebelumnya, validasi URL target hanya memeriksa format domain secara sintaksis. Ini menyisakan celah SSRF di mana domain publik khusus dapat diarahkan ke alamat loopback (`127.0.0.1`) atau IP privat untuk memindai port internal seperti Redis. Selain itu, API jadwal (`POST /api/schedules`) tidak memvalidasi flag persetujuan otorisasi (`confirmOfensif`).

## Keputusan

1. **Resolusi DNS Pre-flight**: Setiap target URL diperiksa alamat IP hasil resolusinya sebelum request dikirim; jika me-resolve ke IP privat, loopback (misal `127.0.0.1`), link-local (`169.254.169.254`), atau IPv6 privat, job langsung ditolak.
2. **Penegakan Persetujuan di Seluruh Jalur**: Pembuatan jadwal berkala wajib menyertakan dan memverifikasi flag persetujuan target, identik dengan pembuatan job langsung.

## Konsekuensi

- Pemindaian target internal atau staging di jaringan lokal privat tidak didukung melalui instans publik ini tanpa konfigurasi khusus.
- Target yang mengalami kegagalan resolusi DNS saat runtime akan ditandai gagal dengan pesan kesalahan eksplisit.

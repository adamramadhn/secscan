# 0002. Pemetaan OWASP Berbasis Taksonomi CWE Terstruktur

Pemetaan kepatuhan OWASP Top 10 didasarkan pada taksonomi CWE resmi dan metadata scanner, bukan pencarian kata kunci teks bebas.

## Konteks

Sebelumnya, `lib/compliance.ts` memetakan temuan ke OWASP Top 10 (2021) menggunakan pencocokan substring kata kunci (seperti 'kripto' atau 'akses') pada judul dan deskripsi. Hal ini sering menimbulkan klasifikasi salah (false positive mapping) dan tidak dapat dihubungkan ke standar industri.

## Keputusan

1. **Pemetaan Berbasis CWE**: Setiap temuan dari pemindai deterministik (misalnya Trivy) dipetakan melalui identifier CWE resmi ke kategori OWASP Top 10 terkait (contoh: CVE dependensi dan komponen usang dipetakan langsung ke A06:2021).
2. **Katalog Taksonomi Terstruktur**: Untuk temuan pengujian web atau analisis lainnya, pemetaan menggunakan kamus CWE terdaftar sebagai rujukan utama, dengan fallback eksplisit ke kategori unmapped (`LAINNYA`) bila tidak memiliki metadata CWE yang terverifikasi.
3. **Penyajian Transparan**: Metrik kepatuhan menampilkan jumlah kontrol yang benar-benar diuji, memisahkan kontrol yang tidak diuji dari kontrol yang bersih dari temuan.

## Konsekuensi

- Skema `job_findings` perlu mendukung penyimpanan atribut referensi standar (`cwe_id`, `cve_id`) agar pemetaan deterministik dapat diaudit ulang.
